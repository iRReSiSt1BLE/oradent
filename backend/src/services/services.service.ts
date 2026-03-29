import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClinicServiceEntity } from './entities/clinic-service.entity';
import { CreateClinicServiceDto } from './dto/create-clinic-service.dto';
import { UpdateClinicServiceDto } from './dto/update-clinic-service.dto';
import { UserService } from '../user/user.service';
import { AdminService } from '../admin/admin.service';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../user/entities/user.entity';
import { ServiceCategoryEntity } from './entities/service-category.entity';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { ConfigService } from '@nestjs/config';
import { DoctorService } from '../doctor/doctor.service';

type RateSource = 'live' | 'cache' | 'fallback';

@Injectable()
export class ServicesService {
    private rateCache: { rate: number; fetchedAt: number } | null = null;

    constructor(
        @InjectRepository(ClinicServiceEntity)
        private readonly clinicServiceRepository: Repository<ClinicServiceEntity>,
        @InjectRepository(ServiceCategoryEntity)
        private readonly categoryRepository: Repository<ServiceCategoryEntity>,
        private readonly userService: UserService,
        private readonly adminService: AdminService,
        private readonly configService: ConfigService,
        private readonly doctorService: DoctorService,
    ) {}

    private normalizeName(name: string): string {
        return name.trim();
    }

    private normalizeDescription(description?: string): string | null {
        if (description === undefined) {
            return null;
        }
        const normalized = description.trim();
        return normalized.length ? normalized : null;
    }

    private normalizeUsd(value: number): number {
        return Math.round(value * 100) / 100;
    }

    private roundUahTo10(value: number): number {
        return Math.round(value / 10) * 10;
    }

    private async ensureManagerAccess(currentUserId: string): Promise<void> {
        const user = await this.userService.findById(currentUserId);

        if (!user) {
            throw new ForbiddenException('Користувача не знайдено');
        }

        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException('Доступ лише для адміністраторів');
        }

        const admin = await this.adminService.findByUserId(currentUserId);

