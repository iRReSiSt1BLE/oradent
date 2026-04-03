import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { DoctorWorkSchedule } from './entities/doctor-work-schedule.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { Appointment } from '../appointment/entities/appointment.entity';
import { UserService } from '../user/user.service';
import { AdminService } from '../admin/admin.service';
import { UserRole } from '../common/enums/user-role.enum';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { BlockDoctorDayDto } from './dto/block-doctor-day.dto';
import { BlockDoctorSlotDto } from './dto/block-doctor-slot.dto';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';

type BreakInterval = { start: string; end: string };
type DayRule = { weekday: number; enabled: boolean; start: string; end: string; breaks: BreakInterval[] };
type CycleRule = { workDays: number; offDays: number; anchorDate: string; start: string; end: string; breaks: BreakInterval[] };
type BlockedSlot = { date: string; start: string; end: string; reason?: string };

type DaySlotsResult = {
    enabled: boolean;
    reason: string;
    slots: Array<{ time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }>;
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

    private readonly bookingWindowDays = 30;

    private defaultWeeklyTemplate(): DayRule[] {
        return [
            { weekday: 0, enabled: false, start: '09:00', end: '18:00', breaks: [] },
            { weekday: 1, enabled: true, start: '09:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00' }] },
            { weekday: 2, enabled: true, start: '09:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00' }] },
            { weekday: 3, enabled: true, start: '09:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00' }] },
            { weekday: 4, enabled: true, start: '09:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00' }] },
            { weekday: 5, enabled: true, start: '09:00', end: '18:00', breaks: [{ start: '13:00', end: '14:00' }] },
            { weekday: 6, enabled: false, start: '10:00', end: '14:00', breaks: [] },
        ];
    }

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
        if (!/^\d{2}:\d{2}$/.test(value)) throw new BadRequestException('ÐÐµÐ²Ñ–Ñ€Ð½Ð¸Ð¹ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚ Ñ‡Ð°ÑÑƒ');
        const [h, m] = value.split(':').map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) throw new BadRequestException('ÐÐµÐ²Ñ–Ñ€Ð½Ð¸Ð¹ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚ Ñ‡Ð°ÑÑƒ');
    }

    private ensureDate(value: string) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('ÐÐµÐ²Ñ–Ñ€Ð½Ð¸Ð¹ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚ Ð´Ð°Ñ‚Ð¸');
        const d = new Date(`${value}T00:00:00`);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('ÐÐµÐ²Ñ–Ñ€Ð½Ð¸Ð¹ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚ Ð´Ð°Ñ‚Ð¸');
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
                last.end = this.minutesToTime(Math.max(lastEnd, this.timeToMinutes(item.end)));
            } else {
                merged.push(item);
            }
        }

        return merged;
    }

    private validateRule(rule: { start: string; end: string; breaks: BreakInterval[] }) {
        this.ensureTime(rule.start);
        this.ensureTime(rule.end);

        const start = this.timeToMinutes(rule.start);
        const end = this.timeToMinutes(rule.end);
        if (end <= start) throw new BadRequestException('ÐšÑ–Ð½ÐµÑ†ÑŒ Ð·Ð¼Ñ–Ð½Ð¸ Ð¼Ð°Ñ” Ð±ÑƒÑ‚Ð¸ Ð¿Ñ–Ð·Ð½Ñ–ÑˆÐµ Ð·Ð° Ð¿Ð¾Ñ‡Ð°Ñ‚Ð¾Ðº');

        const breaks = this.normalizeBreaks(rule.breaks || []);
        for (const br of breaks) {
            const bs = this.timeToMinutes(br.start);
            const be = this.timeToMinutes(br.end);
            if (bs < start || be > end) {
                throw new BadRequestException('ÐŸÐµÑ€ÐµÑ€Ð²Ð° Ð²Ð¸Ñ…Ð¾Ð´Ð¸Ñ‚ÑŒ Ð·Ð° Ð¼ÐµÐ¶Ñ– Ñ€Ð¾Ð±Ð¾Ñ‡Ð¾Ð³Ð¾ Ñ‡Ð°ÑÑƒ');
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
            throw new BadRequestException('Ð—Ð°Ð¿Ð¸Ñ Ð´Ð¾ÑÑ‚ÑƒÐ¿Ð½Ð¸Ð¹ Ð»Ð¸ÑˆÐµ Ð½Ð° 1 Ð¼Ñ–ÑÑÑ†ÑŒ Ð½Ð°Ð¿ÐµÑ€ÐµÐ´');
        }
    }

    private async ensureManagerAccess(currentUserId: string) {
        const user = await this.userService.findById(currentUserId);
        if (!user) throw new ForbiddenException('ÐšÐ¾Ñ€Ð¸ÑÑ‚ÑƒÐ²Ð°Ñ‡Ð° Ð½Ðµ Ð·Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾');

        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException('Ð”Ð¾ÑÑ‚ÑƒÐ¿ Ð»Ð¸ÑˆÐµ Ð´Ð»Ñ ADMIN Ñ‚Ð° SUPER_ADMIN');
        }

        const admin = await this.adminService.findByUserId(currentUserId);
        if (!admin || !admin.isActive) {
            throw new ForbiddenException('ÐÐ´Ð¼Ñ–Ð½Ñ–ÑÑ‚Ñ€Ð°Ñ‚Ð¾Ñ€Ð° Ð´ÐµÐ°ÐºÑ‚Ð¸Ð²Ð¾Ð²Ð°Ð½Ð¾');
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
        if (!doctor) throw new NotFoundException('Ð›Ñ–ÐºÐ°Ñ€Ñ Ð½Ðµ Ð·Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾');
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
            templateType: 'WEEKLY',
            weeklyTemplate: this.defaultWeeklyTemplate(),
            cycleTemplate: this.defaultCycleTemplate(),
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

    private getDayRuleForDate(schedule: DoctorWorkSchedule, dateKey: string) {
        const blockedDays = schedule.blockedDays || [];
        if (blockedDays.includes(dateKey)) {
            return { enabled: false, start: '00:00', end: '00:00', breaks: [] as BreakInterval[], source: 'blocked-day' };
        }

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

        if (schedule.templateType === 'CYCLE' && schedule.cycleTemplate) {
            const cycle = schedule.cycleTemplate;
            this.ensureDate(cycle.anchorDate);

            const targetDate = this.dateFromKey(dateKey).getTime();
            const anchorDate = this.dateFromKey(cycle.anchorDate).getTime();
            const diffDays = Math.floor((targetDate - anchorDate) / (1000 * 60 * 60 * 24));
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

        const weekday = this.dateFromKey(dateKey).getDay();
        const weekly = (schedule.weeklyTemplate || this.defaultWeeklyTemplate()).find((d) => d.weekday === weekday);

        if (!weekly) {
            return { enabled: false, start: '00:00', end: '00:00', breaks: [] as BreakInterval[], source: 'weekly' };
        }

        return {
            enabled: weekly.enabled,
            start: weekly.start,
            end: weekly.end,
            breaks: this.normalizeBreaks(weekly.breaks || []),
            source: 'weekly',
        };
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
    ): Promise<Map<string, Set<string>>> {
        const appointments = await this.appointmentRepository.find({
            where: [
                { doctorId: doctor.id, appointmentDate: Between(startDateTime, endDateTime) },
                { doctorId: doctor.user.id, appointmentDate: Between(startDateTime, endDateTime) },
            ],
        });

        const serviceIds = appointments
            .map((a) => a.serviceId)
            .filter((id): id is string => Boolean(id));

        const durationsMap = await this.getServiceDurationsMap(serviceIds);

        const map = new Map<string, Set<string>>();

        for (const appt of appointments) {
            if (!appt.appointmentDate) continue;

            const dateKey = this.toDateKey(appt.appointmentDate);
            const duration = appt.serviceId ? (durationsMap.get(appt.serviceId) || 20) : 20;
            const slots = this.expandAppointmentToOccupiedSlots(appt.appointmentDate, duration, slotMinutes);

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
        if (!dateKeys.length) return new Map<string, DaySlotsResult>();

        const sorted = [...dateKeys].sort();
        const rangeStart = this.dateFromKey(sorted[0]);
        rangeStart.setHours(0, 0, 0, 0);

        const rangeEnd = this.dateFromKey(sorted[sorted.length - 1]);
        rangeEnd.setHours(23, 59, 59, 999);

        const bookedByDate = await this.getBookedSlotsMapForRange(doctor, rangeStart, rangeEnd, schedule.slotMinutes);

        const result = new Map<string, DaySlotsResult>();
        for (const dateKey of dateKeys) {
            const booked = bookedByDate.get(dateKey) || new Set<string>();
            result.set(dateKey, this.buildDaySlots(schedule, dateKey, booked));
        }

        return result;
    }

    async ensureSlotAvailableForBooking(
        doctorId: string,
        appointmentDate: Date,
        serviceDurationMinutes: number,
    ) {
        this.ensureDateInsideBookingWindow(appointmentDate);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);
        const dateKey = this.toDateKey(appointmentDate);

        const dayMap = await this.buildDaySlotsByDateMap(doctor, schedule, [dateKey]);
        const day = dayMap.get(dateKey);

        if (!day || !day.enabled) {
            throw new BadRequestException('ÐÐ° Ñ†ÑŽ Ð´Ð°Ñ‚Ñƒ Ð·Ð°Ð¿Ð¸Ñ Ð½ÐµÐ´Ð¾ÑÑ‚ÑƒÐ¿Ð½Ð¸Ð¹');
        }

        const startTime = this.minutesToTime(appointmentDate.getHours() * 60 + appointmentDate.getMinutes());
        const needed = Math.max(1, Math.ceil(serviceDurationMinutes / schedule.slotMinutes));

        const freeTimes = day.slots.filter((s) => s.state === 'FREE').map((s) => s.time);
        if (!freeTimes.includes(startTime)) {
            throw new BadRequestException('ÐžÐ±Ñ€Ð°Ð½Ð¸Ð¹ Ñ‡Ð°Ñ Ð²Ð¶Ðµ Ð½ÐµÐ´Ð¾ÑÑ‚ÑƒÐ¿Ð½Ð¸Ð¹');
        }

        const startMinute = this.timeToMinutes(startTime);
        for (let i = 0; i < needed; i += 1) {
            const check = this.minutesToTime(startMinute + i * schedule.slotMinutes);
            if (!freeTimes.includes(check)) {
                throw new BadRequestException('Ð§Ð°Ñ Ð¿ÐµÑ€ÐµÑ‚Ð¸Ð½Ð°Ñ”Ñ‚ÑŒÑÑ Ð· Ñ–Ð½ÑˆÐ¸Ð¼ Ð·Ð°Ð¿Ð¸ÑÐ¾Ð¼ Ð°Ð±Ð¾ Ð±Ð»Ð¾ÐºÑƒÐ²Ð°Ð½Ð½ÑÐ¼');
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
                templateType: schedule.templateType,
                weeklyTemplate: schedule.weeklyTemplate || this.defaultWeeklyTemplate(),
                cycleTemplate: schedule.cycleTemplate || this.defaultCycleTemplate(),
                dayOverrides: schedule.dayOverrides || [],
                blockedDays: schedule.blockedDays || [],
                blockedSlots: schedule.blockedSlots || [],
                updatedAt: schedule.updatedAt,
            },
        };
    }

    async updateSchedule(currentUserId: string, doctorId: string, dto: UpdateDoctorScheduleDto) {
        await this.ensureManagerAccess(currentUserId);
        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        if (dto.timezone) schedule.timezone = dto.timezone.trim();
        if (dto.slotMinutes) schedule.slotMinutes = dto.slotMinutes;

        schedule.templateType = dto.templateType;

        if (dto.weeklyTemplate) {
            dto.weeklyTemplate.forEach((d) => this.validateRule(d));
            schedule.weeklyTemplate = [...dto.weeklyTemplate]
                .sort((a, b) => a.weekday - b.weekday)
                .map((d) => ({
                    weekday: d.weekday,
                    enabled: d.enabled,
                    start: d.start,
                    end: d.end,
                    breaks: this.normalizeBreaks(d.breaks || []),
                }));
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

        if (dto.dayOverrides) {
            dto.dayOverrides.forEach((o) => {
                this.ensureDate(o.date);
                this.validateRule(o);
            });

            const nextOverrides = (schedule.dayOverrides || []).filter(
                (existing) => !dto.dayOverrides?.some((incoming) => incoming.date === existing.date),
            );

            for (const o of dto.dayOverrides) {
                nextOverrides.push({
                    date: o.date,
                    enabled: o.enabled,
                    start: o.start,
                    end: o.end,
                    breaks: this.normalizeBreaks(o.breaks || []),
                });
            }

            schedule.dayOverrides = nextOverrides.sort((a, b) => a.date.localeCompare(b.date));
        }

        schedule.updatedByUserId = currentUserId;
        const saved = await this.scheduleRepository.save(schedule);

        return {
            ok: true,
            message: 'Ð“Ñ€Ð°Ñ„Ñ–Ðº Ð»Ñ–ÐºÐ°Ñ€Ñ Ð¾Ð½Ð¾Ð²Ð»ÐµÐ½Ð¾',
            updatedAt: saved.updatedAt,
        };
    }

    async blockDay(currentUserId: string, doctorId: string, dto: BlockDoctorDayDto) {
        await this.ensureManagerAccess(currentUserId);
        this.ensureDate(dto.date);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        const list = new Set(schedule.blockedDays || []);
        list.add(dto.date);
        schedule.blockedDays = Array.from(list).sort();
        schedule.updatedByUserId = currentUserId;

        await this.scheduleRepository.save(schedule);

        return {
            ok: true,
            message: 'Ð”ÐµÐ½ÑŒ Ð·Ð°Ð±Ð»Ð¾ÐºÐ¾Ð²Ð°Ð½Ð¾',
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
            message: 'Ð‘Ð»Ð¾ÐºÑƒÐ²Ð°Ð½Ð½Ñ Ð´Ð½Ñ Ð·Ð½ÑÑ‚Ð¾',
            blockedDays: schedule.blockedDays,
        };
    }

    async blockSlot(currentUserId: string, doctorId: string, dto: BlockDoctorSlotDto) {
        await this.ensureManagerAccess(currentUserId);
        this.ensureDate(dto.date);
        this.ensureTime(dto.start);
        this.ensureTime(dto.end);

        const start = this.timeToMinutes(dto.start);
        const end = this.timeToMinutes(dto.end);
        if (end <= start) throw new BadRequestException('ÐšÑ–Ð½ÐµÑ†ÑŒ Ñ–Ð½Ñ‚ÐµÑ€Ð²Ð°Ð»Ñƒ Ð¼Ð°Ñ” Ð±ÑƒÑ‚Ð¸ Ð¿Ñ–Ð·Ð½Ñ–ÑˆÐµ Ð·Ð° Ð¿Ð¾Ñ‡Ð°Ñ‚Ð¾Ðº');

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        const slots = schedule.blockedSlots || [];
        const exists = slots.some((s) => s.date === dto.date && s.start === dto.start && s.end === dto.end);

        if (!exists) {
            slots.push({
                date: dto.date,
                start: dto.start,
                end: dto.end,
                reason: dto.reason?.trim() || '',
            });
        }

        schedule.blockedSlots = slots.sort((a, b) => {
            if (a.date === b.date) return this.timeToMinutes(a.start) - this.timeToMinutes(b.start);
            return a.date.localeCompare(b.date);
        });

        schedule.updatedByUserId = currentUserId;
        await this.scheduleRepository.save(schedule);

        return {
            ok: true,
            message: 'Ð†Ð½Ñ‚ÐµÑ€Ð²Ð°Ð» Ñ‡Ð°ÑÑƒ Ð·Ð°Ð±Ð»Ð¾ÐºÐ¾Ð²Ð°Ð½Ð¾',
            blockedSlots: schedule.blockedSlots,
        };
    }

    async unblockSlot(currentUserId: string, doctorId: string, date: string, start: string, end: string) {
        await this.ensureManagerAccess(currentUserId);
        this.ensureDate(date);
        this.ensureTime(start);
        this.ensureTime(end);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        schedule.blockedSlots = (schedule.blockedSlots || []).filter(
            (s) => !(s.date === date && s.start === start && s.end === end),
        );
        schedule.updatedByUserId = currentUserId;
        await this.scheduleRepository.save(schedule);

        return {
            ok: true,
            message: 'Ð‘Ð»Ð¾ÐºÑƒÐ²Ð°Ð½Ð½Ñ Ñ–Ð½Ñ‚ÐµÑ€Ð²Ð°Ð»Ñƒ Ð·Ð½ÑÑ‚Ð¾',
            blockedSlots: schedule.blockedSlots,
        };
    }

    async getMonth(doctorId: string, month: string) {
        if (!/^\d{4}-\d{2}$/.test(month)) {
            throw new BadRequestException('ÐÐµÐ²Ñ–Ñ€Ð½Ð¸Ð¹ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚ month. ÐŸÐ¾Ñ‚Ñ€Ñ–Ð±Ð½Ð¾ YYYY-MM');
        }

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        const [year, mon] = month.split('-').map(Number);
        const startDate = new Date(year, mon - 1, 1);
        const endDate = new Date(year, mon, 0);

        const keys: string[] = [];
        for (let d = new Date(startDate); d <= endDate; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
            keys.push(this.toDateKey(d));
        }

        const daysMap = await this.buildDaySlotsByDateMap(doctor, schedule, keys);

        const days = keys.map((dateKey) => {
            const day = daysMap.get(dateKey);
            const total = day?.slots.length || 0;
            const free = (day?.slots || []).filter((s) => s.state === 'FREE').length;

            return {
                date: dateKey,
                isWorking: Boolean(day?.enabled),
                freeSlots: free,
                totalSlots: total,
            };
        });

        return {
            ok: true,
            month,
            timezone: schedule.timezone,
            slotMinutes: schedule.slotMinutes,
            bookingWindowDays: this.bookingWindowDays,
            days,
        };
    }

    async getDay(doctorId: string, date: string) {
        this.ensureDate(date);

        const doctor = await this.getDoctorOrThrow(doctorId);
        const schedule = await this.getOrCreateSchedule(doctor);

        const dayMap = await this.buildDaySlotsByDateMap(doctor, schedule, [date]);
        const result = dayMap.get(date) || { enabled: false, reason: 'out-of-window', slots: [] as Array<{ time: string; state: 'FREE' | 'BOOKED' | 'BLOCKED' }> };

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
