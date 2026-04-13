import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserService } from '../user/user.service';
import { AdminService } from '../admin/admin.service';
import { UserRole } from '../common/enums/user-role.enum';
import { Cabinet } from './entities/cabinet.entity';
import {
    CabinetDevice,
    CabinetDeviceStartMode,
} from './entities/cabinet-device.entity';
import { CabinetDoctor } from './entities/cabinet-doctor.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';
import { CreateCabinetDto } from './dto/create-cabinet.dto';
import { UpdateCabinetDto } from './dto/update-cabinet.dto';

@Injectable()
export class CabinetService {
    constructor(
        @InjectRepository(Cabinet)
        private readonly cabinetRepository: Repository<Cabinet>,
        @InjectRepository(CabinetDevice)
        private readonly cabinetDeviceRepository: Repository<CabinetDevice>,
        @InjectRepository(CabinetDoctor)
        private readonly cabinetDoctorRepository: Repository<CabinetDoctor>,
        @InjectRepository(Doctor)
        private readonly doctorRepository: Repository<Doctor>,
        @InjectRepository(ClinicServiceEntity)
        private readonly clinicServiceRepository: Repository<ClinicServiceEntity>,
        private readonly userService: UserService,
        private readonly adminService: AdminService,
    ) {}

    private normalizeName(value: string) {
        return value.trim();
    }

    private normalizeDescription(value?: string) {
        if (value === undefined) return null;
        const normalized = value.trim();
        return normalized.length ? normalized : null;
    }

