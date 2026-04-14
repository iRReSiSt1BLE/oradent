import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { DoctorWorkSchedule } from './entities/doctor-work-schedule.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { Appointment } from '../appointment/entities/appointment.entity';
import { UserService } from '../user/user.service';
import { AdminService } from '../admin/admin.service';
import { UserRole } from '../common/enums/user-role.enum';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { BlockDoctorDayDto } from './dto/block-doctor-day.dto';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';

type BreakInterval = { start: string; end: string };
type DayRule = {
    weekday: number;
    enabled: boolean;
    start: string;
    end: string;
    breaks: BreakInterval[];
};
type CycleRule = {
    workDays: number;
    offDays: number;
    anchorDate: string;
    start: string;
    end: string;
    breaks: BreakInterval[];
};
type BlockedSlot = { date: string; start: string; end: string; reason?: string };

type DaySlotsResult = {
    enabled: boolean;
    reason: string;
    slots: Array<{ time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }>;
};

type DayConflictInfo = {
    hasAppointments: boolean;
    appointmentsCount: number;
    appointments: Array<{
        id: string;
        appointmentDate: Date | null;
        status: string;
        patient: {
            id: string;
            lastName: string;
            firstName: string;
            middleName: string | null;
            phone: string | null;
        } | null;
        serviceId: string | null;
    }>;
};

@Injectable()
export class DoctorScheduleService {
    constructor(
        @InjectRepository(DoctorWorkSchedule)
        private readonly scheduleRepository: Repository<DoctorWorkSchedule>,
        @InjectRepository(Doctor)
        private readonly doctorRepository: Repository<Doctor>,
        @InjectRepository(Appointment)
        private readonly appointmentRepository: Repository<Appointment>,
        @InjectRepository(ClinicServiceEntity)
        private readonly serviceRepository: Repository<ClinicServiceEntity>,
        private readonly userService: UserService,
        private readonly adminService: AdminService,
    ) {}

    private readonly bookingWindowDays = 90;


    private defaultCycleTemplate(): CycleRule {
        return {
            workDays: 5,
            offDays: 2,
            anchorDate: this.toDateKey(new Date()),
            start: '09:00',
            end: '18:00',
            breaks: [{ start: '13:00', end: '14:00' }],
        };
    }