        if (!admin || !admin.isActive) {
            throw new ForbiddenException('Адміністратора деактивовано');
        }
    }

    private async ensureServiceNameUnique(name: string, exceptId?: string): Promise<void> {
        const qb = this.clinicServiceRepository
            .createQueryBuilder('service')
            .where('LOWER(service.name) = LOWER(:name)', { name });

        if (exceptId) {
            qb.andWhere('service.id != :exceptId', { exceptId });
        }

        const exists = await qb.getOne();

        if (exists) {
            throw new BadRequestException('Послуга з такою назвою вже існує');
        }
    }

    private async ensureCategoryNameUnique(name: string, exceptId?: string): Promise<void> {
        const qb = this.categoryRepository
            .createQueryBuilder('category')
            .where('LOWER(category.name) = LOWER(:name)', { name });

        if (exceptId) {
            qb.andWhere('category.id != :exceptId', { exceptId });
        }

        const exists = await qb.getOne();

        if (exists) {
            throw new BadRequestException('Категорія з такою назвою вже існує');
        }
    }

    private async resolveDoctorUsers(doctorIds?: string[]): Promise<User[]> {
        if (!doctorIds || !doctorIds.length) {
            return [];
        }

        const doctors = await this.userService.findByIds(doctorIds);

        if (doctors.length !== doctorIds.length) {
            const foundIds = new Set(doctors.map((d) => d.id));
            const missing = doctorIds.filter((id) => !foundIds.has(id));
            throw new BadRequestException(`Не знайдено лікарів: ${missing.join(', ')}`);
        }

        const notDoctors = doctors.filter((d) => d.role !== UserRole.DOCTOR);
        if (notDoctors.length) {
            throw new BadRequestException(
                `Користувачі не є лікарями: ${notDoctors.map((u) => u.id).join(', ')}`,
            );
        }

        for (const doctorUser of doctors) {
            const doctorProfile = await this.doctorService.findByUserId(doctorUser.id);
            if (!doctorProfile || !doctorProfile.isActive) {
                throw new BadRequestException(`Лікар деактивований або не має профілю: ${doctorUser.email}`);
            }
        }

        return doctors;
    }

    private async getCategoryOrThrow(categoryId: string): Promise<ServiceCategoryEntity> {
        const category = await this.categoryRepository.findOne({ where: { id: categoryId } });

        if (!category) {
            throw new BadRequestException('Категорію не знайдено');
        }

        return category;
    }

    private mapCategory(category: ServiceCategoryEntity) {
        return {
            id: category.id,
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
        };
    }

    private mapService(service: ClinicServiceEntity) {
        return {
            id: service.id,
            name: service.name,
            description: service.description,
            durationMinutes: service.durationMinutes,
            priceUsd: Number(service.priceUsd),
            priceUah: Number(service.priceUah),
            usdBuyRate: Number(service.usdBuyRate),
            priceUpdatedAt: service.priceUpdatedAt,
            isActive: service.isActive,
            categoryId: service.categoryId,
            category: service.category ? this.mapCategory(service.category) : null,
            doctorIds: service.doctorUsers.map((d) => d.id),
            doctors: service.doctorUsers.map((d) => ({
                id: d.id,
                email: d.email,
            })),
            createdAt: service.createdAt,
            updatedAt: service.updatedAt,
        };
    }

    private async resolveUsdBuyRate(): Promise<{ rate: number; source: RateSource }> {
        const cacheTtlMs = 10 * 60 * 1000;
        const now = Date.now();

        if (this.rateCache && now - this.rateCache.fetchedAt < cacheTtlMs) {
            return { rate: this.rateCache.rate, source: 'cache' };
        }

        try {
            const response = await fetch('https://api.monobank.ua/bank/currency');
            if (!response.ok) {
                throw new Error('monobank non-200');
            }

            const data = (await response.json()) as Array<{
                currencyCodeA: number;
                currencyCodeB: number;
                rateBuy?: number;
                rateSell?: number;
                rateCross?: number;
            }>;

            const usdUah = data.find(
                (item) => item.currencyCodeA === 840 && item.currencyCodeB === 980,
            );

            const liveRate = Number(usdUah?.rateBuy ?? usdUah?.rateCross);

            if (!Number.isFinite(liveRate) || liveRate <= 0) {
                throw new Error('monobank missing buy rate');
            }

            this.rateCache = { rate: liveRate, fetchedAt: now };
            return { rate: liveRate, source: 'live' };
        } catch {
            if (this.rateCache) {
                return { rate: this.rateCache.rate, source: 'cache' };
            }

            const fallback = Number(this.configService.get<string>('USD_BUY_FALLBACK', '0'));
            if (Number.isFinite(fallback) && fallback > 0) {
                return { rate: fallback, source: 'fallback' };
            }

            throw new BadRequestException('Не вдалося отримати курс USD/UAH з Monobank');
        }
    }

    private async buildPricing(priceUsd: number) {
        const normalizedUsd = this.normalizeUsd(priceUsd);
        const { rate, source } = await this.resolveUsdBuyRate();
        const priceUahRaw = normalizedUsd * rate;
        const priceUahRounded = this.roundUahTo10(priceUahRaw);

        return {
            priceUsd: normalizedUsd,
            rate: this.normalizeUsd(rate),
            source,
            priceUah: this.normalizeUsd(priceUahRounded),
        };
    }

    async getPricingMeta() {
        const { rate, source } = await this.resolveUsdBuyRate();
        return {
            ok: true,
            pricing: {
                usdBuyRate: this.normalizeUsd(rate),
                source,
                roundedTo: 10,
                currency: 'UAH',
            },
        };
    }

    async createCategory(currentUserId: string, dto: CreateServiceCategoryDto) {
        await this.ensureManagerAccess(currentUserId);

        const name = this.normalizeName(dto.name);
        await this.ensureCategoryNameUnique(name);

        const category = this.categoryRepository.create({
            name,
            description: this.normalizeDescription(dto.description),
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
        });

        const saved = await this.categoryRepository.save(category);

        return {
            ok: true,
            message: 'Категорію створено',
            category: this.mapCategory(saved),
        };
    }

    async getCategoriesForAdmin(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const categories = await this.categoryRepository.find({
            order: { sortOrder: 'ASC', name: 'ASC' },
        });

        return {
            ok: true,
            categories: categories.map((c) => this.mapCategory(c)),
        };
    }

    async updateCategory(
        currentUserId: string,
        categoryId: string,
        dto: UpdateServiceCategoryDto,
    ) {
        await this.ensureManagerAccess(currentUserId);

        const category = await this.getCategoryOrThrow(categoryId);

        let hasChanges = false;

        if (dto.name !== undefined) {
            const name = this.normalizeName(dto.name);
            if (name !== category.name) {
                await this.ensureCategoryNameUnique(name, category.id);
                category.name = name;
                hasChanges = true;
            }
        }

        if (dto.description !== undefined) {
            const description = this.normalizeDescription(dto.description);
            if (description !== category.description) {
                category.description = description;
                hasChanges = true;
            }
        }

        if (dto.sortOrder !== undefined && dto.sortOrder !== category.sortOrder) {
            category.sortOrder = dto.sortOrder;
            hasChanges = true;
        }

        if (dto.isActive !== undefined && dto.isActive !== category.isActive) {
            category.isActive = dto.isActive;
            hasChanges = true;
        }

        if (!hasChanges) {
            throw new BadRequestException('Немає змін для збереження');
        }

        const saved = await this.categoryRepository.save(category);

        return {
            ok: true,
            message: 'Категорію оновлено',
            category: this.mapCategory(saved),
        };
    }

    async toggleCategoryActive(currentUserId: string, categoryId: string) {
        await this.ensureManagerAccess(currentUserId);

        const category = await this.getCategoryOrThrow(categoryId);
        category.isActive = !category.isActive;

        const saved = await this.categoryRepository.save(category);

        return {
            ok: true,
            message: saved.isActive ? 'Категорію активовано' : 'Категорію деактивовано',
            category: this.mapCategory(saved),
        };
    }

    async create(currentUserId: string, dto: CreateClinicServiceDto) {
        await this.ensureManagerAccess(currentUserId);

        const name = this.normalizeName(dto.name);
        await this.ensureServiceNameUnique(name);

        const category = await this.getCategoryOrThrow(dto.categoryId);
        const doctors = await this.resolveDoctorUsers(dto.doctorIds);
        const pricing = await this.buildPricing(dto.priceUsd);

        const service = this.clinicServiceRepository.create({
            name,
            description: this.normalizeDescription(dto.description),
            durationMinutes: dto.durationMinutes,
            priceUsd: pricing.priceUsd,
            priceUah: pricing.priceUah,
            usdBuyRate: pricing.rate,
            priceUpdatedAt: new Date(),
            isActive: dto.isActive ?? true,
            categoryId: category.id,
            category,
            doctorUsers: doctors,
        });

        const saved = await this.clinicServiceRepository.save(service);

        return {
            ok: true,
            message: 'Послугу створено',
            service: this.mapService(saved),
            pricing: {
                source: pricing.source,
                roundedTo: 10,
            },
        };
    }

    async getAllForAdmin(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const services = await this.clinicServiceRepository.find({
            order: { name: 'ASC' },
        });

        const { rate, source } = await this.resolveUsdBuyRate();

        return {
            ok: true,
            services: services.map((s) => this.mapService(s)),
            pricing: {
                usdBuyRate: this.normalizeUsd(rate),
                source,
                roundedTo: 10,
            },
        };
    }

    async getPublicCatalog() {
        const categories = await this.categoryRepository.find({
            where: { isActive: true },
            order: { sortOrder: 'ASC', name: 'ASC' },
        });

        const services = await this.clinicServiceRepository.find({
            where: { isActive: true },
            order: { name: 'ASC' },
        });

        const grouped = categories
            .map((category) => ({
                ...this.mapCategory(category),
                services: services
                    .filter((service) => service.categoryId === category.id)
                    .map((service) => this.mapService(service)),
            }))
            .filter((category) => category.services.length > 0);

        const { rate, source } = await this.resolveUsdBuyRate();

        return {
            ok: true,
            categories: grouped,
            pricing: {
                usdBuyRate: this.normalizeUsd(rate),
                source,
                roundedTo: 10,
            },
        };
    }

    async getActivePublic() {
        const services = await this.clinicServiceRepository.find({
            where: { isActive: true },
            order: { name: 'ASC' },
        });

        return {
            ok: true,
            services: services.map((s) => this.mapService(s)),
        };
    }

    async getPublicServiceById(serviceId: string) {
        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
        });

        if (!service || !service.isActive || !service.category?.isActive) {
            throw new BadRequestException('Послугу не знайдено');
        }

        const { rate, source } = await this.resolveUsdBuyRate();

        return {
            ok: true,
            service: this.mapService(service),
            pricing: {
                usdBuyRate: this.normalizeUsd(rate),
                source,
                roundedTo: 10,
            },
        };
    }

    async getDoctorsForAssignment(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const doctors = await this.doctorService.getDoctorsForOptions();

        return {
            ok: true,
            doctors: doctors.map((d) => ({
                id: d.id,
                email: d.email,
            })),
        };
    }

    async update(currentUserId: string, serviceId: string, dto: UpdateClinicServiceDto) {
        await this.ensureManagerAccess(currentUserId);

        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
        });

        if (!service) {
            throw new BadRequestException('Послугу не знайдено');
        }

        let hasChanges = false;

        if (dto.name !== undefined) {
            const name = this.normalizeName(dto.name);
            if (name !== service.name) {
                await this.ensureServiceNameUnique(name, service.id);
                service.name = name;
                hasChanges = true;
            }
        }

        if (dto.description !== undefined) {
            const description = this.normalizeDescription(dto.description);
            if (description !== service.description) {
                service.description = description;
                hasChanges = true;
            }
        }

        if (dto.durationMinutes !== undefined && dto.durationMinutes !== service.durationMinutes) {
            service.durationMinutes = dto.durationMinutes;
            hasChanges = true;
        }

        if (dto.priceUsd !== undefined) {
            const pricing = await this.buildPricing(dto.priceUsd);

            if (pricing.priceUsd !== Number(service.priceUsd)) {
                service.priceUsd = pricing.priceUsd;
                service.priceUah = pricing.priceUah;
                service.usdBuyRate = pricing.rate;
                service.priceUpdatedAt = new Date();
                hasChanges = true;
            }
        }

        if (dto.categoryId !== undefined && dto.categoryId !== service.categoryId) {
            const category = await this.getCategoryOrThrow(dto.categoryId);
            service.categoryId = category.id;
            service.category = category;
            hasChanges = true;
        }

        if (dto.isActive !== undefined && dto.isActive !== service.isActive) {
            service.isActive = dto.isActive;
            hasChanges = true;
        }

        if (dto.doctorIds !== undefined) {
            const doctors = await this.resolveDoctorUsers(dto.doctorIds);
            const currentIds = service.doctorUsers.map((d) => d.id).sort();
            const nextIds = doctors.map((d) => d.id).sort();

            if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
                service.doctorUsers = doctors;
                hasChanges = true;
            }
        }

        if (!hasChanges) {
            throw new BadRequestException('Немає змін для збереження');
        }

        const saved = await this.clinicServiceRepository.save(service);

        return {
            ok: true,
            message: 'Послугу оновлено',
            service: this.mapService(saved),
        };
    }

    async toggleActive(currentUserId: string, serviceId: string) {
        await this.ensureManagerAccess(currentUserId);

        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
        });

        if (!service) {
            throw new BadRequestException('Послугу не знайдено');
        }

        service.isActive = !service.isActive;
        const saved = await this.clinicServiceRepository.save(service);

        return {
            ok: true,
            message: saved.isActive ? 'Послугу активовано' : 'Послугу деактивовано',
            service: this.mapService(saved),
        };
    }

    async refreshPrices(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const { rate, source } = await this.resolveUsdBuyRate();

        const services = await this.clinicServiceRepository.find();
        const now = new Date();

        for (const service of services) {
            service.usdBuyRate = this.normalizeUsd(rate);
            service.priceUah = this.normalizeUsd(this.roundUahTo10(Number(service.priceUsd) * rate));
            service.priceUpdatedAt = now;
        }

        await this.clinicServiceRepository.save(services);

        return {
            ok: true,
            message: 'Ціни оновлено за поточним курсом Monobank',
            pricing: {
                usdBuyRate: this.normalizeUsd(rate),
                source,
                roundedTo: 10,
            },
        };
    }

    async ensureBookable(serviceId: string, doctorId: string): Promise<void> {
        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
        });

        if (!service) {
            throw new BadRequestException('Послугу не знайдено');
        }

        if (!service.isActive) {
            throw new BadRequestException('Послуга деактивована');
        }

        if (!service.category?.isActive) {
            throw new BadRequestException('Категорія послуги деактивована');
        }

        const doctorUser = await this.userService.findById(doctorId);
        if (!doctorUser || doctorUser.role !== UserRole.DOCTOR) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        const doctorProfile = await this.doctorService.findByUserId(doctorUser.id);
        if (!doctorProfile || !doctorProfile.isActive) {
            throw new BadRequestException('Лікаря деактивовано');
        }

        if (service.doctorUsers.length > 0) {
            const allowed = service.doctorUsers.some((d) => d.id === doctorId);
            if (!allowed) {
                throw new BadRequestException('Цей лікар не призначений на вибрану послугу');
            }
        }
    }
}