    private async ensureManagerAccess(currentUserId: string) {
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

    private async ensureCabinetNameUnique(name: string, exceptId?: string) {
        const qb = this.cabinetRepository
            .createQueryBuilder('cabinet')
            .where('LOWER(cabinet.name) = LOWER(:name)', { name });

        if (exceptId) {
            qb.andWhere('cabinet.id != :exceptId', { exceptId });
        }

        const existing = await qb.getOne();
        if (existing) {
            throw new BadRequestException('Кабінет з такою назвою вже існує');
        }
    }

    private async resolveServices(serviceIds?: string[]) {
        const uniqueIds = [...new Set((serviceIds || []).map((item) => item.trim()).filter(Boolean))];
        if (!uniqueIds.length) return [];

        const services = await this.clinicServiceRepository.find({
            where: { id: In(uniqueIds), isActive: true },
            relations: ['category', 'specialties'],
            order: { sortOrder: 'ASC', name: 'ASC' },
        });

        if (services.length !== uniqueIds.length) {
            const foundIds = new Set(services.map((item) => item.id));
            const missing = uniqueIds.filter((id) => !foundIds.has(id));
            throw new BadRequestException(`Не знайдено послуг: ${missing.join(', ')}`);
        }

        return services;
    }

    private async resolveDoctors(doctorIds?: string[]) {
        const normalizedDoctorIds = [...new Set((doctorIds || []).map((item) => item.trim()).filter(Boolean))];
        if (!normalizedDoctorIds.length) return [] as Doctor[];

        const doctors = await this.doctorRepository.find({
            where: { id: In(normalizedDoctorIds), isActive: true },
            relations: ['user'],
            order: { lastName: 'ASC', firstName: 'ASC' },
        });

        if (doctors.length !== normalizedDoctorIds.length) {
            const foundIds = new Set(doctors.map((item) => item.id));
            const missing = normalizedDoctorIds.filter((id) => !foundIds.has(id));
            throw new BadRequestException(`Не знайдено лікарів: ${missing.join(', ')}`);
        }

        return doctors;
    }

    private normalizeDevices(devices?: Array<{
        name: string;
        cameraDeviceId?: string;
        cameraLabel?: string | null;
        microphoneDeviceId?: string | null;
        microphoneLabel?: string | null;
        startMode: CabinetDeviceStartMode;
        isActive?: boolean;
    }>) {
        return (devices || [])
            .map((device, index) => ({
                name: this.normalizeName(device.name),
                cameraDeviceId: (device.cameraDeviceId || '').trim() || null,
                cameraLabel: device.cameraLabel?.trim() || null,
                microphoneDeviceId: device.microphoneDeviceId?.trim() || null,
                microphoneLabel: device.microphoneLabel?.trim() || null,
                startMode: device.startMode,
                isActive: device.isActive !== false,
                sortOrder: index,
            }))
            .filter((device) => device.name.length > 0 && (device.cameraDeviceId || device.microphoneDeviceId));
    }

    private async getCabinetOrThrow(cabinetId: string) {
        const cabinet = await this.cabinetRepository.findOne({
            where: { id: cabinetId },
            relations: ['services', 'services.category', 'services.specialties', 'devices', 'doctorAssignments', 'doctorAssignments.doctor', 'doctorAssignments.doctor.user'],
        });

        if (!cabinet) {
            throw new BadRequestException('Кабінет не знайдено');
        }

        return cabinet;
    }

    private mapService(service: ClinicServiceEntity, doctorIds: string[] = []) {
        return {
            id: service.id,
            name: service.name,
            isActive: service.isActive,
            categoryId: service.categoryId,
            durationMinutes: Number(service.durationMinutes || 0),
            priceUah: Number(service.priceUah || 0),
            specialtyIds: Array.isArray(service.specialties) ? service.specialties.map((item) => item.id) : [],
            specialties: Array.isArray(service.specialties)
                ? service.specialties.map((item) => ({
                      id: item.id,
                      name: item.name,
                      order: item.order,
                      isActive: item.isActive,
                  }))
                : [],
            doctorIds,
        };
    }

    private mapDoctor(doctor: Doctor) {
        return {
            id: doctor.id,
            userId: doctor.user?.id || null,
            lastName: doctor.lastName,
            firstName: doctor.firstName,
            middleName: doctor.middleName,
            specialty: doctor.specialty,
            specialties: Array.isArray(doctor.specialties) ? doctor.specialties : [],
            isActive: doctor.isActive,
        };
    }

    private doctorMatchesServiceBySpecialty(
        doctor: Doctor,
        service: ClinicServiceEntity,
    ): boolean {
        const doctorSpecialties = Array.isArray(doctor.specialties)
            ? doctor.specialties
                .map((value) => String(value).trim().toLowerCase())
                .filter(Boolean)
            : [];

        const serviceSpecialties = Array.isArray(service.specialties)
            ? service.specialties
                .map((specialty) => String(specialty.name).trim().toLowerCase())
                .filter(Boolean)
            : [];

        if (!serviceSpecialties.length) {
            return true;
        }

        return serviceSpecialties.some((name) => doctorSpecialties.includes(name));
    }

    private mapCabinet(cabinet: Cabinet) {
        const devices = [...(cabinet.devices || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        const doctorAssignments = [...(cabinet.doctorAssignments || [])].sort((a, b) =>
            a.doctor.lastName.localeCompare(b.doctor.lastName) || a.doctor.firstName.localeCompare(b.doctor.firstName),
        );
        const services = [...(cabinet.services || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.name.localeCompare(b.name));

        return {
            id: cabinet.id,
            name: cabinet.name,
            description: cabinet.description,
            isActive: cabinet.isActive,
            serviceIds: services.map((item) => item.id),
            services: services.map((item) => this.mapService(item)),
            devices: devices.map((device) => ({
                id: device.id,
                name: device.name,
                cameraDeviceId: device.cameraDeviceId,
                cameraLabel: device.cameraLabel,
                microphoneDeviceId: device.microphoneDeviceId,
                microphoneLabel: device.microphoneLabel,
                startMode: device.startMode,
                isActive: device.isActive,
                sortOrder: device.sortOrder,
            })),
            doctorIds: doctorAssignments.map((assignment) => assignment.doctorId),
            doctorAssignments: doctorAssignments.map((assignment) => ({
                id: assignment.id,
                doctorId: assignment.doctorId,
                doctor: this.mapDoctor(assignment.doctor),
            })),
            createdAt: cabinet.createdAt,
            updatedAt: cabinet.updatedAt,
        };
    }

    private async syncChildren(
        cabinet: Cabinet,
        devicesInput: Array<{
            name: string;
            cameraDeviceId: string | null;
            cameraLabel: string | null;
            microphoneDeviceId: string | null;
            microphoneLabel: string | null;
            startMode: CabinetDeviceStartMode;
            isActive: boolean;
            sortOrder: number;
        }>,
        doctorsInput: Doctor[],
    ) {
        await this.cabinetDeviceRepository.delete({ cabinetId: cabinet.id });
        await this.cabinetDoctorRepository.delete({ cabinetId: cabinet.id });

        if (devicesInput.length) {
            const deviceEntities = devicesInput.map((device) =>
                this.cabinetDeviceRepository.create({
                    cabinetId: cabinet.id,
                    name: device.name,
                    cameraDeviceId: device.cameraDeviceId,
                    cameraLabel: device.cameraLabel,
                    microphoneDeviceId: device.microphoneDeviceId,
                    microphoneLabel: device.microphoneLabel,
                    startMode: device.startMode,
                    isActive: device.isActive,
                    sortOrder: device.sortOrder,
                }),
            );
            await this.cabinetDeviceRepository.save(deviceEntities);
        }

        if (doctorsInput.length) {
            const assignmentEntities = doctorsInput.map((doctor) =>
                this.cabinetDoctorRepository.create({
                    cabinetId: cabinet.id,
                    doctorId: doctor.id,
                }),
            );
            await this.cabinetDoctorRepository.save(assignmentEntities);
        }
    }

    async getAllForAdmin(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const cabinets = await this.cabinetRepository.find({
            relations: ['services', 'services.category', 'services.specialties', 'devices', 'doctorAssignments', 'doctorAssignments.doctor', 'doctorAssignments.doctor.user'],
            order: { name: 'ASC', createdAt: 'DESC' },
        });

        return {
            cabinets: cabinets.map((item) => this.mapCabinet(item)),
        };
    }

    async getDoctorsForAssignment(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const doctors = await this.doctorRepository.find({
            where: { isActive: true },
            relations: ['user'],
            order: { lastName: 'ASC', firstName: 'ASC' },
        });

        return {
            doctors: doctors.map((item) => this.mapDoctor(item)),
        };
    }

    
async getServicesForAssignment(currentUserId: string) {
    await this.ensureManagerAccess(currentUserId);

    const [services, doctors] = await Promise.all([
        this.clinicServiceRepository.find({
            where: { isActive: true },
            relations: ['category', 'specialties'],
            order: { sortOrder: 'ASC', name: 'ASC' },
        }),
        this.doctorRepository.find({
            where: { isActive: true },
            relations: ['user'],
            order: { lastName: 'ASC', firstName: 'ASC' },
        }),
    ]);

    return {
        services: services.map((item) => {
            const doctorIds = doctors
                .filter((doctor) => this.doctorMatchesServiceBySpecialty(doctor, item))
                .map((doctor) => doctor.id);

            return this.mapService(item, doctorIds);
        }),
    };
}


    async create(currentUserId: string, dto: CreateCabinetDto) {
        await this.ensureManagerAccess(currentUserId);

        const name = this.normalizeName(dto.name || '');
        if (!name) {
            throw new BadRequestException('Вкажіть назву кабінету');
        }

        const devicesInput = this.normalizeDevices(dto.devices);
        const [services, doctors] = await Promise.all([
            this.resolveServices(dto.serviceIds),
            this.resolveDoctors(dto.doctorIds),
        ]);

        await this.ensureCabinetNameUnique(name);

        let cabinet = this.cabinetRepository.create({
            name,
            description: this.normalizeDescription(dto.description),
            isActive: dto.isActive !== false,
            services,
        });

        cabinet = await this.cabinetRepository.save(cabinet);
        await this.syncChildren(cabinet, devicesInput, doctors);

        const saved = await this.getCabinetOrThrow(cabinet.id);
        return { cabinet: this.mapCabinet(saved) };
    }

    async update(currentUserId: string, cabinetId: string, dto: UpdateCabinetDto) {
        await this.ensureManagerAccess(currentUserId);

        const cabinet = await this.getCabinetOrThrow(cabinetId);
        const nextName = dto.name !== undefined ? this.normalizeName(dto.name) : cabinet.name;
        if (!nextName) {
            throw new BadRequestException('Вкажіть назву кабінету');
        }

        const devicesInput = dto.devices !== undefined ? this.normalizeDevices(dto.devices) : this.normalizeDevices(cabinet.devices as any);
        const [services, doctors] = await Promise.all([
            dto.serviceIds !== undefined ? this.resolveServices(dto.serviceIds) : Promise.resolve(cabinet.services || []),
            dto.doctorIds !== undefined ? this.resolveDoctors(dto.doctorIds) : Promise.resolve((cabinet.doctorAssignments || []).map((item) => item.doctor)),
        ]);

        await this.ensureCabinetNameUnique(nextName, cabinetId);

        cabinet.name = nextName;
        cabinet.description = dto.description !== undefined ? this.normalizeDescription(dto.description) : cabinet.description;
        cabinet.isActive = dto.isActive !== undefined ? dto.isActive : cabinet.isActive;
        cabinet.services = services;

        await this.cabinetRepository.save(cabinet);
        await this.syncChildren(cabinet, devicesInput, doctors);

        const saved = await this.getCabinetOrThrow(cabinet.id);
        return { cabinet: this.mapCabinet(saved) };
    }

    async toggleActive(currentUserId: string, cabinetId: string) {
        await this.ensureManagerAccess(currentUserId);

        const cabinet = await this.getCabinetOrThrow(cabinetId);
        cabinet.isActive = !cabinet.isActive;
        await this.cabinetRepository.save(cabinet);

        return {
            cabinet: this.mapCabinet(await this.getCabinetOrThrow(cabinet.id)),
        };
    }

    async remove(currentUserId: string, cabinetId: string) {
        await this.ensureManagerAccess(currentUserId);

        const cabinet = await this.getCabinetOrThrow(cabinetId);
        await this.cabinetRepository.remove(cabinet);

        return {
            ok: true,
            id: cabinetId,
        };
    }
}