    private ensureTime(value: string) {
        if (!/^\d{2}:\d{2}$/.test(value)) {
            throw new BadRequestException('Невірний формат часу');
        }

        const [h, m] = value.split(':').map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
            throw new BadRequestException('Невірний формат часу');
        }
    }

    private ensureDate(value: string) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new BadRequestException('Невірний формат дати');
        }

        const d = new Date(`${value}T00:00:00`);
        if (Number.isNaN(d.getTime())) {
            throw new BadRequestException('Невірний формат дати');
        }
    }

    private timeToMinutes(value: string): number {
        const [h, m] = value.split(':').map(Number);
        return h * 60 + m;
    }

    private minutesToTime(value: number): string {
        const h = Math.floor(value / 60);
        const m = value % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    private toDateKey(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private dateFromKey(key: string): Date {
        return new Date(`${key}T00:00:00`);
    }

    private isSameDay(date: Date, dateIso: string) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}` === dateIso;
    }

    private normalizeBreaks(breaks: BreakInterval[]): BreakInterval[] {
        const normalized = breaks
            .map((b) => ({ start: b.start, end: b.end }))
            .filter((b) => {
                this.ensureTime(b.start);
                this.ensureTime(b.end);
                return this.timeToMinutes(b.end) > this.timeToMinutes(b.start);
            })
            .sort((a, b) => this.timeToMinutes(a.start) - this.timeToMinutes(b.start));

        const merged: BreakInterval[] = [];
        for (const item of normalized) {
            const last = merged[merged.length - 1];
            if (!last) {
                merged.push(item);
                continue;
            }

            const lastEnd = this.timeToMinutes(last.end);
            const curStart = this.timeToMinutes(item.start);

            if (curStart <= lastEnd) {
                last.end = this.minutesToTime(
                    Math.max(lastEnd, this.timeToMinutes(item.end)),
                );
            } else {
                merged.push(item);
            }
        }

        return merged;
    }

    private validateRule(rule: {
        start: string;
        end: string;
        breaks: BreakInterval[];
    }) {
        this.ensureTime(rule.start);
        this.ensureTime(rule.end);

        const start = this.timeToMinutes(rule.start);
        const end = this.timeToMinutes(rule.end);

        if (end <= start) {
            throw new BadRequestException(
                'Кінець зміни має бути пізніше за початок',
            );
        }

        const breaks = this.normalizeBreaks(rule.breaks || []);
        for (const br of breaks) {
            const bs = this.timeToMinutes(br.start);
            const be = this.timeToMinutes(br.end);
            if (bs < start || be > end) {
                throw new BadRequestException(
                    'Перерва виходить за межі робочого часу',
                );
            }
        }
    }

    private getBookingWindow() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setDate(end.getDate() + this.bookingWindowDays);
        end.setHours(23, 59, 59, 999);

        return { start, end };
    }

    private isDateInsideBookingWindow(dateKey: string): boolean {
        const date = this.dateFromKey(dateKey);
        const { start, end } = this.getBookingWindow();
        return date >= start && date <= end;
    }

    private ensureDateInsideBookingWindow(date: Date) {
        const { start, end } = this.getBookingWindow();
        if (date < start || date > end) {
            throw new BadRequestException(
                'Запис доступний лише на 3 місяці наперед',
            );
        }
    }

    private async ensureManagerAccess(currentUserId: string) {
        const user = await this.userService.findById(currentUserId);
        if (!user) {
            throw new ForbiddenException('Користувача не знайдено');
        }

        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException('Доступ лише для ADMIN та SUPER_ADMIN');
        }

        const admin = await this.adminService.findByUserId(currentUserId);
        if (!admin || !admin.isActive) {
            throw new ForbiddenException('Адміністратора деактивовано');
        }

        return user;
    }

    private async getDoctorOrThrow(doctorId: string): Promise<Doctor> {
        const doctor = await this.doctorRepository.findOne({
            where: [
                { id: doctorId },
                { user: { id: doctorId } },
            ],
            relations: ['user'],
        });

        if (!doctor) {
            throw new NotFoundException('Лікаря не знайдено');
        }

        return doctor;
    }

    private async getOrCreateSchedule(doctor: Doctor): Promise<DoctorWorkSchedule> {
        const existing = await this.scheduleRepository.findOne({
            where: { doctor: { id: doctor.id } },
        });
        if (existing) return existing;

        const entity = this.scheduleRepository.create({
            doctor,
            timezone: 'Europe/Kiev',
            slotMinutes: 20,
            workDaysConfigEnabled: false,
            workDaysMode: 'cycle',
            cycleTemplate: this.defaultCycleTemplate(),
            manualWeekTemplate: {
                anchorDate: this.toDateKey(new Date()),
                weekdays: [1, 2, 3, 4, 5],
                start: '09:00',
                end: '18:00',
                breaks: [{ start: '13:00', end: '14:00' }],
            },
            dayOverrides: [],
            blockedDays: [],
            blockedSlots: [],
            updatedByUserId: null,
        });

        try {
            return await this.scheduleRepository.save(entity);
        } catch (error: unknown) {
            const maybeDriverCode =
                typeof error === 'object' &&
                error !== null &&
                'driverError' in error &&
                typeof (error as { driverError?: { code?: string } }).driverError?.code === 'string'
                    ? (error as { driverError?: { code?: string } }).driverError?.code
                    : '';

            if (maybeDriverCode === 'ER_DUP_ENTRY') {
                const createdByParallelRequest = await this.scheduleRepository.findOne({
                    where: { doctor: { id: doctor.id } },
                });
                if (createdByParallelRequest) return createdByParallelRequest;
            }

            throw error;
        }
    }


    private getTemplateRuleForDate(schedule: DoctorWorkSchedule, dateKey: string) {
        if (!schedule.workDaysConfigEnabled) {
            return {
                enabled: true,
                start: '09:00',
                end: '18:00',
                breaks: [{ start: '13:00', end: '14:00' }] as BreakInterval[],
                source: 'default-open',
            };
        }

        if (schedule.workDaysMode === 'manual' && schedule.manualWeekTemplate) {
            const manual = schedule.manualWeekTemplate;
            this.ensureDate(manual.anchorDate);

            const targetDate = this.dateFromKey(dateKey);
            const anchorDate = this.dateFromKey(manual.anchorDate);

            if (targetDate < anchorDate) {
                return {
                    enabled: true,
                    start: '09:00',
                    end: '18:00',
                    breaks: [{ start: '13:00', end: '14:00' }] as BreakInterval[],
                    source: 'before-anchor',
                };
            }

            const weekday = targetDate.getDay();
            const isEnabled = manual.weekdays.includes(weekday);

            return {
                enabled: isEnabled,
                start: manual.start,
                end: manual.end,
                breaks: this.normalizeBreaks(manual.breaks || []),
                source: 'manual',
            };
        }

        if (schedule.cycleTemplate) {
            const cycle = schedule.cycleTemplate;
            this.ensureDate(cycle.anchorDate);

            const targetDateObj = this.dateFromKey(dateKey);
            const anchorDateObj = this.dateFromKey(cycle.anchorDate);

            if (targetDateObj < anchorDateObj) {
                return {
                    enabled: true,
                    start: '09:00',
                    end: '18:00',
                    breaks: [{ start: '13:00', end: '14:00' }] as BreakInterval[],
                    source: 'before-anchor',
                };
            }

            const targetDate = targetDateObj.getTime();
            const anchorDate = anchorDateObj.getTime();
            const diffDays = Math.floor(
                (targetDate - anchorDate) / (1000 * 60 * 60 * 24),
            );
            const period = cycle.workDays + cycle.offDays;
            const mod = ((diffDays % period) + period) % period;
            const isWorkDay = mod < cycle.workDays;

            return {
                enabled: isWorkDay,
                start: cycle.start,
                end: cycle.end,
                breaks: this.normalizeBreaks(cycle.breaks || []),
                source: 'cycle',
            };
        }

        return {
            enabled: true,
            start: '09:00',
            end: '18:00',
            breaks: [{ start: '13:00', end: '14:00' }] as BreakInterval[],
            source: 'default-open',
        };
    }



    private getDayRuleForDate(schedule: DoctorWorkSchedule, dateKey: string) {
        const override = (schedule.dayOverrides || []).find((o) => o.date === dateKey);
        if (override) {
            return {
                enabled: override.enabled,
                start: override.start,
                end: override.end,
                breaks: this.normalizeBreaks(override.breaks || []),
                source: 'override',
            };
        }

        const blockedDays = schedule.blockedDays || [];
        if (blockedDays.includes(dateKey)) {
            return {
                enabled: false,
                start: '00:00',
                end: '00:00',
                breaks: [] as BreakInterval[],
                source: 'blocked-day',
            };
        }

        return this.getTemplateRuleForDate(schedule, dateKey);
    }

    private async getServiceDurationsMap(serviceIds: string[]): Promise<Map<string, number>> {
        if (!serviceIds.length) return new Map<string, number>();

        const uniqueIds = Array.from(new Set(serviceIds));
        const services = await this.serviceRepository
            .createQueryBuilder('service')
            .where('service.id IN (:...ids)', { ids: uniqueIds })
            .getMany();

        const map = new Map<string, number>();
        for (const service of services) {
            map.set(service.id, Number(service.durationMinutes) || 20);
        }
        return map;
    }

    private expandAppointmentToOccupiedSlots(
        appointmentDate: Date,
        durationMinutes: number,
        slotMinutes: number,
    ): string[] {
        const start = appointmentDate.getHours() * 60 + appointmentDate.getMinutes();
        const slotsCount = Math.max(1, Math.ceil(durationMinutes / slotMinutes));

        const result: string[] = [];
        for (let i = 0; i < slotsCount; i += 1) {
            result.push(this.minutesToTime(start + i * slotMinutes));
        }
        return result;
    }

    private async getBookedSlotsMapForRange(
        doctor: Doctor,
        startDateTime: Date,
        endDateTime: Date,
        slotMinutes: number,
        excludeAppointmentId?: string,
    ): Promise<Map<string, Set<string>>> {
        const appointments = await this.appointmentRepository.find({
            where: [
                { doctorId: doctor.id, appointmentDate: Between(startDateTime, endDateTime) } as any,
                { doctorId: doctor.user.id, appointmentDate: Between(startDateTime, endDateTime) } as any,
            ],
        });

        const serviceIds = appointments
            .map((a) => a.serviceId)
            .filter((id): id is string => Boolean(id));

        const durationsMap = await this.getServiceDurationsMap(serviceIds);

        const map = new Map<string, Set<string>>();

        for (const appt of appointments) {
            if (excludeAppointmentId && appt.id === excludeAppointmentId) continue;
            if (!appt.appointmentDate) continue;
            if (appt.status === 'CANCELLED') continue;

            const dateKey = this.toDateKey(appt.appointmentDate);
            const duration = appt.durationMinutes
                ? Number(appt.durationMinutes)
                : appt.serviceId
                    ? (durationsMap.get(appt.serviceId) || 20)
                    : 20;
            const slots = this.expandAppointmentToOccupiedSlots(
                appt.appointmentDate,
                duration,
                slotMinutes,
            );

            if (!map.has(dateKey)) map.set(dateKey, new Set<string>());
            const set = map.get(dateKey)!;
            for (const s of slots) set.add(s);
        }

        return map;
    }

    private buildDaySlots(
        schedule: DoctorWorkSchedule,
        dateKey: string,
        bookedSlots: Set<string>,
    ): DaySlotsResult {
        if (!this.isDateInsideBookingWindow(dateKey)) {
            return { enabled: false, reason: 'out-of-window', slots: [] };
        }

        const dayRule = this.getDayRuleForDate(schedule, dateKey);
        if (!dayRule.enabled) {
            return { enabled: false, reason: dayRule.source, slots: [] };
        }

        const start = this.timeToMinutes(dayRule.start);
        const end = this.timeToMinutes(dayRule.end);
        const step = schedule.slotMinutes;
        const blockedSlots = (schedule.blockedSlots || []).filter((b) => b.date === dateKey);

        const slots: Array<{ time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }> = [];

        for (let minute = start; minute + step <= end; minute += step) {
            const t = this.minutesToTime(minute);

            const inBreak = dayRule.breaks.some((br) => {
                const bs = this.timeToMinutes(br.start);
                const be = this.timeToMinutes(br.end);
                return minute >= bs && minute < be;
            });
            if (inBreak) continue;

            const now = new Date();
            const slotDateTime = new Date(`${dateKey}T${t}:00`);
            if (slotDateTime.getTime() <= now.getTime()) {
                slots.push({ time: t, state: 'BLOCKED' });
                continue;
            }

            const blocked = blockedSlots.some((b) => {
                const bs = this.timeToMinutes(b.start);
                const be = this.timeToMinutes(b.end);
                return minute >= bs && minute < be;
            });
            if (blocked) {
                slots.push({ time: t, state: 'BLOCKED' });
                continue;
            }

            if (bookedSlots.has(t)) {
                slots.push({ time: t, state: 'BOOKED' });
                continue;
            }

            slots.push({ time: t, state: 'FREE' });
        }

        return { enabled: true, reason: 'working', slots };
    }

    private async buildDaySlotsByDateMap(
        doctor: Doctor,
        schedule: DoctorWorkSchedule,
        dateKeys: string[],
    ): Promise<Map<string, DaySlotsResult>> {
        if (!dateKeys.length) {
            return new Map<string, DaySlotsResult>();
        }

        const sorted = [...dateKeys].sort();

        const rangeStart = this.dateFromKey(sorted[0]);
        rangeStart.setHours(0, 0, 0, 0);

        const rangeEnd = this.dateFromKey(sorted[sorted.length - 1]);
        rangeEnd.setHours(23, 59, 59, 999);

        const bookedByDate = await this.getBookedSlotsMapForRange(
            doctor,
            rangeStart,
            rangeEnd,
            schedule.slotMinutes,
        );

        const result = new Map<string, DaySlotsResult>();

        for (const dateKey of dateKeys) {
            const booked = bookedByDate.get(dateKey) || new Set<string>();
            result.set(dateKey, this.buildDaySlots(schedule, dateKey, booked));
        }

        return result;
    }



    private async getAppointmentsForDoctorDay(doctorId: string, dateIso: string): Promise<Appointment[]> {
        const doctor = await this.getDoctorOrThrow(doctorId);

        const appointments = await this.appointmentRepository.find({
            where: [
                { doctorId: doctor.id } as any,
                { doctorId: doctor.user.id } as any,
            ],
            relations: ['patient'],
            order: {
                appointmentDate: 'ASC',
            },
        });

        return appointments.filter((appointment: Appointment) => {
            if (!appointment.appointmentDate) return false;
            if (appointment.status === 'CANCELLED') return false;
            return this.isSameDay(new Date(appointment.appointmentDate), dateIso);
        });
    }

    private async getDayConflictInfo(
        doctorId: string,
        dateIso: string,
    ): Promise<DayConflictInfo> {
        const appointments: Appointment[] = await this.getAppointmentsForDoctorDay(doctorId, dateIso);

        return {
            hasAppointments: appointments.length > 0,
            appointmentsCount: appointments.length,
            appointments: appointments.map((item: Appointment) => ({
                id: item.id,
                appointmentDate: item.appointmentDate,
                status: item.status,
                patient: item.patient
                    ? {
                        id: item.patient.id,
                        lastName: item.patient.lastName,
                        firstName: item.patient.firstName,
                        middleName: item.patient.middleName,
                        phone: item.patient.phone,
                    }
                    : null,
                serviceId: item.serviceId ?? null,
            })),
        };
    }

    async ensureSlotAvailableForBooking(
        doctorId: string,
        appointmentDate: Date,
        serviceDurationMinutes: number,
        excludeAppointmentId?: string,
    ) {
        this.ensureDateInsideBookingWindow(appointmentDate);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);
        const dateKey = this.toDateKey(appointmentDate);

        const bookedByDate = await this.getBookedSlotsMapForRange(
            doctor,
            new Date(`${dateKey}T00:00:00`),
            new Date(`${dateKey}T23:59:59.999`),
            schedule.slotMinutes,
            excludeAppointmentId,
        );

        const booked = bookedByDate.get(dateKey) || new Set<string>();
        const day = this.buildDaySlots(schedule, dateKey, booked);

        if (!day || !day.enabled) {
            throw new BadRequestException('На цю дату запис недоступний');
        }

        const startTime = this.minutesToTime(
            appointmentDate.getHours() * 60 + appointmentDate.getMinutes(),
        );
        const needed = Math.max(
            1,
            Math.ceil(serviceDurationMinutes / schedule.slotMinutes),
        );

        const freeTimes = day.slots
            .filter((s) => s.state === 'FREE')
            .map((s) => s.time);

        if (!freeTimes.includes(startTime)) {
            throw new BadRequestException('Обраний час вже недоступний');
        }

        const startMinute = this.timeToMinutes(startTime);
        for (let i = 0; i < needed; i += 1) {
            const check = this.minutesToTime(startMinute + i * schedule.slotMinutes);
            if (!freeTimes.includes(check)) {
                throw new BadRequestException(
                    'Час перетинається з іншим записом або блокуванням',
                );
            }
        }
    }

    async getRawSchedule(doctorId: string) {
        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        return {
            ok: true,
            schedule: {
                doctorId: doctor.id,
                timezone: schedule.timezone,
                slotMinutes: schedule.slotMinutes,
                cycleTemplate: schedule.cycleTemplate || this.defaultCycleTemplate(),
                dayOverrides: schedule.dayOverrides || [],
                blockedDays: schedule.blockedDays || [],
                blockedSlots: schedule.blockedSlots || [],
                updatedAt: schedule.updatedAt,
                workDaysConfigEnabled: schedule.workDaysConfigEnabled,
                workDaysMode: schedule.workDaysMode,
                manualWeekTemplate: schedule.manualWeekTemplate || {
                    anchorDate: this.toDateKey(new Date()),
                    weekdays: [1, 2, 3, 4, 5],
                    start: '09:00',
                    end: '18:00',
                    breaks: [{ start: '13:00', end: '14:00' }],
                },
            },
        };
    }

    async updateSchedule(
        currentUserId: string,
        doctorId: string,
        dto: UpdateDoctorScheduleDto,
    ) {
        await this.ensureManagerAccess(currentUserId);
        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        if (dto.timezone) schedule.timezone = dto.timezone.trim();

        if (typeof dto.workDaysConfigEnabled === 'boolean') {
            schedule.workDaysConfigEnabled = dto.workDaysConfigEnabled;
        }

        if (dto.workDaysMode) {
            schedule.workDaysMode = dto.workDaysMode;
        }

        if (dto.slotMinutes && dto.slotMinutes !== schedule.slotMinutes) {
            const allAppointments = await this.appointmentRepository.find({
                where: [
                    { doctorId: doctor.id } as any,
                    { doctorId: doctor.user.id } as any,
                ],
            });

            const hasFutureAppointments = allAppointments.some((item) => {
                if (!item.appointmentDate) return false;
                if (item.status === 'CANCELLED') return false;
                return new Date(item.appointmentDate).getTime() >= Date.now();
            });

            if (hasFutureAppointments) {
                throw new BadRequestException(
                    JSON.stringify({
                        code: 'GLOBAL_SLOT_STEP_CHANGE_FORBIDDEN',
                    }),
                );
            }

            schedule.slotMinutes = dto.slotMinutes;
        }


        if (dto.cycleTemplate) {
            this.ensureDate(dto.cycleTemplate.anchorDate);
            this.validateRule(dto.cycleTemplate);
            schedule.cycleTemplate = {
                workDays: dto.cycleTemplate.workDays,
                offDays: dto.cycleTemplate.offDays,
                anchorDate: dto.cycleTemplate.anchorDate,
                start: dto.cycleTemplate.start,
                end: dto.cycleTemplate.end,
                breaks: this.normalizeBreaks(dto.cycleTemplate.breaks || []),
            };
        }

        if (dto.manualWeekTemplate) {
            this.ensureDate(dto.manualWeekTemplate.anchorDate);
            this.validateRule(dto.manualWeekTemplate);

            schedule.manualWeekTemplate = {
                anchorDate: dto.manualWeekTemplate.anchorDate,
                weekdays: [...new Set(dto.manualWeekTemplate.weekdays)].sort((a, b) => a - b),
                start: dto.manualWeekTemplate.start,
                end: dto.manualWeekTemplate.end,
                breaks: this.normalizeBreaks(dto.manualWeekTemplate.breaks || []),
            };
        }

        if (dto.dayOverrides) {
            const existingOverrides =
                dto.replaceDayOverrides === true
                    ? []
                    : Array.isArray(schedule.dayOverrides)
                        ? [...schedule.dayOverrides]
                        : [];

            for (const o of dto.dayOverrides) {
                this.ensureDate(o.date);
                this.validateRule(o);

                const makingDayOff = o.enabled === false;
                if (makingDayOff) {
                    const conflicts = await this.getDayConflictInfo(doctor.id, o.date);
                    if (conflicts.hasAppointments) {
                        throw new BadRequestException(
                            JSON.stringify({
                                code: 'DAY_HAS_APPOINTMENTS',
                                date: o.date,
                                appointmentsCount: conflicts.appointmentsCount,
                            }),
                        );
                    }
                }

                const normalizedOverride = {
                    date: o.date,
                    enabled: o.enabled,
                    start: o.start,
                    end: o.end,
                    breaks: this.normalizeBreaks(o.breaks || []),
                };

                const existingIndex = existingOverrides.findIndex(
                    (item) => item.date === o.date,
                );

                if (existingIndex >= 0) {
                    existingOverrides[existingIndex] = normalizedOverride;
                } else {
                    existingOverrides.push(normalizedOverride);
                }
            }

            schedule.dayOverrides = existingOverrides.sort((a, b) =>
                a.date.localeCompare(b.date),
            );
        }
        if (dto.replaceDayOverrides === true && (!dto.dayOverrides || dto.dayOverrides.length === 0)) {
            schedule.dayOverrides = [];
            schedule.blockedDays = [];
        }


        schedule.updatedByUserId = currentUserId;
        const saved = await this.scheduleRepository.save(schedule);

        return {
            ok: true,
            message: 'Графік лікаря оновлено',
            updatedAt: saved.updatedAt,
        };
    }

    async blockDay(
        currentUserId: string,
        doctorId: string,
        dto: BlockDoctorDayDto,
    ) {
        await this.ensureManagerAccess(currentUserId);
        this.ensureDate(dto.date);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        const conflicts = await this.getDayConflictInfo(doctor.id, dto.date);
        if (conflicts.hasAppointments) {
            throw new BadRequestException(
                JSON.stringify({
                    code: 'DAY_HAS_APPOINTMENTS',
                    date: dto.date,
                    appointmentsCount: conflicts.appointmentsCount,
                }),
            );
        }

        const list = new Set(schedule.blockedDays || []);
        list.add(dto.date);
        schedule.blockedDays = Array.from(list).sort();
        schedule.updatedByUserId = currentUserId;

        await this.scheduleRepository.save(schedule);

        return {
            ok: true,
            message: 'День заблоковано',
            blockedDays: schedule.blockedDays,
        };
    }

    async unblockDay(currentUserId: string, doctorId: string, date: string) {
        await this.ensureManagerAccess(currentUserId);
        this.ensureDate(date);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        schedule.blockedDays = (schedule.blockedDays || []).filter((d) => d !== date);
        schedule.updatedByUserId = currentUserId;

        await this.scheduleRepository.save(schedule);

        return {
            ok: true,
            message: 'Блокування дня знято',
            blockedDays: schedule.blockedDays,
        };
    }


    async getDayConflicts(
        currentUserId: string,
        doctorId: string,
        dateIso: string,
    ) {
        await this.ensureManagerAccess(currentUserId);
        this.ensureDate(dateIso);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const info = await this.getDayConflictInfo(doctor.id, dateIso);

        return {
            ok: true,
            date: dateIso,
            ...info,
        };
    }

    async getMonth(doctorId: string, month: string) {
        if (!/^\d{4}-\d{2}$/.test(month)) {
            throw new BadRequestException(
                'Невірний формат month. Потрібно YYYY-MM',
            );
        }

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        const [year, mon] = month.split('-').map(Number);
        const startDate = new Date(year, mon - 1, 1);
        const endDate = new Date(year, mon, 0);

        const keys: string[] = [];
        for (
            let d = new Date(startDate);
            d <= endDate;
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
        ) {
            keys.push(this.toDateKey(d));
        }

        const daysMap = await this.buildDaySlotsByDateMap(doctor, schedule, keys);

        const days = await Promise.all(
            keys.map(async (dateKey) => {
                const day = daysMap.get(dateKey);
                const total = day?.slots.length || 0;
                const free = (day?.slots || []).filter((s) => s.state === 'FREE').length;
                const conflictInfo = await this.getDayConflictInfo(doctor.id, dateKey);
                const templateRule = this.getTemplateRuleForDate(schedule, dateKey);
                const hasConflicts = !templateRule.enabled && conflictInfo.hasAppointments;

                return {
                    date: dateKey,
                    isWorking: hasConflicts ? true : Boolean(day?.enabled),
                    freeSlots: free,
                    totalSlots: total,
                    hasConflicts,
                };
            }),
        );

        return {
            ok: true,
            doctorId: doctor.id,
            month,
            timezone: schedule.timezone,
            slotMinutes: schedule.slotMinutes,
            days,
        };
    }

    async getDay(doctorId: string, date: string) {
        this.ensureDate(date);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        const dayMap = await this.buildDaySlotsByDateMap(doctor, schedule, [date]);
        const result =
            dayMap.get(date) || {
                enabled: false,
                reason: 'out-of-window',
                slots: [] as Array<{ time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }>,
            };

        return {
            ok: true,
            date,
            timezone: schedule.timezone,
            slotMinutes: schedule.slotMinutes,
            bookingWindowDays: this.bookingWindowDays,
            isWorking: result.enabled,
            reason: result.reason,
            slots: result.slots,
            blockedSlots: (schedule.blockedSlots || []).filter((b) => b.date === date),
            blockedDay: (schedule.blockedDays || []).includes(date),
        };
    }
}