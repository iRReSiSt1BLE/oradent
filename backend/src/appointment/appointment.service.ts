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
import { Cabinet } from '../cabinet/entities/cabinet.entity';
import { NotFoundException } from '@nestjs/common';
import { AdminCancelAppointmentDto } from './dto/admin-cancel-appointment.dto';
import { AdminRescheduleAppointmentDto } from './dto/admin-reschedule-appointment.dto';
import { AdminRefundAppointmentDto } from './dto/admin-refund-appointment.dto';
import { VideoAccessGrant } from '../video/entities/video-access-grant.entity';
import * as argon2 from 'argon2';




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
        @InjectRepository(Cabinet)
        private readonly cabinetRepository: Repository<Cabinet>,
        @InjectRepository(VideoAccessGrant)
        private readonly videoAccessGrantRepository: Repository<VideoAccessGrant>,
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
        cabinetId?: string | null,
        excludeAppointmentId?: string,
    ) {
        return this.resolveBookingStep(doctorId, serviceId, appointmentDateRaw, {
            preferredCabinetId: cabinetId || null,
            excludeAppointmentId,
        });
    }

    private async getDoctorEntityByAnyId(doctorId: string) {
        return await this.doctorRepository.findOne({
            where: [
                { id: doctorId },
                { user: { id: doctorId } },
            ],
            relations: ['user'],
        });
    }
    private minutesToTime(totalMinutes: number): string {
        const normalized = Math.max(0, totalMinutes);
        const hours = Math.floor(normalized / 60)
            .toString()
            .padStart(2, '0');
        const minutes = (normalized % 60)
            .toString()
            .padStart(2, '0');

        return `${hours}:${minutes}`;
    }

    private async resolveDoctorByAnyId(ref: string | null | undefined) {
        if (!ref) return null;

        return await this.doctorRepository.findOne({
            where: [
                { id: ref },
                { user: { id: ref } },
            ],
            relations: ['user'],
        });
    }

    private async doctorOwnsAppointment(appointment: Appointment, actorUserId: string) {
        if (!appointment.doctorId) return false;

        if (appointment.doctorId === actorUserId) {
            return true;
        }

        const doctor = await this.resolveDoctorByAnyId(appointment.doctorId);
        if (!doctor) return false;

        return doctor.id === actorUserId || doctor.user?.id === actorUserId;
    }


    private async verifyActorPassword(userId: string, password: string) {
        const normalizedPassword = String(password || '');
        if (!normalizedPassword.trim()) {
            throw new ForbiddenException('Вкажіть пароль від акаунта');
        }

        const user = await this.userService.findById(userId);
        if (!user?.passwordHash) {
            throw new ForbiddenException('Для цього акаунта пароль не встановлено');
        }

        const isValid = await argon2.verify(user.passwordHash, normalizedPassword);
        if (!isValid) {
            throw new ForbiddenException('Невірний пароль');
        }
    }

    private async hasDoctorSharedAccess(appointmentId: string, actorUserId: string) {
        const now = new Date();
        const grants = await this.videoAccessGrantRepository.find({
            where: { appointmentId, sharedWithDoctorId: actorUserId },
            order: { updatedAt: 'DESC', createdAt: 'DESC' },
        });

        return grants.some((grant) => !grant.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime());
    }

    private isPastOrCompletedAppointment(appointment: Appointment) {
        const status = String(appointment.status || '').toUpperCase();
        const visitStatus = String(appointment.visitFlowStatus || '').toUpperCase();
        const time = appointment.appointmentDate ? new Date(appointment.appointmentDate).getTime() : 0;
        return status === 'COMPLETED' || visitStatus === 'COMPLETED' || status === 'CANCELLED' || visitStatus === 'NO_SHOW' || time < Date.now();
    }

    private isAppointmentReviewable(appointment: Appointment) {
        const status = String(appointment.status || '').toUpperCase();
        const visitStatus = String(appointment.visitFlowStatus || '').toUpperCase();
        return status === 'COMPLETED' || visitStatus === 'COMPLETED';
    }

    private buildFrontendReviewLink(appointmentId: string) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const normalized = frontendUrl.replace(/\/$/, '');
        return `${normalized}/?reviewAppointmentId=${encodeURIComponent(appointmentId)}`;
    }

    private cabinetAllowsDoctor(cabinet: Cabinet, doctor: Doctor | null) {
        const assignments = cabinet.doctorAssignments || [];
        if (!assignments.length) return true;
        if (!doctor) return false;
        return assignments.some((assignment) => assignment.doctorId === doctor.id);
    }

    private async getCabinetCandidatesForDoctorAndService(doctorId: string, serviceId: string) {
        const [doctor, cabinets] = await Promise.all([
            this.getDoctorEntityByAnyId(doctorId),
            this.cabinetRepository
                .createQueryBuilder('cabinet')
                .leftJoinAndSelect('cabinet.services', 'service')
                .leftJoinAndSelect('cabinet.devices', 'device')
                .leftJoinAndSelect('cabinet.doctorAssignments', 'assignment')
                .where('cabinet.isActive = :isActive', { isActive: true })
                .andWhere('service.id = :serviceId', { serviceId })
                .orderBy('cabinet.createdAt', 'ASC')
                .getMany(),
        ]);

        if (!cabinets.length) {
            return {
                requiresCabinet: false,
                doctor,
                cabinets: [] as Cabinet[],
            };
        }

        const candidates = cabinets.filter((cabinet) => this.cabinetAllowsDoctor(cabinet, doctor));

        return {
            requiresCabinet: true,
            doctor,
            cabinets: candidates,
        };
    }

    private overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
        return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
    }

    private async getCabinetBusyIntervals(
        cabinetIds: string[],
        rangeStart: Date,
        rangeEnd: Date,
        excludeAppointmentId?: string,
    ) {
        const result = new Map<string, Array<{ start: Date; end: Date }>>();
        if (!cabinetIds.length) return result;

        const appointments = await this.appointmentRepository
            .createQueryBuilder('appointment')
            .where('appointment.cabinetId IN (:...cabinetIds)', { cabinetIds })
            .andWhere('appointment.status != :cancelled', { cancelled: 'CANCELLED' })
            .andWhere('appointment.appointmentDate IS NOT NULL')
            .andWhere('appointment.appointmentDate <= :rangeEnd', { rangeEnd })
            .andWhere('appointment.appointmentDate >= :rangeStart', { rangeStart })
            .getMany();

        const durationsMap = await this.getServiceDurationMapForAppointments(appointments);

        for (const appointment of appointments) {
            if (excludeAppointmentId && appointment.id === excludeAppointmentId) continue;
            if (!appointment.cabinetId || !appointment.appointmentDate) continue;

            const duration =
                appointment.durationMinutes ||
                (appointment.serviceId ? durationsMap.get(appointment.serviceId) || 20 : 20);

            const start = new Date(appointment.appointmentDate);
            const end = new Date(start.getTime() + Number(duration || 20) * 60 * 1000);

            if (!result.has(appointment.cabinetId)) {
                result.set(appointment.cabinetId, []);
            }

            result.get(appointment.cabinetId)!.push({ start, end });
        }

        return result;
    }

    private async getServiceDurationMapForAppointments(appointments: Appointment[]) {
        const serviceIds = appointments
            .map((item) => item.serviceId)
            .filter((id): id is string => Boolean(id));

        if (!serviceIds.length) return new Map<string, number>();

        const services = await this.clinicServiceRepository.find({
            where: [...new Set(serviceIds)].map((id) => ({ id })),
        });

        return new Map(services.map((item) => [item.id, Number(item.durationMinutes || 20)]));
    }

    private pickAvailableCabinet(
        cabinets: Cabinet[],
        busyByCabinet: Map<string, Array<{ start: Date; end: Date }>>,
        startAt: Date,
        endAt: Date,
        preferredCabinetId?: string | null,
    ) {
        const ordered = preferredCabinetId
            ? [
                  ...cabinets.filter((cabinet) => cabinet.id === preferredCabinetId),
                  ...cabinets.filter((cabinet) => cabinet.id !== preferredCabinetId),
              ]
            : cabinets;

        for (const cabinet of ordered) {
            const intervals = busyByCabinet.get(cabinet.id) || [];
            const hasOverlap = intervals.some((item) => this.overlaps(startAt, endAt, item.start, item.end));
            if (!hasOverlap) {
                return cabinet;
            }
        }

        return null;
    }

    private async getValidStartSlotsForServiceOnDate(
        doctorId: string,
        service: ClinicServiceEntity,
        dateKey: string,
        options?: {
            earliestAllowed?: Date | null;
            latestAllowed?: Date | null;
            preferredCabinetId?: string | null;
            excludeAppointmentId?: string;
        },
    ) {
        const day = await this.doctorScheduleService.getDay(doctorId, dateKey);
        const duration = this.getServiceDuration(service);

        if (!day?.ok || !day.isWorking) {
            return {
                day,
                slots: [] as Array<{
                    time: string;
                    state: 'FREE';
                    cabinetId: string | null;
                    cabinetName: string | null;
                }>,
            };
        }

        const slotMinutes = Number(day.slotMinutes || 20);
        const needed = Math.max(1, Math.ceil(duration / slotMinutes));
        const freeTimes = new Set(
            (day.slots || [])
                .filter((slot) => slot.state === 'FREE')
                .map((slot) => slot.time),
        );

        const earliestAllowed = options?.earliestAllowed || null;
        const latestAllowed = options?.latestAllowed || null;

        const cabinetInfo = await this.getCabinetCandidatesForDoctorAndService(doctorId, service.id);
        const busyByCabinet = cabinetInfo.requiresCabinet
            ? await this.getCabinetBusyIntervals(
                  cabinetInfo.cabinets.map((cabinet) => cabinet.id),
                  new Date(`${dateKey}T00:00:00`),
                  new Date(`${dateKey}T23:59:59.999`),
                  options?.excludeAppointmentId,
              )
            : new Map<string, Array<{ start: Date; end: Date }>>();

        const validSlots: Array<{
            time: string;
            state: 'FREE';
            cabinetId: string | null;
            cabinetName: string | null;
        }> = [];

        for (const slot of day.slots || []) {
            if (slot.state !== 'FREE') continue;

            const startAt = new Date(`${dateKey}T${slot.time}:00`);
            if (Number.isNaN(startAt.getTime())) continue;
            const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

            if (earliestAllowed && startAt.getTime() < earliestAllowed.getTime()) continue;
            if (latestAllowed && startAt.getTime() > latestAllowed.getTime()) continue;

            const startMinute = startAt.getHours() * 60 + startAt.getMinutes();
            let hasContinuousWindow = true;

            for (let i = 0; i < needed; i += 1) {
                const checkTime = this.minutesToTime(startMinute + i * slotMinutes);
                if (!freeTimes.has(checkTime)) {
                    hasContinuousWindow = false;
                    break;
                }
            }

            if (!hasContinuousWindow) continue;

            if (!cabinetInfo.requiresCabinet) {
                validSlots.push({
                    time: slot.time,
                    state: 'FREE',
                    cabinetId: null,
                    cabinetName: null,
                });
                continue;
            }

            if (!cabinetInfo.cabinets.length) {
                continue;
            }

            const cabinet = this.pickAvailableCabinet(
                cabinetInfo.cabinets,
                busyByCabinet,
                startAt,
                endAt,
                options?.preferredCabinetId,
            );

            if (!cabinet) continue;

            validSlots.push({
                time: slot.time,
                state: 'FREE',
                cabinetId: cabinet.id,
                cabinetName: cabinet.name,
            });
        }

        return {
            day,
            slots: validSlots,
        };
    }

    private async resolveBookingStep(
        doctorId: string,
        serviceId: string,
        appointmentDateRaw: string,
        options?: {
            preferredCabinetId?: string | null;
            excludeAppointmentId?: string;
        },
    ) {
        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
            relations: ['category', 'specialties'],
        });
        if (!service) throw new BadRequestException('Послугу не знайдено');

        const appointmentDate = this.parseAppointmentDateOrThrow(appointmentDateRaw);

        await this.doctorScheduleService.ensureSlotAvailableForBooking(
            doctorId,
            appointmentDate,
            Number(service.durationMinutes) || 20,
            options?.excludeAppointmentId,
        );

        const dateKey = this.toDateKey(appointmentDate);
        const availability = await this.getValidStartSlotsForServiceOnDate(doctorId, service, dateKey, {
            earliestAllowed: appointmentDate,
            latestAllowed: appointmentDate,
            preferredCabinetId: options?.preferredCabinetId || null,
            excludeAppointmentId: options?.excludeAppointmentId,
        });

        const matchedSlot = availability.slots.find((slot) => slot.time === this.minutesToTime(appointmentDate.getHours() * 60 + appointmentDate.getMinutes()));

        if (!matchedSlot) {
            throw new BadRequestException('Обраний час недоступний для цієї послуги або кабінету');
        }

        return {
            service,
            appointmentDate,
            durationMinutes: this.getServiceDuration(service),
            cabinetId: matchedSlot.cabinetId,
            cabinetName: matchedSlot.cabinetName,
        };
    }

    async getManualAvailabilityMonth(doctorId: string, serviceId: string, month: string) {
        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
            relations: ['category', 'specialties'],
        });
        if (!service) {
            throw new BadRequestException('Послугу не знайдено');
        }

        const baseMonth = await this.doctorScheduleService.getMonth(doctorId, month);
        const days = await Promise.all(
            (baseMonth.days || []).map(async (day) => {
                const availability = await this.getValidStartSlotsForServiceOnDate(doctorId, service, day.date);
                return {
                    ...day,
                    freeSlots: availability.slots.length,
                    totalSlots: day.totalSlots,
                };
            }),
        );

        return {
            ...baseMonth,
            serviceId,
            days,
        };
    }

    async getManualAvailabilityDay(doctorId: string, serviceId: string, date: string) {
        const service = await this.clinicServiceRepository.findOne({
            where: { id: serviceId },
            relations: ['category', 'specialties'],
        });
        if (!service) {
            throw new BadRequestException('Послугу не знайдено');
        }

        const availability = await this.getValidStartSlotsForServiceOnDate(doctorId, service, date);
        const baseDay = availability.day;

        return {
            ok: true,
            serviceId,
            date,
            timezone: baseDay?.timezone,
            slotMinutes: baseDay?.slotMinutes,
            bookingWindowDays: baseDay?.bookingWindowDays,
            isWorking: Boolean(baseDay?.isWorking),
            reason: baseDay?.reason || 'working',
            slots: availability.slots,
            blockedSlots: baseDay?.blockedSlots || [],
            blockedDay: baseDay?.blockedDay || false,
        };
    }

    async createGuestAppointment(dto: CreateGuestAppointmentDto) {
        await this.phoneVerificationService.ensureVerified(
            dto.phoneVerificationSessionId,
            dto.phone,
        );

        await this.servicesService.ensureBookable(dto.serviceId, dto.doctorId);
        const resolvedStep = await this.ensureScheduleAllowsBooking(dto.doctorId, dto.serviceId, dto.appointmentDate);

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
            cabinetId: resolvedStep.cabinetId || null,
            durationMinutes: resolvedStep.durationMinutes,
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

    private normalizeTextList(items?: string[] | null) {
        if (!Array.isArray(items)) return [] as string[];

        return items
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 50);
    }

    private normalizeOptionalEmail(email?: string | null) {
        const value = String(email || '').trim();
        if (!value) return null;

        const normalized = value.toLowerCase();
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(normalized)) {
            throw new BadRequestException('Невірний email');
        }

        return normalized;
    }

    private async resolveDoctorFollowUpEmail(patient: Patient, email?: string | null) {
        const resolvedEmail = this.normalizeOptionalEmail(email) || this.normalizeOptionalEmail(patient.email);

        if (resolvedEmail && patient.email !== resolvedEmail) {
            patient.email = resolvedEmail;
            await this.patientRepository.save(patient);
        }

        return resolvedEmail;
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
            cabinetId?: string | null;
            durationMinutes?: number;
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


    private async buildAppointmentLineFromEntity(appointment: Appointment) {
        if (!appointment.serviceId || !appointment.doctorId || !appointment.appointmentDate) {
            return 'Запис на прийом';
        }

        const [line] = await this.buildAppointmentLines([
            {
                serviceId: appointment.serviceId,
                doctorId: appointment.doctorId,
                appointmentDate: new Date(appointment.appointmentDate).toISOString(),
                cabinetId: appointment.cabinetId || null,
                durationMinutes: appointment.durationMinutes || undefined,
            },
        ]);

        return line || 'Запис на прийом';
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
        const resolvedStep = await this.ensureScheduleAllowsBooking(dto.doctorId, dto.serviceId, dto.appointmentDate);

        const appointment = this.appointmentRepository.create({
            patient,
            doctorId: dto.doctorId || null,
            serviceId: dto.serviceId || null,
            cabinetId: resolvedStep.cabinetId || null,
            durationMinutes: resolvedStep.durationMinutes,
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

        if (actor.role === UserRole.DOCTOR) {
            const ownsAppointment = await this.doctorOwnsAppointment(appointment, actor.id);

            if (!ownsAppointment) {
                throw new ForbiddenException('Цей прийом не належить поточному лікарю');
            }
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

    async completeDoctorAppointment(
        appointmentId: string,
        actor: JwtUser,
        payload: {
            consultationConclusion?: string;
            treatmentPlanItems?: string[];
            recommendationItems?: string[];
            medicationItems?: string[];
            email?: string;
            nextVisitDate?: string | null;
        },
    ) {
        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new BadRequestException('Запис на прийом не знайдено');
        }

        if (actor.role !== UserRole.DOCTOR) {
            throw new ForbiddenException('Лише лікар може завершувати прийом');
        }

        const ownsAppointment = await this.doctorOwnsAppointment(appointment, actor.id);
        if (!ownsAppointment) {
            throw new ForbiddenException('Цей прийом не належить поточному лікарю');
        }

        if (String(appointment.visitFlowStatus || '').toUpperCase() === 'COMPLETED' || String(appointment.status || '').toUpperCase() === 'COMPLETED') {
            throw new BadRequestException('Прийом уже завершено');
        }

        const consultationConclusion = String(payload.consultationConclusion || '').trim();
        if (!consultationConclusion) {
            throw new BadRequestException('Заповніть консультативний висновок');
        }

        const treatmentPlanItems = this.normalizeTextList(payload.treatmentPlanItems);
        const recommendationItems = this.normalizeTextList(payload.recommendationItems);
        const medicationItems = this.normalizeTextList(payload.medicationItems);
        const consultationEmail = await this.resolveDoctorFollowUpEmail(appointment.patient, payload.email);

        const recordingsCount = await this.videoRepository.count({ where: { appointmentId } });
        const completedAt = new Date();
        const nextVisitDate = payload.nextVisitDate ? this.parseAppointmentDateOrThrow(payload.nextVisitDate) : null;

        appointment.consultationConclusion = consultationConclusion;
        appointment.treatmentPlanItems = treatmentPlanItems;
        appointment.recommendationItems = recommendationItems;
        appointment.medicationItems = medicationItems;
        appointment.consultationEmail = consultationEmail;
        appointment.recordingCompleted = recordingsCount > 0 || appointment.recordingCompleted;
        appointment.recordingCompletedAt = appointment.recordingCompleted
            ? appointment.recordingCompletedAt || completedAt
            : null;
        appointment.completedAt = completedAt;
        appointment.visitFlowStatus = 'COMPLETED';
        appointment.status = 'COMPLETED';

        await this.appointmentRepository.save(appointment);

        const doctor = appointment.doctorId
            ? await this.resolveDoctorByAnyId(appointment.doctorId)
            : await this.resolveDoctorByAnyId(actor.id);

        if (consultationEmail) {
            await this.mailService.sendConsultationConclusionEmail({
                to: consultationEmail,
                patientName: this.buildPatientDisplayName(appointment.patient),
                doctorName: doctor ? this.getDoctorDisplayName(doctor) : 'Лікар клініки',
                appointmentDate: appointment.appointmentDate,
                conclusion: consultationConclusion,
                treatmentPlanItems,
                recommendationItems,
                medicationItems,
                nextVisitDate,
                reviewLink: this.buildFrontendReviewLink(appointment.id),
            });
        }

        return {
            ok: true,
            message: consultationEmail
                ? 'Прийом завершено, консультативний висновок відправлено на пошту'
                : 'Прийом завершено',
            appointment: await this.findById(appointmentId),
        };
    }

    async createDoctorFollowUpAppointment(
        appointmentId: string,
        actor: JwtUser,
        payload: {
            doctorId: string;
            serviceId: string;
            appointmentDate: string;
            cabinetId?: string | null;
            email?: string;
        },
    ) {
        const sourceAppointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!sourceAppointment) {
            throw new BadRequestException('Поточний прийом не знайдено');
        }

        if (actor.role !== UserRole.DOCTOR) {
            throw new ForbiddenException('Лише лікар може створювати запис з цієї сторінки');
        }

        const ownsAppointment = await this.doctorOwnsAppointment(sourceAppointment, actor.id);
        if (!ownsAppointment) {
            throw new ForbiddenException('Цей прийом не належить поточному лікарю');
        }

        if (!payload.doctorId || !payload.serviceId || !payload.appointmentDate) {
            throw new BadRequestException('Для нового запису потрібно вказати лікаря, послугу і дату');
        }

        await this.servicesService.ensureBookable(payload.serviceId, payload.doctorId);
        const resolvedStep = await this.ensureScheduleAllowsBooking(
            payload.doctorId,
            payload.serviceId,
            payload.appointmentDate,
            payload.cabinetId || null,
        );

        const patient = sourceAppointment.patient;
        const notificationEmail = await this.resolveDoctorFollowUpEmail(patient, payload.email);

        const appointment = this.createAppointmentEntity({
            patient,
            doctorId: payload.doctorId,
            serviceId: payload.serviceId,
            cabinetId: resolvedStep.cabinetId || null,
            durationMinutes: resolvedStep.durationMinutes,
            appointmentDate: new Date(payload.appointmentDate),
            status: 'BOOKED',
            source: 'DOCTOR_FOLLOW_UP',
            visitFlowStatus: 'SCHEDULED',
            recordingCompleted: false,
            recordingCompletedAt: null,
            paymentStatus: PaymentStatus.PENDING,
            paymentMethod: PaymentMethod.CASH,
            paymentProvider: null,
            paymentReference: null,
            paidAmountUah: Number(resolvedStep.service?.priceUah || 0),
            paidAt: null,
            receiptNumber: null,
        });

        const saved = await this.appointmentRepository.save(appointment);

        if (notificationEmail) {
            const appointmentLine = (await this.buildAppointmentLines([
                {
                    serviceId: payload.serviceId,
                    doctorId: payload.doctorId,
                    appointmentDate: payload.appointmentDate,
                    cabinetId: resolvedStep.cabinetId || null,
                    durationMinutes: resolvedStep.durationMinutes,
                },
            ]))[0] || 'Запис створено';

            await this.mailService.sendDoctorScheduledVisitEmail({
                to: notificationEmail,
                patientName: this.buildPatientDisplayName(patient),
                appointmentLine,
            });
        }

        return {
            ok: true,
            message: notificationEmail
                ? 'Пацієнта записано на візит, повідомлення відправлено на пошту'
                : 'Пацієнта записано на візит',
            appointment: await this.findById(saved.id),
        };
    }


    async submitAppointmentReview(
        actor: JwtUser,
        appointmentId: string,
        payload: {
            rating: number;
            text?: string;
            anonymous?: boolean;
        },
    ) {
        if (actor.role !== UserRole.PATIENT) {
            throw new ForbiddenException('Лише пацієнт може залишити відгук');
        }

        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new NotFoundException('Запис не знайдено');
        }

        if (!actor.patientId || appointment.patient?.id !== actor.patientId) {
            throw new ForbiddenException('Немає доступу до цього запису');
        }

        if (!this.isAppointmentReviewable(appointment)) {
            throw new BadRequestException('Відгук можна залишити лише після завершеного прийому');
        }

        if (appointment.reviewCreatedAt || appointment.reviewRating !== null) {
            throw new BadRequestException('Відгук для цього запису вже залишено');
        }

        const rating = Number(payload.rating || 0);
        if (!Number.isFinite(rating) || rating < 0.5 || rating > 5 || Math.round(rating * 2) !== rating * 2) {
            throw new BadRequestException('Оцінка має бути від 0.5 до 5 з кроком 0.5');
        }

        const reviewText = String(payload.text || '').trim();
        if (reviewText.length > 2000) {
            throw new BadRequestException('Текст відгуку занадто довгий');
        }

        appointment.reviewRating = rating;
        appointment.reviewText = reviewText || null;
        appointment.reviewAnonymous = Boolean(payload.anonymous);
        appointment.reviewCreatedAt = new Date();

        await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            message: 'Дякуємо, відгук збережено',
            appointment: await this.findById(appointmentId),
        };
    }

    async getDoctorAppointmentById(userId: string, appointmentId: string) {
        const user = await this.userService.findById(userId);

        if (!user || user.role !== UserRole.DOCTOR) {
            throw new ForbiddenException('Доступ дозволено лише лікарю');
        }

        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new BadRequestException('Запис на прийом не знайдено');
        }

        const ownsAppointment = await this.doctorOwnsAppointment(appointment, userId);

        if (!ownsAppointment) {
            throw new ForbiddenException('Цей прийом не належить поточному лікарю');
        }

        const [service, doctor, cabinet] = await Promise.all([
            appointment.serviceId
                ? this.clinicServiceRepository.findOne({
                    where: { id: appointment.serviceId },
                })
                : Promise.resolve(null),
            appointment.doctorId
                ? this.doctorRepository.findOne({
                    where: [
                        { id: appointment.doctorId },
                        { user: { id: appointment.doctorId } },
                    ],
                    relations: ['user'],
                })
                : Promise.resolve(null),
            appointment.cabinetId
                ? this.cabinetRepository.findOne({
                    where: { id: appointment.cabinetId },
                    relations: ['devices'],
                })
                : Promise.resolve(null),
        ]);

        const doctorName = doctor ? this.getDoctorDisplayName(doctor) : null;

        return {
            id: appointment.id,
            patientId: appointment.patient?.id ?? undefined,
            patient: appointment.patient
                ? {
                    id: appointment.patient.id,
                    lastName: appointment.patient.lastName,
                    firstName: appointment.patient.firstName,
                    middleName: appointment.patient.middleName,
                    phone: appointment.patient.phone,
                    email: appointment.patient.email,
                }
                : undefined,
            doctorId: appointment.doctorId,
            doctorName,
            serviceId: appointment.serviceId,
            serviceName: service?.name || null,
            appointmentDate: appointment.appointmentDate,
            status: appointment.status,
            source: appointment.source,
            recordingCompleted: appointment.recordingCompleted,
            recordingCompletedAt: appointment.recordingCompletedAt,
            consultationConclusion: appointment.consultationConclusion,
            treatmentPlanItems: appointment.treatmentPlanItems || [],
            recommendationItems: appointment.recommendationItems || [],
            medicationItems: appointment.medicationItems || [],
            consultationEmail: appointment.consultationEmail || appointment.patient?.email || null,
            completedAt: appointment.completedAt,
            reviewAnonymous: appointment.reviewAnonymous,
            reviewRating: appointment.reviewRating != null ? Number(appointment.reviewRating) : null,
            reviewText: appointment.reviewText,
            reviewCreatedAt: appointment.reviewCreatedAt,
            createdAt: appointment.createdAt,
            updatedAt: appointment.updatedAt,
            paymentStatus: (appointment as any).paymentStatus ?? 'PENDING',
            paymentMethod: (appointment as any).paymentMethod ?? null,
            paidAmountUah:
                (appointment as any).paidAmountUah ??
                (service ? Number(service.priceUah) : null),
            receiptNumber: (appointment as any).receiptNumber ?? null,
            canPayNow: ((appointment as any).paymentStatus ?? 'PENDING') !== 'PAID',
            cabinetId: appointment.cabinetId || null,
            cabinetName: cabinet ? this.parseDbI18nValueBackend(cabinet.name, 'ua') || cabinet.name : null,
            cabinet: cabinet
                ? {
                    id: cabinet.id,
                    name: this.parseDbI18nValueBackend(cabinet.name, 'ua') || cabinet.name,
                    devices: [...(cabinet.devices || [])]
                        .filter((item) => item.isActive)
                        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
                        .map((item) => ({
                            id: item.id,
                            name: this.parseDbI18nValueBackend(item.name, 'ua') || item.name,
                            cameraDeviceId: item.cameraDeviceId,
                            cameraLabel: item.cameraLabel,
                            microphoneDeviceId: item.microphoneDeviceId,
                            microphoneLabel: item.microphoneLabel,
                            startMode: item.startMode,
                            isActive: item.isActive,
                        })),
                }
                : null,
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

        const [service, doctor, cabinet] = await Promise.all([
            appointment.serviceId
                ? this.clinicServiceRepository.findOne({ where: { id: appointment.serviceId } })
                : Promise.resolve(null),
            appointment.doctorId
                ? this.doctorRepository.findOne({
                      where: [{ id: appointment.doctorId }, { user: { id: appointment.doctorId } }],
                      relations: ['user'],
                  })
                : Promise.resolve(null),
            appointment.cabinetId
                ? this.cabinetRepository.findOne({
                      where: { id: appointment.cabinetId },
                      relations: ['devices'],
                  })
                : Promise.resolve(null),
        ]);

        return {
            ...appointment,
            consultationConclusion: appointment.consultationConclusion,
            treatmentPlanItems: appointment.treatmentPlanItems || [],
            recommendationItems: appointment.recommendationItems || [],
            medicationItems: appointment.medicationItems || [],
            consultationEmail: appointment.consultationEmail || appointment.patient?.email || null,
            completedAt: appointment.completedAt,
            reviewAnonymous: appointment.reviewAnonymous,
            reviewRating: appointment.reviewRating != null ? Number(appointment.reviewRating) : null,
            reviewText: appointment.reviewText,
            reviewCreatedAt: appointment.reviewCreatedAt,
            doctorName: doctor ? this.getDoctorDisplayName(doctor) : null,
            serviceName: this.parseDbI18nValueBackend(service?.name, 'ua') || service?.name || null,
            cabinetName: cabinet ? this.parseDbI18nValueBackend(cabinet.name, 'ua') || cabinet.name : null,
            cabinet: cabinet
                ? {
                      id: cabinet.id,
                      name: this.parseDbI18nValueBackend(cabinet.name, 'ua') || cabinet.name,
                      devices: [...(cabinet.devices || [])]
                          .filter((item) => item.isActive)
                          .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
                          .map((item) => ({
                              id: item.id,
                              name: this.parseDbI18nValueBackend(item.name, 'ua') || item.name,
                              cameraDeviceId: item.cameraDeviceId,
                              cameraLabel: item.cameraLabel,
                              microphoneDeviceId: item.microphoneDeviceId,
                              microphoneLabel: item.microphoneLabel,
                              startMode: item.startMode,
                              isActive: item.isActive,
                          })),
                  }
                : null,
        };
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

    private startOfDay(date: Date): Date {
        const next = new Date(date);
        next.setHours(0, 0, 0, 0);
        return next;
    }

    private endOfDay(date: Date): Date {
        const next = new Date(date);
        next.setHours(23, 59, 59, 999);
        return next;
    }

    private maxDate(...dates: Array<Date | null | undefined>): Date | null {
        const filtered = dates.filter(Boolean) as Date[];
        if (!filtered.length) return null;
        return filtered.reduce((latest, current) => (current.getTime() > latest.getTime() ? current : latest));
    }

    private minDate(...dates: Array<Date | null | undefined>): Date | null {
        const filtered = dates.filter(Boolean) as Date[];
        if (!filtered.length) return null;
        return filtered.reduce((earliest, current) => (current.getTime() < earliest.getTime() ? current : earliest));
    }

    private buildSequentialWindow(
        previousStep: { startAt: Date; endAt: Date; serviceId: string },
        service: ClinicServiceEntity,
    ) {
        const minIntervalDays = Number(service.minIntervalDays ?? 0);
        const maxIntervalDays =
            service.maxIntervalDays === null || service.maxIntervalDays === undefined
                ? null
                : Number(service.maxIntervalDays);

        const notBefore =
            minIntervalDays > 0
                ? this.startOfDay(this.addDays(previousStep.startAt, minIntervalDays))
                : new Date(previousStep.endAt);

        const notAfter =
            maxIntervalDays !== null && Number.isFinite(maxIntervalDays)
                ? this.endOfDay(this.addDays(previousStep.startAt, maxIntervalDays))
                : null;

        return {
            notBefore,
            notAfter,
        };
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

        const serviceMap = new Map(services.map((service) => [service.id, service]));
        return ids.map((id) => serviceMap.get(id)!).filter(Boolean);
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
        notAfter?: Date | null,
    ) {
        const duration = this.getServiceDuration(service);
        const earliestAllowed = new Date(preferredDate);
        const latestAllowed = notAfter ? new Date(notAfter) : null;

        if (latestAllowed && latestAllowed.getTime() < earliestAllowed.getTime()) {
            return null;
        }

        for (let offset = 0; offset < daysForward; offset += 1) {
            const date = this.addDays(earliestAllowed, offset);

            if (latestAllowed && this.startOfDay(date).getTime() > this.endOfDay(latestAllowed).getTime()) {
                break;
            }

            const dateKey = this.toDateKey(date);
            const availability = await this.getValidStartSlotsForServiceOnDate(
                doctorId,
                service,
                dateKey,
                {
                    earliestAllowed,
                    latestAllowed,
                },
            );

            const slot = availability.slots[0];
            if (!slot) continue;

            const startAt = this.combineDateAndTime(dateKey, slot.time);
            const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

            return {
                doctorId,
                dateKey,
                startTime: slot.time,
                startAt,
                durationMinutes: duration,
                endAt,
                cabinetId: slot.cabinetId,
                cabinetName: slot.cabinetName,
            };
        }

        return null;
    }

    private async resolveBookingSteps(
        steps: Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
            cabinetId?: string | null;
        }>,
    ) {
        const resolvedSteps: Array<{
            serviceId: string;
            doctorId: string;
            appointmentDate: string;
            cabinetId?: string | null;
            durationMinutes?: number;
        }> = [];

        for (const step of steps) {
            await this.servicesService.ensureBookable(step.serviceId, step.doctorId);
            const resolved = await this.ensureScheduleAllowsBooking(
                step.doctorId,
                step.serviceId,
                step.appointmentDate,
                step.cabinetId || null,
            );

            resolvedSteps.push({
                ...step,
                cabinetId: resolved.cabinetId || null,
                durationMinutes: resolved.durationMinutes,
            });
        }

        return resolvedSteps;
    }

    private getGroupedAppointmentDuration(
        group: Array<{
            serviceId: string;
            durationMinutes?: number;
        }>,
        servicesMap: Map<string, { durationMinutes: number }>,
    ) {
        return group.reduce((sum, step) => {
            const duration =
                Number(step.durationMinutes || 0) ||
                Number(servicesMap.get(step.serviceId)?.durationMinutes || 0);
            return sum + duration;
        }, 0);
    }



    async createOfflineBooking(
        userId: string,
        dto: {
            steps: Array<{
                serviceId: string;
                doctorId: string;
                appointmentDate: string;
                cabinetId?: string | null;
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

        const resolvedSteps = await this.resolveBookingSteps(dto.steps as any);

        const groupedSteps = this.normalizeGroupedSteps(resolvedSteps, servicesMap);
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
                cabinetId: firstStep.cabinetId || null,
                durationMinutes: this.getGroupedAppointmentDuration(group, servicesMap),
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
                    consultationConclusion: item.consultationConclusion,
                    treatmentPlanItems: item.treatmentPlanItems || [],
                    recommendationItems: item.recommendationItems || [],
                    medicationItems: item.medicationItems || [],
                    consultationEmail: item.consultationEmail || item.patient?.email || null,
                    completedAt: item.completedAt,
                    reviewAnonymous: item.reviewAnonymous,
                    reviewRating: item.reviewRating != null ? Number(item.reviewRating) : null,
                    reviewText: item.reviewText,
                    reviewCreatedAt: item.reviewCreatedAt,
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
                cabinetId?: string | null;
                cabinetName?: string | null;
                startAt: Date;
                endAt: Date;
                durationMinutes: number;
            }> = [];

            let currentDate = preferredDate;
            let valid = true;

            for (const service of services) {
                const previousStep = steps[steps.length - 1];
                const window = previousStep
                    ? this.buildSequentialWindow(previousStep, service)
                    : { notBefore: currentDate, notAfter: null };

                const slot = await this.findEarliestSlotForDoctor(
                    doctorUserId,
                    service,
                    window.notBefore,
                    14,
                    window.notAfter,
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
                    cabinetId: slot.cabinetId || null,
                    cabinetName: slot.cabinetName || null,
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
            cabinetId?: string | null;
            cabinetName?: string | null;
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
                cabinetId?: string | null;
                cabinetName?: string | null;
            } | null = null;

            const previousStep = steps[steps.length - 1];
            const window = previousStep
                ? this.buildSequentialWindow(previousStep, service)
                : { notBefore: currentDate, notAfter: null };

            for (const doctor of doctorPool) {
                const doctorUserId = this.getDoctorUserId(doctor);
                const slot = await this.findEarliestSlotForDoctor(
                    doctorUserId,
                    service,
                    window.notBefore,
                    14,
                    window.notAfter,
                );

                if (!slot) continue;

                if (!best || slot.startAt < best.startAt) {
                    best = {
                        doctor,
                        startAt: slot.startAt,
                        endAt: slot.endAt,
                        durationMinutes: slot.durationMinutes,
                        cabinetId: slot.cabinetId || null,
                        cabinetName: slot.cabinetName || null,
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
                cabinetId: best.cabinetId || null,
                cabinetName: best.cabinetName || null,
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
            cabinetId?: string | null;
            durationMinutes?: number;
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
                cabinetId?: string | null;
                durationMinutes?: number;
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
                prevStep.durationMinutes || servicesMap.get(prevStep.serviceId)?.durationMinutes || 0,
            );
            const prevEnd = this.addMinutes(prevStart, prevDuration);

            const sameDoctor = prevStep.doctorId === step.doctorId;
            const sameCabinet = (prevStep.cabinetId || null) === (step.cabinetId || null);
            const contiguous = prevEnd.getTime() === currentStart.getTime();

            if (sameDoctor && sameCabinet && contiguous) {
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
            cabinetId?: string | null;
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

        const resolvedSteps = await this.resolveBookingSteps(body.steps as any);

        const groupedSteps = this.normalizeGroupedSteps(resolvedSteps, servicesMap);
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
                cabinetId: firstStep.cabinetId || null,
                durationMinutes: this.getGroupedAppointmentDuration(group, servicesMap),
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
            cabinetId?: string | null;
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

        const resolvedSteps = await this.resolveBookingSteps(body.steps as any);

        const groupedSteps = this.normalizeGroupedSteps(resolvedSteps, servicesMap);
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
                cabinetId: firstStep.cabinetId || null,
                durationMinutes: this.getGroupedAppointmentDuration(group, servicesMap),
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

        const resolvedSteps = await this.resolveBookingSteps(dto.steps as any);

        const groupedSteps = this.normalizeGroupedSteps(resolvedSteps, servicesMap);
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
                cabinetId: firstStep.cabinetId || null,
                durationMinutes: this.getGroupedAppointmentDuration(group, servicesMap),
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



    private parseWeekAnchor(raw?: string) {
        const date = raw ? new Date(raw) : new Date();
        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('Невірна дата тижня');
        }
        date.setHours(0, 0, 0, 0);
        return date;
    }

    private startOfWeek(date: Date) {
        const base = new Date(date);
        base.setHours(0, 0, 0, 0);
        const day = base.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        base.setDate(base.getDate() + diff);
        return base;
    }

    private endOfWeek(start: Date) {
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return end;
    }

    private formatDateKey(date: Date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private appointmentEnd(appointment: Appointment) {
        const start = appointment.appointmentDate ? new Date(appointment.appointmentDate) : null;
        if (!start) return null;
        const duration = Number(appointment.durationMinutes || 0);
        return new Date(start.getTime() + duration * 60 * 1000);
    }

    private isSameCalendarDay(left: Date, right: Date) {
        return (
            left.getFullYear() === right.getFullYear() &&
            left.getMonth() === right.getMonth() &&
            left.getDate() === right.getDate()
        );
    }

    private async propagateWaitingCallChain(appointment: Appointment) {
        appointment.visitFlowStatus = 'WAITING_CALL';

        if (!appointment.patient?.id || !appointment.doctorId || !appointment.appointmentDate) {
            await this.appointmentRepository.save(appointment);
            return;
        }

        const all = await this.appointmentRepository.find({
            where: {
                patient: { id: appointment.patient.id },
            },
            relations: ['patient'],
            order: {
                appointmentDate: 'ASC',
                createdAt: 'ASC',
            },
        });

        const currentStart = new Date(appointment.appointmentDate);
        const sameChain = all.filter((item) => {
            if (!item.appointmentDate) return false;
            return (
                item.doctorId === appointment.doctorId &&
                this.isSameCalendarDay(new Date(item.appointmentDate), currentStart)
            );
        });

        const currentIndex = sameChain.findIndex((item) => item.id === appointment.id);
        if (currentIndex === -1) {
            await this.appointmentRepository.save(appointment);
            return;
        }

        const toSave: Appointment[] = [];
        let previous = sameChain[currentIndex];
        previous.visitFlowStatus = 'WAITING_CALL';
        toSave.push(previous);

        for (let index = currentIndex + 1; index < sameChain.length; index += 1) {
            const next = sameChain[index];
            const previousEnd = this.appointmentEnd(previous);
            const nextStart = next.appointmentDate ? new Date(next.appointmentDate) : null;

            if (!previousEnd || !nextStart || previousEnd.getTime() !== nextStart.getTime()) {
                break;
            }

            next.visitFlowStatus = 'WAITING_CALL';
            toSave.push(next);
            previous = next;
        }

        await this.appointmentRepository.save(toSave);
    }

    private async getWeeklyActor(userId: string) {
        const user = await this.userService.findById(userId);
        if (!user) {
            throw new ForbiddenException('Користувача не знайдено');
        }
        return user;
    }

    private async ensureWeeklyBoardAccess(userId: string, appointment?: Appointment) {
        const user = await this.getWeeklyActor(userId);

        if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
            return { user, scope: 'admin' as const, doctorEntity: null as Doctor | null };
        }

        if (user.role !== UserRole.DOCTOR) {
            throw new ForbiddenException('Недостатньо прав доступу');
        }

        const doctorEntity = await this.getDoctorEntityByAnyId(user.id);
        const allowedDoctorIds = [user.id, doctorEntity?.id].filter(Boolean) as string[];

        if (appointment && !allowedDoctorIds.includes(String(appointment.doctorId || ''))) {
            throw new ForbiddenException('Запис не належить цьому лікарю');
        }

        return { user, scope: 'doctor' as const, doctorEntity };
    }

    private async getAvailableCabinetsForAppointment(appointment: Appointment) {
        if (!appointment.doctorId || !appointment.serviceId || !appointment.appointmentDate) {
            return [] as Array<{ id: string; name: string }>;
        }

        const service = await this.clinicServiceRepository.findOne({ where: { id: appointment.serviceId } });
        if (!service) return [];

        const duration = Number(appointment.durationMinutes || service.durationMinutes || 20);
        const startAt = new Date(appointment.appointmentDate);
        const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

        const cabinetInfo = await this.getCabinetCandidatesForDoctorAndService(appointment.doctorId, appointment.serviceId);
        if (!cabinetInfo.requiresCabinet || !cabinetInfo.cabinets.length) {
            return [] as Array<{ id: string; name: string }>;
        }

        const rangeStart = new Date(startAt);
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(startAt);
        rangeEnd.setHours(23, 59, 59, 999);

        const busyByCabinet = await this.getCabinetBusyIntervals(
            cabinetInfo.cabinets.map((cabinet) => cabinet.id),
            rangeStart,
            rangeEnd,
            appointment.id,
        );

        return cabinetInfo.cabinets
            .filter((cabinet) => {
                const intervals = busyByCabinet.get(cabinet.id) || [];
                return !intervals.some((item) => this.overlaps(startAt, endAt, item.start, item.end));
            })
            .map((cabinet) => ({
                id: cabinet.id,
                name: this.parseDbI18nValueBackend(cabinet.name, 'ua') || cabinet.name,
            }));
    }

    private async mapWeeklyAppointment(appointment: Appointment) {
        const [service, doctor, cabinet, alternativeCabinets] = await Promise.all([
            appointment.serviceId
                ? this.clinicServiceRepository.findOne({ where: { id: appointment.serviceId } })
                : Promise.resolve(null),
            appointment.doctorId
                ? this.doctorRepository.findOne({
                      where: [{ id: appointment.doctorId }, { user: { id: appointment.doctorId } }],
                      relations: ['user'],
                  })
                : Promise.resolve(null),
            appointment.cabinetId
                ? this.cabinetRepository.findOne({ where: { id: appointment.cabinetId } })
                : Promise.resolve(null),
            this.getAvailableCabinetsForAppointment(appointment),
        ]);

        const patient = appointment.patient;
        const patientName = patient
            ? this.buildPatientDisplayName(patient)
            : 'Пацієнт не вказаний';

        return {
            id: appointment.id,
            patient: patient
                ? {
                      id: patient.id,
                      fullName: patientName,
                      phone: patient.phone || null,
                      email: patient.email || null,
                  }
                : null,
            doctorId: appointment.doctorId,
            doctorName: doctor ? this.getDoctorDisplayName(doctor) : null,
            serviceId: appointment.serviceId,
            serviceName: this.parseDbI18nValueBackend(service?.name, 'ua') || service?.name || null,
            cabinetId: appointment.cabinetId,
            cabinetName: cabinet ? this.parseDbI18nValueBackend(cabinet.name, 'ua') || cabinet.name : null,
            availableCabinets: alternativeCabinets,
            appointmentDate: appointment.appointmentDate,
            durationMinutes: appointment.durationMinutes || Number(service?.durationMinutes || 20),
            status: appointment.status,
            visitFlowStatus: appointment.visitFlowStatus || 'SCHEDULED',
            paymentStatus: appointment.paymentStatus,
            paymentMethod: appointment.paymentMethod,
            paidAmountUah: appointment.paidAmountUah,
            source: appointment.source,
            recordingCompleted: appointment.recordingCompleted,
        };
    }


    private async mapDoctorArchiveAppointment(
        appointment: Appointment,
        extra?: {
            accessType?: 'OWN' | 'SHARED';
            sharedByDoctorName?: string | null;
            accessExpiresAt?: Date | null;
        },
    ) {
        const [service, doctor, cabinet, videosCount] = await Promise.all([
            appointment.serviceId
                ? this.clinicServiceRepository.findOne({ where: { id: appointment.serviceId } })
                : Promise.resolve(null),
            appointment.doctorId
                ? this.doctorRepository.findOne({
                      where: [{ id: appointment.doctorId }, { user: { id: appointment.doctorId } }],
                      relations: ['user'],
                  })
                : Promise.resolve(null),
            appointment.cabinetId
                ? this.cabinetRepository.findOne({ where: { id: appointment.cabinetId } })
                : Promise.resolve(null),
            this.videoRepository.count({ where: { appointmentId: appointment.id } }),
        ]);

        const patient = appointment.patient;

        return {
            id: appointment.id,
            patient: patient
                ? {
                      id: patient.id,
                      fullName: this.buildPatientDisplayName(patient),
                      phone: patient.phone || null,
                      email: patient.email || null,
                  }
                : null,
            doctorId: appointment.doctorId,
            doctorName: doctor ? this.getDoctorDisplayName(doctor) : null,
            serviceId: appointment.serviceId,
            serviceName: this.parseDbI18nValueBackend(service?.name, 'ua') || service?.name || null,
            cabinetId: appointment.cabinetId,
            cabinetName: cabinet ? this.parseDbI18nValueBackend(cabinet.name, 'ua') || cabinet.name : null,
            appointmentDate: appointment.appointmentDate,
            durationMinutes: appointment.durationMinutes || Number(service?.durationMinutes || 20),
            status: appointment.status,
            visitFlowStatus: appointment.visitFlowStatus || 'SCHEDULED',
            paymentStatus: appointment.paymentStatus,
            paymentMethod: appointment.paymentMethod,
            paidAmountUah: appointment.paidAmountUah,
            source: appointment.source,
            recordingCompleted: appointment.recordingCompleted,
            consultationConclusion: appointment.consultationConclusion || null,
            treatmentPlanItems: appointment.treatmentPlanItems || [],
            recommendationItems: appointment.recommendationItems || [],
            medicationItems: appointment.medicationItems || [],
            consultationEmail: appointment.consultationEmail || appointment.patient?.email || null,
            completedAt: appointment.completedAt,
            reviewAnonymous: appointment.reviewAnonymous,
            reviewRating: appointment.reviewRating != null ? Number(appointment.reviewRating) : null,
            reviewText: appointment.reviewText,
            reviewCreatedAt: appointment.reviewCreatedAt,
            consultationPdfReady: Boolean(
                appointment.consultationConclusion ||
                (appointment.treatmentPlanItems || []).length ||
                (appointment.recommendationItems || []).length ||
                (appointment.medicationItems || []).length
            ),
            videosCount,
            accessType: extra?.accessType || 'OWN',
            sharedByDoctorName: extra?.sharedByDoctorName || null,
            accessExpiresAt: extra?.accessExpiresAt || null,
        };
    }

    async getAdminWeekAppointments(userId: string, rawDate?: string) {
        await this.ensureAdminOrSuperAdmin(userId);
        const anchor = this.parseWeekAnchor(rawDate);
        const weekStart = this.startOfDay(anchor);
        const weekEnd = this.endOfDay(this.addDays(weekStart, 6));

        const appointments = await this.appointmentRepository.find({
            relations: ['patient'],
            order: {
                appointmentDate: 'ASC',
                createdAt: 'ASC',
            },
        });

        const filtered = appointments.filter((item) => {
            if (!item.appointmentDate) return false;
            const time = new Date(item.appointmentDate).getTime();
            return time >= weekStart.getTime() && time <= weekEnd.getTime();
        });

        return {
            ok: true,
            weekStart: this.formatDateKey(weekStart),
            weekEnd: this.formatDateKey(weekEnd),
            appointments: await Promise.all(filtered.map((item) => this.mapWeeklyAppointment(item))),
        };
    }

    async getDoctorWeekAppointments(userId: string, rawDate?: string) {
        const access = await this.ensureWeeklyBoardAccess(userId);
        if (access.scope !== 'doctor') {
            throw new ForbiddenException('Доступно лише для лікаря');
        }

        const doctorIds = [access.user.id, access.doctorEntity?.id].filter(Boolean) as string[];
        const anchor = this.parseWeekAnchor(rawDate);
        const weekStart = this.startOfDay(anchor);
        const weekEnd = this.endOfDay(this.addDays(weekStart, 6));

        const appointments = await this.appointmentRepository.find({
            relations: ['patient'],
            order: {
                appointmentDate: 'ASC',
                createdAt: 'ASC',
            },
        });

        const filtered = appointments.filter((item) => {
            if (!item.appointmentDate) return false;
            if (!doctorIds.includes(String(item.doctorId || ''))) return false;
            if (String(item.status || '').toUpperCase() === 'COMPLETED' || String(item.visitFlowStatus || '').toUpperCase() === 'COMPLETED') {
                return false;
            }
            const time = new Date(item.appointmentDate).getTime();
            return time >= weekStart.getTime() && time <= weekEnd.getTime();
        });

        return {
            ok: true,
            weekStart: this.formatDateKey(weekStart),
            weekEnd: this.formatDateKey(weekEnd),
            appointments: await Promise.all(filtered.map((item) => this.mapWeeklyAppointment(item))),
        };
    }

    async getDoctorArchiveAppointments(userId: string) {
        const access = await this.ensureWeeklyBoardAccess(userId);
        if (access.scope !== 'doctor') {
            throw new ForbiddenException('Доступно лише для лікаря');
        }

        const doctorIds = [access.user.id, access.doctorEntity?.id].filter(Boolean) as string[];
        const appointments = await this.appointmentRepository.find({
            where: doctorIds.map((doctorId) => ({ doctorId })),
            relations: ['patient'],
            order: {
                appointmentDate: 'DESC',
                createdAt: 'DESC',
            },
        });

        const filtered = appointments.filter((item) => this.isPastOrCompletedAppointment(item));

        return {
            ok: true,
            appointments: await Promise.all(filtered.map((item) => this.mapDoctorArchiveAppointment(item, { accessType: 'OWN' }))),
        };
    }

    async getDoctorSharedArchiveAppointments(userId: string) {
        const access = await this.ensureWeeklyBoardAccess(userId);
        if (access.scope !== 'doctor') {
            throw new ForbiddenException('Доступно лише для лікаря');
        }

        const now = new Date();
        const grants = await this.videoAccessGrantRepository.find({
            where: { sharedWithDoctorId: access.user.id },
            order: { updatedAt: 'DESC', createdAt: 'DESC' },
        });

        const byAppointment = new Map<string, { sharedByDoctorId: string; accessExpiresAt: Date | null }>();
        for (const grant of grants) {
            if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= now.getTime()) {
                continue;
            }
            if (!byAppointment.has(grant.appointmentId)) {
                byAppointment.set(grant.appointmentId, {
                    sharedByDoctorId: grant.sharedByDoctorId,
                    accessExpiresAt: grant.expiresAt || null,
                });
            }
        }

        const appointmentIds = [...byAppointment.keys()];
        if (!appointmentIds.length) {
            return { ok: true, appointments: [] };
        }

        const appointments = await this.appointmentRepository.find({
            where: appointmentIds.map((id) => ({ id })),
            relations: ['patient'],
            order: {
                appointmentDate: 'DESC',
                createdAt: 'DESC',
            },
        });

        const mapped = await Promise.all(
            appointments
                .filter((item) => this.isPastOrCompletedAppointment(item))
                .map(async (item) => {
                    const shareMeta = byAppointment.get(item.id)!;
                    const sharedByDoctor = await this.resolveDoctorByAnyId(shareMeta.sharedByDoctorId);
                    return this.mapDoctorArchiveAppointment(item, {
                        accessType: 'SHARED',
                        sharedByDoctorName: sharedByDoctor ? this.getDoctorDisplayName(sharedByDoctor) : null,
                        accessExpiresAt: shareMeta.accessExpiresAt,
                    });
                }),
        );

        return {
            ok: true,
            appointments: mapped,
        };
    }

    async getConsultationPdfBufferWithPassword(
        appointmentId: string,
        actor: JwtUser,
        password: string,
    ) {
        await this.verifyActorPassword(actor.id, password);

        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new NotFoundException('Запис не знайдено');
        }

        if (actor.role === UserRole.DOCTOR) {
            const ownsAppointment = await this.doctorOwnsAppointment(appointment, actor.id);
            const hasSharedAccess = ownsAppointment ? false : await this.hasDoctorSharedAccess(appointment.id, actor.id);
            if (!ownsAppointment && !hasSharedAccess) {
                throw new ForbiddenException('Немає доступу до цього прийому');
            }
        } else if (actor.role === UserRole.PATIENT) {
            if (!actor.patientId || appointment.patient?.id !== actor.patientId) {
                throw new ForbiddenException('Немає доступу до цього прийому');
            }
        } else if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException('Немає доступу до цього прийому');
        }

        const doctor = appointment.doctorId ? await this.resolveDoctorByAnyId(appointment.doctorId) : null;
        return this.mailService.buildConsultationPdfBuffer({
            patientName: this.buildPatientDisplayName(appointment.patient),
            doctorName: doctor ? this.getDoctorDisplayName(doctor) : 'Лікар клініки',
            appointmentDate: appointment.appointmentDate,
            conclusion: appointment.consultationConclusion || '',
            treatmentPlanItems: appointment.treatmentPlanItems || [],
            recommendationItems: appointment.recommendationItems || [],
            medicationItems: appointment.medicationItems || [],
            nextVisitDate: null,
        });
    }

    async updateVisitFlowStatus(userId: string, appointmentId: string, visitFlowStatus: string) {
        const appointment = await this.getAppointmentOrThrow(appointmentId);
        const access = await this.ensureWeeklyBoardAccess(userId, appointment);

        const normalized = String(visitFlowStatus || '').trim().toUpperCase();
        const allowed = ['SCHEDULED', 'WAITING_CALL', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];
        if (!allowed.includes(normalized)) {
            throw new BadRequestException('Невірний статус візиту');
        }

        if (normalized === 'WAITING_CALL' || normalized === 'NO_SHOW') {
            if (access.scope !== 'admin') {
                throw new ForbiddenException('Лише адміністратор може змінити цей статус');
            }
        }

        if (normalized === 'WAITING_CALL') {
            await this.propagateWaitingCallChain(appointment);
            const updated = await this.getAppointmentOrThrow(appointmentId);
            return {
                ok: true,
                appointment: await this.mapWeeklyAppointment(updated),
            };
        }

        appointment.visitFlowStatus = normalized;
        const saved = await this.appointmentRepository.save(appointment);

        if (normalized === 'NO_SHOW' && appointment.patient?.email) {
            const appointmentLine = await this.buildAppointmentLineFromEntity(saved);
            await this.mailService.sendAppointmentNoShowEmail({
                to: appointment.patient.email,
                patientName: this.buildPatientDisplayName(appointment.patient),
                appointmentLine,
            });
        }

        return {
            ok: true,
            appointment: await this.mapWeeklyAppointment(saved),
        };
    }

    async markAppointmentPaid(userId: string, appointmentId: string) {
        const appointment = await this.getAppointmentOrThrow(appointmentId);
        await this.ensureAdminOrSuperAdmin(userId);

        if (appointment.paymentStatus === PaymentStatus.PAID) {
            return {
                ok: true,
                appointment: await this.mapWeeklyAppointment(appointment),
            };
        }

        const service = appointment.serviceId
            ? await this.clinicServiceRepository.findOne({ where: { id: appointment.serviceId } })
            : null;

        appointment.paymentStatus = PaymentStatus.PAID;
        appointment.paymentMethod = appointment.paymentMethod || PaymentMethod.CASH;
        appointment.paidAt = appointment.paidAt || new Date();
        appointment.paidAmountUah = Number(appointment.paidAmountUah || service?.priceUah || 0);
        appointment.receiptNumber = appointment.receiptNumber || this.generateReceiptNumber();

        const saved = await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            appointment: await this.mapWeeklyAppointment(saved),
        };
    }

    async changeAppointmentCabinet(userId: string, appointmentId: string, cabinetId: string) {
        const appointment = await this.getAppointmentOrThrow(appointmentId);
        await this.ensureAdminOrSuperAdmin(userId);

        const availableCabinets = await this.getAvailableCabinetsForAppointment(appointment);
        const matched = availableCabinets.find((item) => item.id === cabinetId);

        if (!matched) {
            throw new BadRequestException('Кабінет недоступний для цього запису');
        }

        appointment.cabinetId = cabinetId;
        const saved = await this.appointmentRepository.save(appointment);

        return {
            ok: true,
            appointment: await this.mapWeeklyAppointment(saved),
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

        if (appointment.patient?.email) {
            const appointmentLine = await this.buildAppointmentLineFromEntity(appointment);
            await this.mailService.sendAppointmentCancelledEmail({
                to: appointment.patient.email,
                patientName: this.buildPatientDisplayName(appointment.patient),
                appointmentLine,
                reason: appointment.cancelReason || undefined,
            });
        }

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

        const previousLine = await this.buildAppointmentLineFromEntity(appointment);

        const resolvedStep = service
            ? await this.ensureScheduleAllowsBooking(
                nextDoctorId,
                appointment.serviceId!,
                nextDate.toISOString(),
                appointment.cabinetId || null,
                appointment.id,
            )
            : null;

        appointment.doctorId = nextDoctorId;
        appointment.cabinetId = resolvedStep?.cabinetId || null;
        appointment.durationMinutes = resolvedStep?.durationMinutes || appointment.durationMinutes || Number(service?.durationMinutes || 20);
        appointment.appointmentDate = nextDate;

        await this.appointmentRepository.save(appointment);

        if (appointment.patient?.email) {
            const nextLine = await this.buildAppointmentLineFromEntity(appointment);
            await this.mailService.sendAppointmentRescheduledEmail({
                to: appointment.patient.email,
                patientName: this.buildPatientDisplayName(appointment.patient),
                previousAppointmentLine: previousLine,
                nextAppointmentLine: nextLine,
            });
        }

        return {
            ok: true,
            message: 'Запис успішно перенесено',
            appointmentId: appointment.id,
            appointmentDate: appointment.appointmentDate,
            doctorId: appointment.doctorId,
        };
    }

}