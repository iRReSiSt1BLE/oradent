import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { PatientService } from '../patient/patient.service';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';
import { CreateGuestAppointmentDto } from './dto/create-guest-appointment.dto';
import { CreateAuthenticatedAppointmentDto } from './dto/create-authenticated-appointment.dto';
import { UserService } from '../user/user.service';
import { ServicesService } from '../services/services.service';
import { Video } from '../video/entities/video.entity';
import { UserRole } from '../common/enums/user-role.enum';

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
        private readonly patientService: PatientService,
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly userService: UserService,
        private readonly servicesService: ServicesService,
    ) {}

    async createGuestAppointment(dto: CreateGuestAppointmentDto) {
        await this.phoneVerificationService.ensureVerified(
            dto.phoneVerificationSessionId,
            dto.phone,
        );

        await this.servicesService.ensureBookable(dto.serviceId, dto.doctorId);

        let patient = await this.patientService.findByPhone(dto.phone);

        if (!patient) {
            patient = await this.patientService.create({
                lastName: dto.lastName,
                firstName: dto.firstName,
                middleName: dto.middleName || null,
                phone: dto.phone,
                email: null,
                phoneVerified: false,
            });
        } else {
            patient.lastName = dto.lastName;
            patient.firstName = dto.firstName;
            patient.middleName = dto.middleName || null;
            patient = await this.patientService.save(patient);
        }

        const appointment = this.appointmentRepository.create({
            patient,
            doctorId: dto.doctorId || null,
            serviceId: dto.serviceId || null,
            appointmentDate: dto.appointmentDate
                ? new Date(dto.appointmentDate)
                : null,
            status: 'BOOKED',
            source: 'GUEST',
            recordingCompleted: false,
            recordingCompletedAt: null,
        });

        const savedAppointment = await this.appointmentRepository.save(appointment);

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
            },
        };
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
                throw new BadRequestException(
                    'У профілі пацієнта відсутній номер телефону',
                );
            }

            if (!dto.phoneVerificationSessionId) {
                throw new BadRequestException(
                    'Потрібно один раз підтвердити номер телефону',
                );
            }

            await this.phoneVerificationService.ensureVerified(
                dto.phoneVerificationSessionId,
                patient.phone,
            );

            patient.phoneVerified = true;
            await this.patientService.save(patient);
        }

        if (!dto.doctorId || !dto.serviceId || !dto.appointmentDate) {
            throw new BadRequestException(
                'Потрібно заповнити лікаря, послугу і дату запису',
            );
        }

        await this.servicesService.ensureBookable(dto.serviceId, dto.doctorId);

        const appointment = this.appointmentRepository.create({
            patient,
            doctorId: dto.doctorId || null,
            serviceId: dto.serviceId || null,
            appointmentDate: dto.appointmentDate
                ? new Date(dto.appointmentDate)
                : null,
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
            throw new BadRequestException(
                'Неможливо завершити запис без жодного відео',
            );
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
}
