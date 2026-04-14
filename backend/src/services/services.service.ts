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
import { ServiceCategoryEntity } from './entities/service-category.entity';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { DoctorSpecialty } from '../doctor/entities/doctor-specialty.entity';
import { Doctor } from '../doctor/entities/doctor.entity';

@Injectable()
export class ServicesService {
    constructor(
        @InjectRepository(ClinicServiceEntity)
        private readonly clinicServiceRepository: Repository<ClinicServiceEntity>,
        @InjectRepository(ServiceCategoryEntity)
        private readonly categoryRepository: Repository<ServiceCategoryEntity>,
        @InjectRepository(DoctorSpecialty)
        private readonly specialtyRepository: Repository<DoctorSpecialty>,
        private readonly userService: UserService,
        private readonly adminService: AdminService,
        @InjectRepository(Doctor)
        private readonly doctorRepository: Repository<Doctor>,
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

    private normalizePriceUah(value: number): number {
        return Math.round(Number(value) * 100) / 100;
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

    private async getCategoryOrThrow(categoryId: string): Promise<ServiceCategoryEntity> {
        const category = await this.categoryRepository.findOne({
            where: { id: categoryId },
        });

        if (!category) {
            throw new BadRequestException('Категорію не знайдено');
        }

        return category;
    }

    private async resolveSpecialties(specialtyIds?: string[]): Promise<DoctorSpecialty[]> {
        if (!specialtyIds || !specialtyIds.length) {
            return [];
        }
        const uniqueIds = [...new Set(specialtyIds.map((id) => id.trim()).filter(Boolean))];

        const specialties = await this.specialtyRepository.find({
            where: uniqueIds.map((id) => ({ id, isActive: true })),
            order: { order: 'ASC', name: 'ASC' },
        });

        if (specialties.length !== uniqueIds.length) {
            const foundIds = new Set(specialties.map((item) => item.id));
            const missing = uniqueIds.filter((id) => !foundIds.has(id));
            throw new BadRequestException(`
                Не знайдено спеціальностей: ${missing.join(', ')}`,
        );
        }

        return specialties;
    }


    private async resolveServiceIds(serviceIds?: string[] | null, exceptId?: string): Promise<string[]> {
        if (!serviceIds || !serviceIds.length) {
            return [];
        }

        const uniqueIds = [...new Set(serviceIds.map((id) => id.trim()).filter(Boolean))];

        if (exceptId && uniqueIds.includes(exceptId)) {
            throw new BadRequestException('Послуга не може залежати сама від себе');
        }

        const services = await this.clinicServiceRepository.find({
            where: uniqueIds.map((id) => ({ id })),
        });

        if (services.length !== uniqueIds.length) {
            const foundIds = new Set(services.map((item) => item.id));
            const missing = uniqueIds.filter((id) => !foundIds.has(id));
            throw new BadRequestException(`Не знайдено послуг: ${missing.join(', ')}`);
        }

        return uniqueIds;
    }

    private normalizeNullableInterval(value?: number | null): number | null {
        if (value === undefined || value === null || Number.isNaN(Number(value))) {
            return null;
        }
        return Number(value);
    }

    private validateServiceRules(params: {
        prerequisiteServiceIds?: string[] | null;
        requiredServiceIds?: string[] | null;
        minIntervalDays?: number | null;
        maxIntervalDays?: number | null;
        currentServiceId?: string;
        allowMultipleInCart?: boolean;
        maxCartQuantity?: number | null;
    }) {
        const { prerequisiteServiceIds, requiredServiceIds, minIntervalDays, maxIntervalDays, currentServiceId, allowMultipleInCart, maxCartQuantity } = params;

        if (currentServiceId && prerequisiteServiceIds?.includes(currentServiceId)) {
            throw new BadRequestException('Послуга не може бути залежною від самої себе');
        }

        if (currentServiceId && requiredServiceIds?.includes(currentServiceId)) {
            throw new BadRequestException('Послуга не може вимагати сама себе');
        }

        if (
            maxIntervalDays !== undefined &&
            maxIntervalDays !== null &&
            minIntervalDays !== undefined &&
            minIntervalDays !== null &&
            maxIntervalDays < minIntervalDays
        ) {
            throw new BadRequestException('Максимальний інтервал не може бути меншим за мінімальний');
        }

        if (
            (minIntervalDays !== undefined && minIntervalDays !== null) ||
            (maxIntervalDays !== undefined && maxIntervalDays !== null)
        ) {
            if (!prerequisiteServiceIds || !prerequisiteServiceIds.length) {
                throw new BadRequestException('Інтервал між процедурами можна задати лише разом із базовими послугами');
            }
        }

        if (!allowMultipleInCart && maxCartQuantity !== null && maxCartQuantity !== undefined && maxCartQuantity > 1) {
            throw new BadRequestException('Максимальна кількість має бути 1, якщо множинний вибір вимкнений');
        }

        if (allowMultipleInCart && maxCartQuantity !== null && maxCartQuantity !== undefined && maxCartQuantity < 2) {
            throw new BadRequestException('Для множинного вибору максимальна кількість має бути не меншою за 2');
        }

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

    private mapSpecialty(specialty: DoctorSpecialty) {
        return {
            id: specialty.id,
            name: specialty.name,
            order: specialty.order,
            isActive: specialty.isActive,
        };
    }

    private mapService(service: ClinicServiceEntity) {
        return {
            id: service.id,
            name: service.name,
            description: service.description,
            durationMinutes: service.durationMinutes,
            priceUah: Number(service.priceUah),
            sortOrder: service.sortOrder,
            isActive: service.isActive,
            categoryId: service.categoryId,
            category: service.category ? this.mapCategory(service.category) : null,
            specialtyIds: Array.isArray(service.specialties)
                ? service.specialties.map((s) => s.id)
                : [],
            specialties: Array.isArray(service.specialties)
                ? service.specialties.map((s) => this.mapSpecialty(s))
                : [],
            requiredServiceIds: Array.isArray(service.requiredServiceIds)
                ? service.requiredServiceIds
                : [],
            prerequisiteServiceIds: Array.isArray(service.prerequisiteServiceIds) ? service.prerequisiteServiceIds : [],
            allowMultipleInCart: Boolean(service.allowMultipleInCart),
            maxCartQuantity: service.maxCartQuantity ?? null,
            minIntervalDays: service.minIntervalDays ?? null,
            maxIntervalDays: service.maxIntervalDays ?? null,
            createdAt: service.createdAt,
            updatedAt: service.updatedAt,
        };
    }

    async createCategory(currentUserId: string, dto: CreateServiceCategoryDto) {
        await this.ensureManagerAccess(currentUserId);

        const name = this.normalizeName(dto.name);
        await this.ensureCategoryNameUnique(name);

        const category = this.categoryRepository.create({
            name,
            description: this.normalizeDescription(dto.description),
            sortOrder: dto.sortOrder ?? 1,
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
        const specialties = await this.resolveSpecialties(dto.specialtyIds);
        const requiredServiceIds = await this.resolveServiceIds(dto.requiredServiceIds);
        const prerequisiteServiceIds = await this.resolveServiceIds(dto.prerequisiteServiceIds);
        const minIntervalDays = this.normalizeNullableInterval(dto.minIntervalDays);
        const maxIntervalDays = this.normalizeNullableInterval(dto.maxIntervalDays);
        const allowMultipleInCart = Boolean(dto.allowMultipleInCart);
        const maxCartQuantity = this.normalizeNullableInterval(dto.maxCartQuantity);

        this.validateServiceRules({
            prerequisiteServiceIds,
            requiredServiceIds,
            minIntervalDays,
            maxIntervalDays,
            allowMultipleInCart,
            maxCartQuantity,
        });

        const service = this.clinicServiceRepository.create({
            name,
            description: this.normalizeDescription(dto.description),
            durationMinutes: dto.durationMinutes,
            priceUah: this.normalizePriceUah(dto.priceUah),
            sortOrder: dto.sortOrder ?? 1,
            isActive: dto.isActive ?? true,
            categoryId: category.id,
            category,
            specialties,
            requiredServiceIds,
            prerequisiteServiceIds,
            minIntervalDays,
            maxIntervalDays,
            allowMultipleInCart,
            maxCartQuantity: allowMultipleInCart ? maxCartQuantity ?? 2 : 1,
        });

        const saved = await this.clinicServiceRepository.save(service);

        return {
            ok: true,
            message: 'Послугу створено',
            service: this.mapService(saved),
        };
    }

    async getAllForAdmin(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const services = await this.clinicServiceRepository.find({
            order: { sortOrder: 'ASC', name: 'ASC' },
        });

        return {
            ok: true,
            services: services.map((s) => this.mapService(s)),
        };
    }

    async getPublicCatalog() {
        const categories = await this.categoryRepository.find({
            where: { isActive: true },
            order: { sortOrder: 'ASC', name: 'ASC' },
        });

        const services = await this.clinicServiceRepository.find({
            where: { isActive: true },
            order: { sortOrder: 'ASC', name: 'ASC' },
        });

        const grouped = categories
            .map((category) => ({
                ...this.mapCategory(category),
                services: services
                    .filter((service) => service.categoryId === category.id)
                    .map((service) => this.mapService(service)),
            }))
            .filter((category) => category.services.length > 0);

        return {
            ok: true,
            categories: grouped,
        };
    }

    async getActivePublic() {
        const services = await this.clinicServiceRepository.find({
            where: { isActive: true },
            order: { sortOrder: 'ASC', name: 'ASC' },
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

        return {
            ok: true,
            service: this.mapService(service),
        };
    }

    async getDoctorsForAssignment(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const specialties = await this.specialtyRepository.find({
            where: { isActive: true },
            order: { order: 'ASC', name: 'ASC' },
        });

        return {
            ok: true,
            specialties: specialties.map((item) => this.mapSpecialty(item)),
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

        if (dto.sortOrder !== undefined && dto.sortOrder !== service.sortOrder) {
            service.sortOrder = dto.sortOrder;
            hasChanges = true;
        }

        if (dto.durationMinutes !== undefined && dto.durationMinutes !== service.durationMinutes) {
            service.durationMinutes = dto.durationMinutes;
            hasChanges = true;
        }

        if (dto.priceUah !== undefined) {
            const nextPrice = this.normalizePriceUah(dto.priceUah);
            if (nextPrice !== Number(service.priceUah)) {
                service.priceUah = nextPrice;
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

        if (dto.specialtyIds !== undefined) {
            const specialties = await this.resolveSpecialties(dto.specialtyIds);
            const currentIds = (service.specialties || []).map((s) => s.id).sort();
            const nextIds = specialties.map((s) => s.id).sort();

            if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
                service.specialties = specialties;
                hasChanges = true;
            }
        }

        const nextRequiredServiceIds =
            dto.requiredServiceIds !== undefined
                ? await this.resolveServiceIds(dto.requiredServiceIds, service.id)
                : Array.isArray(service.requiredServiceIds)
                    ? [...service.requiredServiceIds]
                    : [];

        const nextPrerequisiteServiceIds =
            dto.prerequisiteServiceIds !== undefined
                ? await this.resolveServiceIds(dto.prerequisiteServiceIds, service.id)
                : Array.isArray(service.prerequisiteServiceIds)
                    ? [...service.prerequisiteServiceIds]
                    : [];

        const nextMinIntervalDays =
            dto.minIntervalDays !== undefined
                ? this.normalizeNullableInterval(dto.minIntervalDays)
                : service.minIntervalDays ?? null;

        const nextMaxIntervalDays =
            dto.maxIntervalDays !== undefined
                ? this.normalizeNullableInterval(dto.maxIntervalDays)
                : service.maxIntervalDays ?? null;

        const nextAllowMultipleInCart =
            dto.allowMultipleInCart !== undefined ? dto.allowMultipleInCart : Boolean(service.allowMultipleInCart);

        const nextMaxCartQuantity =
            dto.maxCartQuantity !== undefined
                ? this.normalizeNullableInterval(dto.maxCartQuantity)
                : service.maxCartQuantity ?? null;

        this.validateServiceRules({
            prerequisiteServiceIds: nextPrerequisiteServiceIds,
            requiredServiceIds: nextRequiredServiceIds,
            minIntervalDays: nextMinIntervalDays,
            maxIntervalDays: nextMaxIntervalDays,
            currentServiceId: service.id,
            allowMultipleInCart: nextAllowMultipleInCart,
            maxCartQuantity: nextMaxCartQuantity,
        });

        if (dto.requiredServiceIds !== undefined) {
            const currentIds = Array.isArray(service.requiredServiceIds)
                ? [...service.requiredServiceIds].sort()
                : [];
            const nextIds = [...nextRequiredServiceIds].sort();

            if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
                service.requiredServiceIds = nextRequiredServiceIds;
                hasChanges = true;
            }
        }

        if (dto.prerequisiteServiceIds !== undefined) {
            const currentIds = Array.isArray(service.prerequisiteServiceIds)
                ? [...service.prerequisiteServiceIds].sort()
                : [];
            const nextIds = [...nextPrerequisiteServiceIds].sort();

            if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
                service.prerequisiteServiceIds = nextPrerequisiteServiceIds;
                hasChanges = true;
            }
        }

        if (dto.minIntervalDays !== undefined && nextMinIntervalDays !== (service.minIntervalDays ?? null)) {
            service.minIntervalDays = nextMinIntervalDays;
            hasChanges = true;
        }

        if (dto.maxIntervalDays !== undefined && nextMaxIntervalDays !== (service.maxIntervalDays ?? null)) {
            service.maxIntervalDays = nextMaxIntervalDays;
            hasChanges = true;
        }

        if (dto.allowMultipleInCart !== undefined && nextAllowMultipleInCart !== Boolean(service.allowMultipleInCart)) {
            service.allowMultipleInCart = nextAllowMultipleInCart;
            hasChanges = true;
        }

        if (dto.maxCartQuantity !== undefined && nextMaxCartQuantity !== (service.maxCartQuantity ?? null)) {
            service.maxCartQuantity = nextAllowMultipleInCart ? nextMaxCartQuantity ?? 2 : 1;
            hasChanges = true;
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

    async ensureBookable(serviceId: string, doctorId: string): Promise<void> {
        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
            relations: ['category', 'specialties'],
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

        const doctor = await this.doctorRepository.findOne({
            where: [
                { id: doctorId },
                { user: { id: doctorId } },
            ],
            relations: ['user'],
        });

        if (!doctor) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        if (!doctor.isActive) {
            throw new BadRequestException('Лікаря деактивовано');
        }

        const serviceSpecialtyNames: string[] =
            Array.isArray(service.specialties)
                ? service.specialties
                    .map((s: any) => {
                        if (typeof s === 'string') return s.trim().toLowerCase();
                        if (s && typeof s.name === 'string') return s.name.trim().toLowerCase();
                        return '';
                    })
                    .filter(Boolean)
                : [];

        const doctorSpecialtyNames: string[] =
            Array.isArray(doctor.specialties)
                ? doctor.specialties
                    .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
                    .filter(Boolean)
                : doctor.specialty
                    ? [doctor.specialty.trim().toLowerCase()]
                    : [];

        if (serviceSpecialtyNames.length > 0) {
            const allowed = doctorSpecialtyNames.some((name) =>
                serviceSpecialtyNames.includes(name),
            );

            if (!allowed) {
                throw new BadRequestException('Обраний лікар не може надавати цю послугу');
            }
        }
    }

    async getSpecialtiesForAssignment(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const specialties = await this.specialtyRepository.find({
            where: { isActive: true },
            order: { order: 'ASC', name: 'ASC' },
        });

        return {
            ok: true,
            specialties: specialties.map((item) => this.mapSpecialty(item)),
        };
    }
}