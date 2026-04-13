import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { PatientService } from '../patient/patient.service';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';
import { CreateGuestAppointmentDto } from './dto/create-guest-appointment.dto';
import { CreateAuthenticatedAppointmentDto } from './dto/create-authenticated-appointment.dto';
import { UserService } from '../user/user.service';
import { ServicesService } from '../services/services.service';
import { Video } from '../video/entities/video.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';
import { GetSmartAppointmentPlanDto } from './dto/get-smart-appointment-plan.dto';
import { Doctor } from '../doctor/entities/doctor.entity';
import {PaymentStatus} from "../common/enums/payment-status.enum";
import { MailService } from '../mail/mail.service';
import {CreatePaidGooglePayTestBookingDto} from "./dto/create-paid-google-pay-test-booking.dto";
import {PaymentMethod} from "../common/enums/payment-method.enum";
import {Patient} from "../patient/entities/patient.entity";
import { NotFoundException } from '@nestjs/common';
import { AdminCancelAppointmentDto } from './dto/admin-cancel-appointment.dto';
import { AdminRescheduleAppointmentDto } from './dto/admin-reschedule-appointment.dto';
import { AdminRefundAppointmentDto } from './dto/admin-refund-appointment.dto';




type JwtUser = {
    id: string;
    email: string;
    role: UserRole;
    patientId: string | null;
};

@Injectable()
export class AppointmentService {
    constructor(
        @InjectRepository(Appointment)
        private readonly appointmentRepository: Repository<Appointment>,
        @InjectRepository(Video)
        private readonly videoRepository: Repository<Video>,
        @InjectRepository(ClinicServiceEntity)
        private readonly clinicServiceRepository: Repository<ClinicServiceEntity>,
        @InjectRepository(Doctor)
        private readonly doctorRepository: Repository<Doctor>,
        private readonly patientService: PatientService,
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly userService: UserService,
        private readonly servicesService: ServicesService,
        private readonly doctorScheduleService: DoctorScheduleService,
        private readonly mailService: MailService,
        @InjectRepository(Patient)
        private readonly patientRepository: Repository<Patient>,
    ) {}

