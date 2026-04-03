import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { DoctorService } from '../doctor/doctor.service';

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

    private async resolveSpecialties(specialtyIds?: string[]): Promise<DoctorSpecialty[]> {
        if (!specialtyIds || !specialtyIds.length) {
            return [];
        }

        const uniqueIds = Array.from(new Set(specialtyIds));
        const specialties = await this.specialtyRepository.find({
            where: { id: In(uniqueIds) },
        });

        if (specialties.length !== uniqueIds.length) {
            const foundIds = new Set(specialties.map((s) => s.id));
            const missing = uniqueIds.filter((id) => !foundIds.has(id));
            throw new BadRequestException(`Не знайдено спеціальності: ${missing.join(', ')}`);
        }

        const inactive = specialties.filter((s) => !s.isActive);
        if (inactive.length) {
            throw new BadRequestException(
                `Деякі спеціальності неактивні: ${inactive.map((s) => s.name).join(', ')}`,
            );
        }

        return specialties.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
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
            isActive: service.isActive,
            categoryId: service.categoryId,
            category: service.category ? this.mapCategory(service.category) : null,
            specialtyIds: Array.isArray(service.specialties)
                ? service.specialties.map((s) => s.id)
                : [],
            specialties: Array.isArray(service.specialties)
                ? service.specialties.map((s) => this.mapSpecialty(s))
                : [],
            createdAt: service.createdAt,
            updatedAt: service.updatedAt,
        };
    }

    async createCategory(currentUserId: string, dto: CreateServiceCategoryDto) {
        await this.ensureManagerAccess(currentUserId);

        const name = this.normalizeName(dto.name);
        await this.ensureCategoryNameUnique(name);

        let sortOrder = dto.sortOrder;
        if (!sortOrder) {
            const maxOrder = await this.categoryRepository
                .createQueryBuilder('category')
                .select('MAX(category.sortOrder)', 'max')
                .getRawOne<{ max: string | null }>();

            sortOrder = Number(maxOrder?.max || 0) + 1;
        }

        const category = this.categoryRepository.create({
            name,
            description: this.normalizeDescription(dto.description),
            sortOrder,
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

    async getSpecialtiesForAssignment(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const specialties = await this.specialtyRepository.find({
            where: { isActive: true },
            order: { order: 'ASC', name: 'ASC' },
        });

        return {
            ok: true,
            specialties: specialties.map((s) => this.mapSpecialty(s)),
        };
    }

    async create(currentUserId: string, dto: CreateClinicServiceDto) {
        await this.ensureManagerAccess(currentUserId);

        const name = this.normalizeName(dto.name);
        await this.ensureServiceNameUnique(name);

        const category = await this.getCategoryOrThrow(dto.categoryId);
        const specialties = await this.resolveSpecialties(dto.specialtyIds);

        const service = this.clinicServiceRepository.create({
            name,
            description: this.normalizeDescription(dto.description),
            durationMinutes: dto.durationMinutes,
            priceUah: this.normalizePriceUah(Number(dto.priceUah)),
            isActive: dto.isActive ?? true,
            categoryId: category.id,
            category,
            specialties,
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
            order: { name: 'ASC' },
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

        return {
            ok: true,
            categories: grouped,
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

        return {
            ok: true,
            service: this.mapService(service),
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

        if (dto.priceUah !== undefined) {
            const nextPrice = this.normalizePriceUah(Number(dto.priceUah));
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

        const doctor = await this.doctorService.findById(doctorId);
        if (!doctor || !doctor.isActive) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        const doctorSpecialties = Array.isArray(doctor.specialties)
            ? doctor.specialties.map((s) => s.trim().toLowerCase())
            : doctor.specialty
                ? [doctor.specialty.trim().toLowerCase()]
                : [];

        if (!service.specialties?.length) {
            return;
        }

        const allowed = service.specialties.some((specialty) =>
            doctorSpecialties.includes(specialty.name.trim().toLowerCase()),
        );

        if (!allowed) {
            throw new BadRequestException('Цей лікар не може надавати вибрану послугу');
        }
    }
}