    private parseAppointmentDateOrThrow(raw: string): Date {
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('Невірна дата запису');
        }
        return date;
    }

    private async ensureScheduleAllowsBooking(
        doctorId: string,
        serviceId: string,
        appointmentDateRaw: string,
    ) {
        const service = await this.clinicServiceRepository.findOne({ where: { id: serviceId } });
        if (!service) throw new BadRequestException('Послугу не знайдено');

        const appointmentDate = this.parseAppointmentDateOrThrow(appointmentDateRaw);

        await this.doctorScheduleService.ensureSlotAvailableForBooking(
            doctorId,
            appointmentDate,
            Number(service.durationMinutes) || 20,
        );
    }

    async createGuestAppointment(dto: CreateGuestAppointmentDto) {
        await this.phoneVerificationService.ensureVerified(
            dto.phoneVerificationSessionId,
            dto.phone,
        );

        await this.servicesService.ensureBookable(dto.serviceId, dto.doctorId);
        await this.ensureScheduleAllowsBooking(dto.doctorId, dto.serviceId, dto.appointmentDate);

        const patient = await this.resolvePatientByPhoneOrCreate({
            lastName: dto.lastName,
            firstName: dto.firstName,
            middleName: dto.middleName || null,
            phone: dto.phone,
        });

        const service = await this.clinicServiceRepository.findOne({
            where: { id: dto.serviceId },
        });

        const appointment = this.appointmentRepository.create({
            patient,
            doctorId: dto.doctorId || null,
            serviceId: dto.serviceId || null,
            appointmentDate: dto.appointmentDate ? new Date(dto.appointmentDate) : null,
            status: 'BOOKED',
            source: 'GUEST',
            recordingCompleted: false,
            recordingCompletedAt: null,
            paymentStatus: PaymentStatus.PENDING,
            paymentMethod: null,
            paymentProvider: null,
            paymentReference: null,
            paidAmountUah: service ? Number(service.priceUah || 0) : null,
            paidAt: null,
            receiptNumber: null,
        });

        const savedAppointment = await this.appointmentRepository.save(appointment);

        if (patient.email) {
            const appointmentLines = await this.buildAppointmentLines([
                {
                    serviceId: dto.serviceId,
                    doctorId: dto.doctorId,
                    appointmentDate: dto.appointmentDate,
                },
            ]);

            await this.mailService.sendPaidAppointmentConfirmation({
                to: patient.email,
                patientName: this.buildPatientDisplayName(patient),
                appointmentDate: savedAppointment.appointmentDate,
                amountUah: Number(service?.priceUah || 0),
                appointmentLines,
                receiptNumber: `ORADENT-OFFLINE-${Date.now()}`,
            });
        }

        return {
            ok: true,
            message: 'Гостьовий запис на прийом успішно створено',
            appointment: savedAppointment,
            patient: {
                id: patient.id,
                lastName: patient.lastName,
                firstName: patient.firstName,
                middleName: patient.middleName,
                phone: patient.phone,
                email: patient.email ?? null,
            },
        };
    }

    private buildPatientDisplayName(patient: {
        lastName: string;
        firstName: string;
        middleName?: string | null;
    }) {
        return `${patient.lastName} ${patient.firstName}${patient.middleName ? ` ${patient.middleName}` : ''}`
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizePhone(phone?: string | null) {
        return (phone || '').trim().replace(/\s+/g, '');
    }

    private async resolvePatientByPhoneOrCreate(params: {
        lastName: string;
        firstName: string;
        middleName?: string | null;
        phone: string;
    }) {
        const normalizedPhone = this.normalizePhone(params.phone);

        let patient = await this.patientRepository.findOne({
            where: { phone: normalizedPhone },
        });

        if (!patient) {
            patient = this.patientRepository.create({
                lastName: params.lastName.trim(),
                firstName: params.firstName.trim(),
                middleName: params.middleName?.trim() || null,
                phone: normalizedPhone,
                email: null,
                phoneVerified: false,
            });

            patient = await this.patientRepository.save(patient);
            return patient;
        }

        const existingEmail = patient.email || null;

        patient.lastName = params.lastName.trim();
        patient.firstName = params.firstName.trim();
        patient.middleName = params.middleName?.trim() || null;
        patient.phone = normalizedPhone;

        if (existingEmail) {
            patient.email = existingEmail;
        }

        return await this.patientRepository.save(patient);
    }

    private async resolveBookingPatientForAuthenticated(
        userId: string,
        payload?: {
            lastName?: string;
            firstName?: string;
            middleName?: string;
            phone?: string;
        },
    ) {
        const user = await this.userService.findById(userId);

        if (!user) {
            throw new BadRequestException('Користувача не знайдено');
        }

        const isManagerActor =
            user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;

        if (!isManagerActor) {
            if (!user.patient) {
                throw new BadRequestException('Пацієнта не знайдено');
            }

            return user.patient;
        }

        if (!payload?.lastName?.trim() || !payload?.firstName?.trim() || !payload?.phone?.trim()) {
            throw new BadRequestException("Для запису пацієнта заповніть прізвище, ім'я та телефон");
        }

        return await this.resolvePatientByPhoneOrCreate({
            lastName: payload.lastName,
            firstName: payload.firstName,
            middleName: payload.middleName || null,
            phone: payload.phone,
        });
    }

    private async buildAppointmentLines(
        steps: Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
        }>,
    ) {
        return await Promise.all(
            steps.map(async (step) => {
                const [service, doctor] = await Promise.all([
                    this.clinicServiceRepository.findOne({
                        where: { id: step.serviceId },
                    }),
                    this.doctorRepository.findOne({
                        where: [
                            { id: step.doctorId },
                            { user: { id: step.doctorId } },
                        ],
                        relations: ['user'],
                    }),
                ]);

                const serviceName =
                    this.parseDbI18nValueBackend(service?.name, 'ua') || 'Послуга';

                const doctorName = doctor
                    ? this.getDoctorDisplayName(doctor)
                    : 'Лікар не вказаний';

                const formattedDate = new Date(step.appointmentDate).toLocaleString('uk-UA', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                });

                return `${serviceName} — ${formattedDate} — ${doctorName}`;
            }),
        );
    }

    async createAuthenticatedAppointment(
        userId: string,
        dto: CreateAuthenticatedAppointmentDto,
    ) {
        const user = await this.userService.findById(userId);

        if (!user || !user.patient) {
            throw new BadRequestException('Пацієнта не знайдено');
        }

        const patient = user.patient;

        if (!patient.phoneVerified) {
            if (!patient.phone) {
                throw new BadRequestException('У профілі пацієнта відсутній номер телефону');
            }

            if (!dto.phoneVerificationSessionId) {
                throw new BadRequestException('Потрібно один раз підтвердити номер телефону');
            }

            await this.phoneVerificationService.ensureVerified(
                dto.phoneVerificationSessionId,
                patient.phone,
            );

            patient.phoneVerified = true;
            await this.patientService.save(patient);
        }

        if (!dto.doctorId || !dto.serviceId || !dto.appointmentDate) {
            throw new BadRequestException('Потрібно заповнити лікаря, послугу і дату запису');
        }

        await this.servicesService.ensureBookable(dto.serviceId, dto.doctorId);
        await this.ensureScheduleAllowsBooking(dto.doctorId, dto.serviceId, dto.appointmentDate);

        const appointment = this.appointmentRepository.create({
            patient,
            doctorId: dto.doctorId || null,
            serviceId: dto.serviceId || null,
            appointmentDate: dto.appointmentDate ? new Date(dto.appointmentDate) : null,
            status: 'BOOKED',
            source: 'AUTHENTICATED',
            recordingCompleted: false,
            recordingCompletedAt: null,
        });

        const savedAppointment = await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            message: 'Запис на прийом успішно створено',
            appointment: savedAppointment,
            patient: {
                id: patient.id,
                lastName: patient.lastName,
                firstName: patient.firstName,
                middleName: patient.middleName,
                phone: patient.phone,
                phoneVerified: patient.phoneVerified,
                paymentStatus: PaymentStatus.PENDING,
                paymentMethod: null,
                paymentProvider: null,
                paymentReference: null,
                paidAmountUah: null,
                paidAt: null,
                receiptNumber: null,
            },
        };
    }

    async completeRecording(appointmentId: string, actor: JwtUser) {
        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new BadRequestException('Запис на прийом не знайдено');
        }

        if (actor.role === UserRole.DOCTOR && appointment.doctorId !== actor.id) {
            throw new ForbiddenException('Цей прийом не належить поточному лікарю');
        }

        if (actor.role === UserRole.PATIENT) {
            throw new ForbiddenException('Пацієнт не може завершувати запис прийому');
        }

        const recordingsCount = await this.videoRepository.count({
            where: { appointmentId },
        });

        if (recordingsCount === 0) {
            throw new BadRequestException('Неможливо завершити запис без жодного відео');
        }

        appointment.recordingCompleted = true;
        appointment.recordingCompletedAt = new Date();

        const saved = await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            message: 'Запис прийому завершено',
            appointment: saved,
        };
    }

    async getAllAppointments() {
        return this.appointmentRepository.find({
            relations: ['patient'],
            order: { createdAt: 'DESC' },
        });
    }

    async findById(id: string) {
        const appointment = await this.appointmentRepository.findOne({
            where: { id },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new BadRequestException('Запис на прийом не знайдено');
        }

        return appointment;
    }

    private normalizePlanDate(raw?: string): Date {
        if (!raw) {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            return now;
        }

        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('Невірна preferredDate');
        }

        date.setHours(0, 0, 0, 0);
        return date;
    }

    private toDateKey(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private combineDateAndTime(dateKey: string, time: string): Date {
        return new Date(`${dateKey}T${time}:00`);
    }

    private addDays(date: Date, days: number): Date {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
    }

    private unique<T>(items: T[]): T[] {
        return [...new Set(items)];
    }

    private getServiceDuration(service: ClinicServiceEntity): number {
        const raw = Number(service.durationMinutes);
        if (!Number.isFinite(raw) || raw <= 0) return 20;
        return raw;
    }

    private getDoctorUserId(doctor: Doctor): string {
        return doctor.user?.id || doctor.id;
    }

    private getDoctorDisplayName(doctor: Doctor): string {
        const name = `${doctor.lastName ?? ''} ${doctor.firstName ?? ''} ${doctor.middleName ?? ''}`
            .replace(/\s+/g, ' ')
            .trim();

        return name || doctor.user?.email || doctor.id;
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

    private async getCandidateDoctorsForService(service: ClinicServiceEntity): Promise<Doctor[]> {
        const doctors = await this.doctorRepository.find({
            where: { isActive: true },
            relations: ['user'],
        });

        return doctors.filter((doctor) => this.doctorMatchesServiceBySpecialty(doctor, service));
    }

    private async getPlanServicesOrThrow(serviceIds: string[]): Promise<ClinicServiceEntity[]> {
        const ids = this.unique(serviceIds);

        const services = await this.clinicServiceRepository.find({
            where: ids.map((id) => ({ id })),
            relations: ['category', 'specialties'],
        });

        if (services.length !== ids.length) {
            const found = new Set(services.map((s) => s.id));
            const missing = ids.filter((id) => !found.has(id));
            throw new BadRequestException(`Не знайдено послуги: ${missing.join(', ')}`);
        }

        for (const service of services) {
            if (!service.isActive) {
                throw new BadRequestException(`Послуга неактивна: ${service.name}`);
            }

            if (!service.category?.isActive) {
                throw new BadRequestException(`Категорія послуги неактивна: ${service.name}`);
            }
        }

        return services.sort((a, b) => {
            const ao = Number(a.sortOrder || 0);
            const bo = Number(b.sortOrder || 0);
            if (ao !== bo) return ao - bo;
            return a.name.localeCompare(b.name);
        });
    }


    private generateReceiptNumber() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
        return `ORADENT-${y}${m}${d}-${rand}`;
    }

    private async findEarliestSlotForDoctor(
        doctorId: string,
        service: ClinicServiceEntity,
        preferredDate: Date,
        daysForward = 14,
    ) {
        const duration = this.getServiceDuration(service);

        for (let offset = 0; offset < daysForward; offset += 1) {
            const date = this.addDays(preferredDate, offset);
            const dateKey = this.toDateKey(date);

            const daily = await this.doctorScheduleService.getDay(doctorId, dateKey);
            if (!daily?.ok || !daily?.isWorking) continue;

            const preferredDateKey = this.toDateKey(preferredDate);
            const preferredMinute = preferredDate.getHours() * 60 + preferredDate.getMinutes();

            const freeSlots = (daily.slots || []).filter(
                (slot: { time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }) => {
                    if (slot.state !== 'FREE') return false;

                    if (dateKey !== preferredDateKey) {
                        return true;
                    }

                    const slotMinute =
                        Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3, 5));

                    return slotMinute >= preferredMinute;
                },
            );

            const slotMinutes = Number(daily.slotMinutes || 20);
            const needed = Math.max(1, Math.ceil(duration / slotMinutes));

            for (let i = 0; i < freeSlots.length; i += 1) {
                const startTime = freeSlots[i].time;
                const startMinute =
                    Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));

                let ok = true;

                for (let step = 0; step < needed; step += 1) {
                    const hh = Math.floor((startMinute + step * slotMinutes) / 60)
                        .toString()
                        .padStart(2, '0');
                    const mm = ((startMinute + step * slotMinutes) % 60)
                        .toString()
                        .padStart(2, '0');
                    const expected = `${hh}:${mm}`;

                    const exists = freeSlots.some(
                        (slot: { time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }) =>
                            slot.time === expected,
                    );

                    if (!exists) {
                        ok = false;
                        break;
                    }
                }

                if (!ok) continue;

                return {
                    doctorId,
                    dateKey,
                    startTime,
                    startAt: this.combineDateAndTime(dateKey, startTime),
                    durationMinutes: duration,
                    endAt: new Date(
                        this.combineDateAndTime(dateKey, startTime).getTime() +
                        duration * 60 * 1000,
                    ),
                };
            }
        }

        return null;
    }


    async createOfflineBooking(
        userId: string,
        dto: {
            steps: Array<{
                serviceId: string;
                doctorId: string;
                appointmentDate: string;
            }>;
            paymentMethod?: 'CASH';
            phoneVerificationSessionId?: string;
            lastName?: string;
            firstName?: string;
            middleName?: string;
            phone?: string;
        },
    ) {
        const patient = await this.resolveBookingPatientForAuthenticated(userId, {
            lastName: dto.lastName,
            firstName: dto.firstName,
            middleName: dto.middleName,
            phone: dto.phone,
        });

        if (!dto.steps?.length) {
            throw new BadRequestException('Не передано жодного кроку запису');
        }

        const uniqueServiceIds = [...new Set(dto.steps.map((step) => step.serviceId))];

        const services = await this.clinicServiceRepository.find({
            where: uniqueServiceIds.map((id) => ({ id })),
        });

        const servicesMap = new Map(
            services.map((service) => [
                service.id,
                {
                    durationMinutes: Number(service.durationMinutes || 0),
                    priceUah: Number(service.priceUah || 0),
                },
            ]),
        );

        for (const step of dto.steps) {
            await this.servicesService.ensureBookable(step.serviceId, step.doctorId);
            await this.ensureScheduleAllowsBooking(step.doctorId, step.serviceId, step.appointmentDate);
        }

        const groupedSteps = this.normalizeGroupedSteps(dto.steps, servicesMap);
        const createdAppointments: Appointment[] = [];

        for (const group of groupedSteps) {
            const firstStep = group[0];

            const groupAmount = group.reduce((sum, step) => {
                return sum + Number(servicesMap.get(step.serviceId)?.priceUah || 0);
            }, 0);

            const appointment = this.createAppointmentEntity({
                patient,
                doctorId: firstStep.doctorId,
                serviceId: firstStep.serviceId,
                appointmentDate: new Date(firstStep.appointmentDate),
                status: 'BOOKED',
                source: 'AUTHENTICATED',
                recordingCompleted: false,
                recordingCompletedAt: null,
                paymentStatus: PaymentStatus.PENDING,
                paymentMethod: PaymentMethod.CASH,
                paymentProvider: null,
                paymentReference: null,
                paidAmountUah: groupAmount,
                paidAt: null,
                receiptNumber: null,
            });

            const saved = await this.appointmentRepository.save(appointment);
            createdAppointments.push(saved);
        }

        if (patient.email) {
            const appointmentLines = await this.buildAppointmentLines(groupedSteps.flat());

            await this.mailService.sendPaidAppointmentConfirmation({
                to: patient.email,
                patientName: this.buildPatientDisplayName(patient),
                appointmentDate: createdAppointments[0]?.appointmentDate || null,
                amountUah: createdAppointments.reduce((sum, item) => sum + Number(item.paidAmountUah || 0), 0),
                appointmentLines,
                receiptNumber: `ORADENT-OFFLINE-${Date.now()}`,
            });
        }

        return {
            ok: true,
            message: 'Запис успішно створено',
            appointments: createdAppointments,
            groupedSteps,
        };
    }



    async getMyAppointments(userId: string) {
        const user = await this.userService.findById(userId);

        if (!user) {
            throw new BadRequestException('Користувача не знайдено');
        }

        if (!user.patient) {
            return {
                ok: true,
                active: [],
                completed: [],
            };
        }

        const appointments = await this.appointmentRepository.find({
            where: {
                patient: { id: user.patient.id },
            },
            relations: ['patient'],
            order: {
                appointmentDate: 'DESC',
                createdAt: 'DESC',
            },
        });

        const mapped = await Promise.all(
            appointments.map(async (item) => {
                const service = item.serviceId
                    ? await this.clinicServiceRepository.findOne({
                        where: { id: item.serviceId },
                    })
                    : null;

                const doctor = item.doctorId
                    ? await this.doctorRepository.findOne({
                        where: [
                            { id: item.doctorId },
                            { user: { id: item.doctorId } },
                        ],
                        relations: ['user'],
                    })
                    : null;

                const doctorName = doctor
                    ? `${doctor.lastName ?? ''} ${doctor.firstName ?? ''} ${doctor.middleName ?? ''}`
                        .replace(/\s+/g, ' ')
                        .trim()
                    : null;

                return {
                    id: item.id,
                    patientId: item.patient?.id ?? undefined,
                    doctorId: item.doctorId,
                    doctorName,
                    serviceId: item.serviceId,
                    serviceName: service?.name || null,
                    appointmentDate: item.appointmentDate,
                    status: item.status,
                    source: item.source,
                    recordingCompleted: item.recordingCompleted,
                    recordingCompletedAt: item.recordingCompletedAt,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    paymentStatus: (item as any).paymentStatus ?? 'PENDING',
                    paymentMethod: (item as any).paymentMethod ?? null,
                    paidAmountUah:
                        (item as any).paidAmountUah ??
                        (service ? Number(service.priceUah) : null),
                    receiptNumber: (item as any).receiptNumber ?? null,
                    canPayNow: ((item as any).paymentStatus ?? 'PENDING') !== 'PAID',
                };
            }),
        );

        const now = new Date();

        const active = mapped.filter((item) => {
            if (!item.appointmentDate) return false;
            const appointmentDate = new Date(item.appointmentDate);
            return (
                appointmentDate >= now &&
                item.status !== 'COMPLETED' &&
                item.status !== 'CANCELLED'
            );
        });

        const completed = mapped.filter((item) => {
            if (!item.appointmentDate) return true;
            const appointmentDate = new Date(item.appointmentDate);
            return (
                appointmentDate < now ||
                item.status === 'COMPLETED' ||
                item.status === 'CANCELLED'
            );
        });

        return {
            ok: true,
            active,
            completed,
        };
    }


    private async buildSameDoctorPlan(
        services: ClinicServiceEntity[],
        preferredDate: Date,
        forcedDoctorId?: string,
    ) {
        let doctorPool: Doctor[] = [];

        if (forcedDoctorId) {
            const forcedDoctor = await this.doctorRepository.findOne({
                where: [
                    { id: forcedDoctorId, isActive: true },
                    { user: { id: forcedDoctorId }, isActive: true },
                ],
                relations: ['user'],
            });

            doctorPool = forcedDoctor ? [forcedDoctor] : [];
        } else {
            const allDoctors = await this.doctorRepository.find({
                where: { isActive: true },
                relations: ['user'],
            });

            doctorPool = allDoctors.filter((doctor) =>
                services.every((service) => this.doctorMatchesServiceBySpecialty(doctor, service)),
            );
        }

        for (const doctor of doctorPool) {
            const doctorUserId = this.getDoctorUserId(doctor);

            const steps: Array<{
                serviceId: string;
                serviceName: string;
                doctorId: string;
                doctorName: string;
                startAt: Date;
                endAt: Date;
                durationMinutes: number;
            }> = [];

            let currentDate = preferredDate;
            let valid = true;

            for (const service of services) {
                const slot = await this.findEarliestSlotForDoctor(
                    doctorUserId,
                    service,
                    currentDate,
                );

                if (!slot) {
                    valid = false;
                    break;
                }

                steps.push({
                    serviceId: service.id,
                    serviceName: service.name,
                    doctorId: doctorUserId,
                    doctorName: this.getDoctorDisplayName(doctor),
                    startAt: slot.startAt,
                    endAt: slot.endAt,
                    durationMinutes: slot.durationMinutes,
                });

                currentDate = new Date(slot.endAt);
            }

            if (!valid || steps.length !== services.length) continue;

            return {
                strategy: 'same-doctor',
                sameDoctor: true,
                doctorIds: [doctorUserId],
                totalDurationMinutes: steps.reduce((sum, step) => sum + step.durationMinutes, 0),
                startAt: steps[0].startAt,
                endAt: steps[steps.length - 1].endAt,
                steps,
            };
        }

        return null;
    }

    private async buildEarliestMixedPlan(
        services: ClinicServiceEntity[],
        preferredDate: Date,
        forcedDoctorId?: string,
    ) {
        const steps: Array<{
            serviceId: string;
            serviceName: string;
            doctorId: string;
            doctorName: string;
            startAt: Date;
            endAt: Date;
            durationMinutes: number;
        }> = [];

        let currentDate = preferredDate;

        for (const service of services) {
            let doctorPool: Doctor[] = [];

            if (forcedDoctorId) {
                const forcedDoctor = await this.doctorRepository.findOne({
                    where: [
                        { id: forcedDoctorId, isActive: true },
                        { user: { id: forcedDoctorId }, isActive: true },
                    ],
                    relations: ['user'],
                });

                doctorPool =
                    forcedDoctor && this.doctorMatchesServiceBySpecialty(forcedDoctor, service)
                        ? [forcedDoctor]
                        : [];
            } else {
                doctorPool = await this.getCandidateDoctorsForService(service);
            }

            let best: {
                doctor: Doctor;
                startAt: Date;
                endAt: Date;
                durationMinutes: number;
            } | null = null;

            for (const doctor of doctorPool) {
                const doctorUserId = this.getDoctorUserId(doctor);
                const slot = await this.findEarliestSlotForDoctor(
                    doctorUserId,
                    service,
                    currentDate,
                );

                if (!slot) continue;

                if (!best || slot.startAt < best.startAt) {
                    best = {
                        doctor,
                        startAt: slot.startAt,
                        endAt: slot.endAt,
                        durationMinutes: slot.durationMinutes,
                    };
                }
            }

            if (!best) {
                return null;
            }

            steps.push({
                serviceId: service.id,
                serviceName: service.name,
                doctorId: this.getDoctorUserId(best.doctor),
                doctorName: this.getDoctorDisplayName(best.doctor),
                startAt: best.startAt,
                endAt: best.endAt,
                durationMinutes: best.durationMinutes,
            });

            currentDate = new Date(best.endAt);
        }

        return {
            strategy: 'mixed-doctors',
            sameDoctor: this.unique(steps.map((step) => step.doctorId)).length === 1,
            doctorIds: this.unique(steps.map((step) => step.doctorId)),
            totalDurationMinutes: steps.reduce((sum, step) => sum + step.durationMinutes, 0),
            startAt: steps[0].startAt,
            endAt: steps[steps.length - 1].endAt,
            steps,
        };
    }



    async payMyAppointmentGooglePayTest(
        userId: string,
        appointmentId: string,
        body: {
            googleTransactionId?: string;
            googlePaymentToken?: string;
        },
    ) {
        const user = await this.userService.findById(userId);

        if (!user || !user.patient) {
            throw new BadRequestException('Пацієнта не знайдено');
        }

        const appointment = await this.appointmentRepository.findOne({
            where: {
                id: appointmentId,
                patient: { id: user.patient.id },
            },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new BadRequestException('Запис на прийом не знайдено');
        }

        if (appointment.paymentStatus === PaymentStatus.PAID) {
            return {
                ok: true,
                message: 'Запис уже оплачено',
                appointment,
            };
        }

        const service = appointment.serviceId
            ? await this.clinicServiceRepository.findOne({
                where: { id: appointment.serviceId },
            })
            : null;

        const doctor = appointment.doctorId
            ? await this.doctorRepository.findOne({
                where: [{ id: appointment.doctorId }],
                relations: ['user'],
            })
            : null;

        appointment.paymentStatus = PaymentStatus.PAID;
        appointment.paymentMethod = PaymentMethod.GOOGLE_PAY;
        appointment.paymentProvider = 'GOOGLE_PAY_TEST';
        appointment.paymentReference =
            body.googleTransactionId ||
            body.googlePaymentToken ||
            `gpay-test-${Date.now()}`;
        appointment.paidAt = new Date();
        appointment.paidAmountUah = service ? Number(service.priceUah || 0) : 0;
        appointment.receiptNumber =
            appointment.receiptNumber || this.generateReceiptNumber();

        const saved = await this.appointmentRepository.save(appointment);

        if (user.patient.email) {
            const serviceName = service?.name || 'Послуга';
            const doctorName = doctor
                ? this.getDoctorDisplayName(doctor)
                : 'Лікар не вказаний';

            const appointmentLines = [
                `${serviceName} — ${new Date(saved.appointmentDate || new Date()).toLocaleString('uk-UA', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                })} — ${doctorName}`,
            ];

            await this.mailService.sendPaidAppointmentConfirmation({
                to: user.patient.email,
                patientName: `${user.patient.lastName} ${user.patient.firstName}${
                    user.patient.middleName ? ` ${user.patient.middleName}` : ''
                }`.trim(),
                appointmentDate: saved.appointmentDate,
                amountUah: Number(saved.paidAmountUah || 0),
                appointmentLines,
                receiptNumber: saved.receiptNumber || '',
            });
        }

        return {
            ok: true,
            message: 'Оплату успішно підтверджено',
            appointment: saved,
        };
    }


    async getSmartAppointmentPlan(
        userId: string | null,
        dto: GetSmartAppointmentPlanDto,
    ) {
        if (userId) {
            const user = await this.userService.findById(userId);

            if (!user) {
                throw new BadRequestException('Користувача не знайдено');
            }
        }

        const preferredDate = this.normalizePlanDate(dto.preferredDate);
        const services = await this.getPlanServicesOrThrow(dto.serviceIds);

        const plans: any[] = [];
        let rejectionReason = '';

        if ((dto.mode || 'same-doctor-first') === 'same-doctor-first') {
            const sameDoctorPlan = await this.buildSameDoctorPlan(
                services,
                preferredDate,
                dto.doctorId,
            );

            if (sameDoctorPlan) {
                plans.push(sameDoctorPlan);
            }

            const mixedPlan = await this.buildEarliestMixedPlan(
                services,
                preferredDate,
                dto.doctorId,
            );

            if (mixedPlan) {
                const duplicate =
                    sameDoctorPlan &&
                    JSON.stringify(
                        sameDoctorPlan.steps.map((s: any) => [
                            s.serviceId,
                            s.doctorId,
                            s.startAt,
                        ]),
                    ) ===
                    JSON.stringify(
                        mixedPlan.steps.map((s: any) => [
                            s.serviceId,
                            s.doctorId,
                            s.startAt,
                        ]),
                    );

                if (!duplicate) {
                    plans.push(mixedPlan);
                }
            }
        } else {
            const mixedPlan = await this.buildEarliestMixedPlan(
                services,
                preferredDate,
                dto.doctorId,
            );

            if (mixedPlan) {
                plans.push(mixedPlan);
            }

            const sameDoctorPlan = await this.buildSameDoctorPlan(
                services,
                preferredDate,
                dto.doctorId,
            );

            if (sameDoctorPlan) {
                const duplicate =
                    mixedPlan &&
                    JSON.stringify(
                        mixedPlan.steps.map((s: any) => [
                            s.serviceId,
                            s.doctorId,
                            s.startAt,
                        ]),
                    ) ===
                    JSON.stringify(
                        sameDoctorPlan.steps.map((s: any) => [
                            s.serviceId,
                            s.doctorId,
                            s.startAt,
                        ]),
                    );

                if (!duplicate) {
                    plans.push(sameDoctorPlan);
                }
            }
        }

        if (plans.length === 0) {
            const servicesWithoutSpecialties = services.filter(
                (service) =>
                    !Array.isArray(service.specialties) || service.specialties.length === 0,
            );

            if (servicesWithoutSpecialties.length > 0) {
                rejectionReason =
                    'Деякі послуги не прив’язані до жодної спеціальності.';
            } else {
                rejectionReason =
                    'Не знайдено доступних лікарів або вільних слотів у найближчі 14 днів для вибраних послуг.';
            }
        }

        return {
            ok: true,
            preferredDate: this.toDateKey(preferredDate),
            requestedServiceIds: dto.serviceIds,
            rejectionReason,
            plans,
        };
    }



    private addMinutes(date: Date, minutes: number): Date {
        return new Date(date.getTime() + minutes * 60 * 1000);
    }

    private normalizeGroupedSteps(
        steps: Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
        }>,
        servicesMap: Map<string, { durationMinutes: number }>,
    ) {
        const sorted = [...steps].sort(
            (a, b) =>
                new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime(),
        );

        const groups: Array<
            Array<{
                serviceId: string;
                doctorId: string;
                appointmentDate: string;
            }>
        > = [];

        for (const step of sorted) {
            const currentStart = new Date(step.appointmentDate);

            if (!groups.length) {
                groups.push([step]);
                continue;
            }

            const lastGroup = groups[groups.length - 1];
            const prevStep = lastGroup[lastGroup.length - 1];

            const prevStart = new Date(prevStep.appointmentDate);
            const prevDuration = Number(
                servicesMap.get(prevStep.serviceId)?.durationMinutes || 0,
            );
            const prevEnd = this.addMinutes(prevStart, prevDuration);

            const sameDoctor = prevStep.doctorId === step.doctorId;
            const contiguous = prevEnd.getTime() === currentStart.getTime();

            if (sameDoctor && contiguous) {
                lastGroup.push(step);
            } else {
                groups.push([step]);
            }
        }

        return groups;
    }

    private createAppointmentEntity(data: DeepPartial<Appointment>): Appointment {
        return this.appointmentRepository.create(data) as Appointment;
    }


    async createGuestSmartBooking(body: {
        lastName: string;
        firstName: string;
        middleName?: string;
        phone: string;
        phoneVerificationSessionId: string;
        steps: Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
        }>;
        paymentMethod?: 'CASH';
    }) {
        if (!body.steps?.length) {
            throw new BadRequestException('Не передано жодного кроку запису');
        }

        const phone = body.phone.trim();

        await this.phoneVerificationService.ensureVerified(
            body.phoneVerificationSessionId,
            phone,
        );

        const patient = await this.resolvePatientByPhoneOrCreate({
            lastName: body.lastName,
            firstName: body.firstName,
            middleName: body.middleName || null,
            phone,
        });

        const uniqueServiceIds = [...new Set(body.steps.map((step) => step.serviceId))];

        const services = await this.clinicServiceRepository.find({
            where: uniqueServiceIds.map((id) => ({ id })),
        });

        const servicesMap = new Map(
            services.map((service) => [
                service.id,
                {
                    durationMinutes: Number(service.durationMinutes || 0),
                    priceUah: Number(service.priceUah || 0),
                },
            ]),
        );

        for (const step of body.steps) {
            await this.servicesService.ensureBookable(step.serviceId, step.doctorId);
            await this.ensureScheduleAllowsBooking(
                step.doctorId,
                step.serviceId,
                step.appointmentDate,
            );
        }

        const groupedSteps = this.normalizeGroupedSteps(body.steps, servicesMap);
        const createdAppointments: Appointment[] = [];

        for (const group of groupedSteps) {
            const firstStep = group[0];

            const groupAmount = group.reduce((sum, step) => {
                return sum + Number(servicesMap.get(step.serviceId)?.priceUah || 0);
            }, 0);

            const entity = this.createAppointmentEntity({
                patient,
                doctorId: firstStep.doctorId,
                serviceId: firstStep.serviceId,
                appointmentDate: new Date(firstStep.appointmentDate),
                status: 'BOOKED',
                source: 'GUEST',
                recordingCompleted: false,
                recordingCompletedAt: null,
                paymentStatus: PaymentStatus.PENDING,
                paymentMethod: PaymentMethod.CASH,
                paymentProvider: null,
                paymentReference: null,
                paidAmountUah: groupAmount,
                paidAt: null,
                receiptNumber: null,
            });

            const savedEntity = await this.appointmentRepository.save(entity);
            createdAppointments.push(savedEntity);
        }

        if (patient.email) {
            const appointmentLines = await this.buildAppointmentLines(groupedSteps.flat());

            await this.mailService.sendPaidAppointmentConfirmation({
                to: patient.email,
                patientName: this.buildPatientDisplayName(patient),
                appointmentDate: createdAppointments[0]?.appointmentDate || null,
                amountUah: createdAppointments.reduce(
                    (sum, item) => sum + Number(item.paidAmountUah || 0),
                    0,
                ),
                appointmentLines,
                receiptNumber: `ORADENT-OFFLINE-${Date.now()}`,
            });
        }

        return {
            ok: true,
            message: 'Гостьовий запис успішно створено',
            appointments: createdAppointments,
            groupedSteps,
        };
    }

    async createPaidGooglePayTestGuestBooking(body: {
        lastName: string;
        firstName: string;
        middleName?: string;
        phone: string;
        phoneVerificationSessionId: string;
        steps: Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
        }>;
        googleTransactionId?: string;
        googlePaymentToken?: string;
        paymentMethod?: 'GOOGLE_PAY';
    }) {
        if (!body.steps?.length) {
            throw new BadRequestException('Не передано жодного кроку запису');
        }

        const phone = body.phone.trim();

        await this.phoneVerificationService.ensureVerified(
            body.phoneVerificationSessionId,
            phone,
        );

        const patient = await this.resolvePatientByPhoneOrCreate({
            lastName: body.lastName,
            firstName: body.firstName,
            middleName: body.middleName || null,
            phone,
        });

        const uniqueServiceIds = [...new Set(body.steps.map((step) => step.serviceId))];

        const services = await this.clinicServiceRepository.find({
            where: uniqueServiceIds.map((id) => ({ id })),
        });

        const servicesMap = new Map(
            services.map((service) => [
                service.id,
                {
                    name: service.name,
                    durationMinutes: Number(service.durationMinutes || 0),
                    priceUah: Number(service.priceUah || 0),
                },
            ]),
        );

        for (const step of body.steps) {
            await this.servicesService.ensureBookable(step.serviceId, step.doctorId);
            await this.ensureScheduleAllowsBooking(
                step.doctorId,
                step.serviceId,
                step.appointmentDate,
            );
        }

        const groupedSteps = this.normalizeGroupedSteps(body.steps, servicesMap);
        const createdAppointments: Appointment[] = [];

        const paymentReference =
            body.googleTransactionId ||
            body.googlePaymentToken ||
            `gpay-test-${Date.now()}`;

        const receiptNumber = this.generateReceiptNumber();

        for (const group of groupedSteps) {
            const firstStep = group[0];

            const groupAmount = group.reduce((sum, step) => {
                return sum + Number(servicesMap.get(step.serviceId)?.priceUah || 0);
            }, 0);

            const entity = this.createAppointmentEntity({
                patient,
                doctorId: firstStep.doctorId,
                serviceId: firstStep.serviceId,
                appointmentDate: new Date(firstStep.appointmentDate),
                status: 'BOOKED',
                source: 'GUEST',
                recordingCompleted: false,
                recordingCompletedAt: null,
                paymentStatus: PaymentStatus.PAID,
                paymentMethod: PaymentMethod.GOOGLE_PAY,
                paymentProvider: 'GOOGLE_PAY_TEST',
                paymentReference,
                paidAmountUah: groupAmount,
                paidAt: new Date(),
                receiptNumber,
            });

            const savedEntity = await this.appointmentRepository.save(entity);
            createdAppointments.push(savedEntity);
        }

        if (patient.email) {
            const appointmentLines = await this.buildAppointmentLines(groupedSteps.flat());

            await this.mailService.sendPaidAppointmentConfirmation({
                to: patient.email,
                patientName: this.buildPatientDisplayName(patient),
                appointmentDate: createdAppointments[0]?.appointmentDate || null,
                amountUah: createdAppointments.reduce(
                    (sum, item) => sum + Number(item.paidAmountUah || 0),
                    0,
                ),
                appointmentLines,
                receiptNumber,
            });
        }

        return {
            ok: true,
            message: 'Запис успішно створено та оплачено',
            receiptNumber,
            appointments: createdAppointments,
            groupedSteps,
        };
    }


    private tryExtractDbI18nData(raw: unknown): Record<string, string> | null {
        if (!raw || typeof raw !== 'string') return null;

        const jsonStart = raw.indexOf('{');
        if (jsonStart === -1) return null;

        try {
            const parsed = JSON.parse(raw.slice(jsonStart));

            if (parsed && typeof parsed === 'object') {
                if (parsed.data && typeof parsed.data === 'object') {
                    return parsed.data as Record<string, string>;
                }

                return parsed as Record<string, string>;
            }

            return null;
        } catch {
            return null;
        }
    }

    private parseDbI18nValueBackend(raw: unknown, language = 'ua'): string {
        if (!raw) return '';

        if (typeof raw === 'object' && raw !== null) {
            const record = raw as Record<string, any>;

            if ('ua' in record || 'en' in record || 'de' in record || 'fr' in record) {
                return record[language] || record.ua || record.en || record.de || record.fr || '';
            }

            if ('i18n' in record && record.i18n) {
                const map = record.i18n as Record<string, string>;
                return map[language] || map.ua || map.en || map.de || map.fr || '';
            }

            if ('value' in record && typeof record.value === 'string') {
                return record.value;
            }

            if ('name' in record) {
                return this.parseDbI18nValueBackend(record.name, language);
            }

            if ('data' in record && record.data && typeof record.data === 'object') {
                return (
                    record.data[language] ||
                    record.data.ua ||
                    record.data.en ||
                    record.data.de ||
                    record.data.fr ||
                    ''
                );
            }

            return '';
        }

        if (typeof raw === 'string') {
            const extracted = this.tryExtractDbI18nData(raw);
            if (!extracted) {
                return raw;
            }

            return (
                extracted[language] ||
                extracted.ua ||
                extracted.en ||
                extracted.de ||
                extracted.fr ||
                raw
            );
        }

        return String(raw);
    }


    async createPaidGooglePayTestBooking(
        userId: string,
        dto: CreatePaidGooglePayTestBookingDto,
    ) {
        const patient = await this.resolveBookingPatientForAuthenticated(userId, {
            lastName: dto.lastName,
            firstName: dto.firstName,
            middleName: dto.middleName,
            phone: dto.phone,
        });

        if (!dto.steps?.length) {
            throw new BadRequestException('Не передано жодного кроку запису');
        }

        const uniqueServiceIds = [...new Set(dto.steps.map((step) => step.serviceId))];

        const services = await this.clinicServiceRepository.find({
            where: uniqueServiceIds.map((id) => ({ id })),
        });

        const servicesMap = new Map(
            services.map((service) => [
                service.id,
                {
                    name: service.name,
                    durationMinutes: Number(service.durationMinutes || 0),
                    priceUah: Number(service.priceUah || 0),
                },
            ]),
        );

        for (const step of dto.steps) {
            await this.servicesService.ensureBookable(step.serviceId, step.doctorId);
            await this.ensureScheduleAllowsBooking(step.doctorId, step.serviceId, step.appointmentDate);
        }

        const groupedSteps = this.normalizeGroupedSteps(dto.steps, servicesMap);
        const createdAppointments: Appointment[] = [];

        const paymentReference =
            dto.googleTransactionId ||
            dto.googlePaymentToken ||
            `gpay-test-${Date.now()}`;

        const receiptNumber = this.generateReceiptNumber();

        for (const group of groupedSteps) {
            const firstStep = group[0];

            const groupAmount = group.reduce((sum, step) => {
                return sum + Number(servicesMap.get(step.serviceId)?.priceUah || 0);
            }, 0);

            const appointment = this.createAppointmentEntity({
                patient,
                doctorId: firstStep.doctorId,
                serviceId: firstStep.serviceId,
                appointmentDate: new Date(firstStep.appointmentDate),
                status: 'BOOKED',
                source: 'AUTHENTICATED',
                recordingCompleted: false,
                recordingCompletedAt: null,
                paymentStatus: PaymentStatus.PAID,
                paymentMethod: dto.paymentMethod || PaymentMethod.GOOGLE_PAY,
                paymentProvider: 'GOOGLE_PAY_TEST',
                paymentReference,
                paidAmountUah: groupAmount,
                paidAt: new Date(),
                receiptNumber,
            });

            const saved = await this.appointmentRepository.save(appointment);
            createdAppointments.push(saved);
        }



        if (patient.email) {
            const appointmentLines = await this.buildAppointmentLines(groupedSteps.flat());

            await this.mailService.sendPaidAppointmentConfirmation({
                to: patient.email,
                patientName: this.buildPatientDisplayName(patient),
                appointmentDate: createdAppointments[0]?.appointmentDate || null,
                amountUah: createdAppointments.reduce((sum, item) => sum + Number(item.paidAmountUah || 0), 0),
                appointmentLines,
                receiptNumber,
            });
        }

        return {
            ok: true,
            message: 'Запис успішно створено та оплачено',
            receiptNumber,
            appointments: createdAppointments,
            groupedSteps,
        };
    }


    async getAdminPatientAppointments(userId: string, patientId: string) {
        const user = await this.userService.findById(userId);

        if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN)) {
            throw new ForbiddenException('Доступ дозволено лише для ADMIN та SUPER_ADMIN');
        }

        const appointments = await this.appointmentRepository.find({
            where: {
                patient: { id: patientId },
            },
            relations: ['patient'],
            order: {
                appointmentDate: 'DESC',
                createdAt: 'DESC',
            },
        });

        const mapped = await Promise.all(
            appointments.map(async (item) => {
                const service = item.serviceId
                    ? await this.clinicServiceRepository.findOne({
                        where: { id: item.serviceId },
                    })
                    : null;

                const doctor = item.doctorId
                    ? await this.doctorRepository.findOne({
                        where: [
                            { id: item.doctorId },
                            { user: { id: item.doctorId } },
                        ],
                        relations: ['user'],
                    })
                    : null;

                const doctorName = doctor
                    ? `${doctor.lastName ?? ''} ${doctor.firstName ?? ''} ${doctor.middleName ?? ''}`
                        .replace(/\s+/g, ' ')
                        .trim()
                    : null;

                return {
                    id: item.id,
                    patientId: item.patient?.id ?? undefined,
                    patient: item.patient
                        ? {
                            id: item.patient.id,
                            lastName: item.patient.lastName,
                            firstName: item.patient.firstName,
                            middleName: item.patient.middleName,
                            phone: item.patient.phone,
                            email: item.patient.email,
                        }
                        : undefined,
                    doctorId: item.doctorId,
                    doctorName,
                    serviceId: item.serviceId,
                    serviceName: service?.name || null,
                    appointmentDate: item.appointmentDate,
                    status: item.status,
                    source: item.source,
                    recordingCompleted: item.recordingCompleted,
                    recordingCompletedAt: item.recordingCompletedAt,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    paymentStatus: (item as any).paymentStatus ?? 'PENDING',
                    paymentMethod: (item as any).paymentMethod ?? null,
                    paidAmountUah:
                        (item as any).paidAmountUah ??
                        (service ? Number(service.priceUah) : null),
                    receiptNumber: (item as any).receiptNumber ?? null,
                    canPayNow: false,
                    refundStatus: (item as any).refundStatus ?? 'NONE',
                    refundRequestedAt: (item as any).refundRequestedAt ?? null,
                    refundedAt: (item as any).refundedAt ?? null,
                    refundAmountUah: (item as any).refundAmountUah ?? null,
                };
            }),
        );

        return {
            ok: true,
            appointments: mapped,
        };
    }

    private async ensureAdminOrSuperAdmin(userId: string) {
        const user = await this.userService.findById(userId);

        if (!user) {
            throw new ForbiddenException('Користувача не знайдено');
        }

        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException('Доступ дозволено лише для ADMIN та SUPER_ADMIN');
        }

        return user;
    }

    private async getAppointmentOrThrow(id: string) {
        const appointment = await this.appointmentRepository.findOne({
            where: { id },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new NotFoundException('Запис не знайдено');
        }

        return appointment;
    }


    async adminRefundAppointment(
        userId: string,
        id: string,
        dto: AdminRefundAppointmentDto,
    ) {
        const actor = await this.ensureAdminOrSuperAdmin(userId);
        const appointment = await this.getAppointmentOrThrow(id);

        if (appointment.paymentStatus !== 'PAID') {
            throw new BadRequestException('Повернення можливе лише для оплаченого запису');
        }

        const nextStatus = dto.refundStatus || 'PENDING';

        appointment.refundStatus = nextStatus;
        appointment.refundRequestedAt =
            nextStatus === 'PENDING'
                ? appointment.refundRequestedAt || new Date()
                : appointment.refundRequestedAt || null;

        appointment.refundedAt = nextStatus === 'REFUNDED' ? new Date() : null;
        appointment.refundAmountUah =
            (appointment as any).paidAmountUah != null
                ? Number((appointment as any).paidAmountUah)
                : appointment.refundAmountUah || null;
        appointment.refundReference = dto.refundReference?.trim() || appointment.refundReference || null;

        await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            message:
                nextStatus === 'PENDING'
                    ? 'Повернення позначено як очікуване'
                    : nextStatus === 'REFUNDED'
                        ? 'Повернення позначено як виконане'
                        : 'Повернення позначено як невдале',
            appointmentId: appointment.id,
            refundStatus: appointment.refundStatus,
            actorRole: actor.role,
        };
    }



    async adminCancelAppointment(
        userId: string,
        id: string,
        dto: AdminCancelAppointmentDto,
    ) {
        const actor = await this.ensureAdminOrSuperAdmin(userId);
        const appointment = await this.getAppointmentOrThrow(id);

        if (appointment.status === 'CANCELLED') {
            throw new BadRequestException('Запис уже скасовано');
        }

        if (
            appointment.paymentStatus === 'PAID' &&
            appointment.refundStatus !== 'REFUNDED'
        ) {
            throw new BadRequestException(
                'Не можна скасувати оплачений запис, поки не виконано повернення коштів',
            );
        }

        appointment.status = 'CANCELLED';
        appointment.cancelledAt = new Date();
        appointment.cancelReason = dto.reason?.trim() || null;
        appointment.cancelledByRole = actor.role;
        appointment.cancelledByUserId = userId;

        await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            message: 'Запис успішно скасовано',
            appointmentId: appointment.id,
            status: appointment.status,
        };
    }



    async adminRescheduleAppointment(
        userId: string,
        id: string,
        dto: AdminRescheduleAppointmentDto,
    ) {
        await this.ensureAdminOrSuperAdmin(userId);

        const appointment = await this.getAppointmentOrThrow(id);

        if (appointment.status === 'CANCELLED') {
            throw new BadRequestException('Скасований запис не можна перенести');
        }

        const nextDoctorId = (dto.doctorId || appointment.doctorId || '').trim();
        if (!nextDoctorId) {
            throw new BadRequestException('Не вдалося визначити лікаря для перенесення');
        }

        const nextDate = new Date(dto.appointmentDate);
        if (Number.isNaN(nextDate.getTime())) {
            throw new BadRequestException('Некоректна дата перенесення');
        }

        const service = appointment.serviceId
            ? await this.clinicServiceRepository.findOne({
                where: { id: appointment.serviceId },
            })
            : null;

        const durationMinutes = Number(service?.durationMinutes || 20);

        await this.doctorScheduleService.ensureSlotAvailableForBooking(
            nextDoctorId,
            nextDate,
            durationMinutes,
            appointment.id,
        );

        appointment.doctorId = nextDoctorId;
        appointment.appointmentDate = nextDate;

        await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            message: 'Запис успішно перенесено',
            appointmentId: appointment.id,
            appointmentDate: appointment.appointmentDate,
            doctorId: appointment.doctorId,
        };
    }

}