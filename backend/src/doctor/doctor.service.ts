import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { Doctor } from './entities/doctor.entity';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { UserService } from '../user/user.service';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthProvider } from '../common/enums/auth-provider.enum';
import { VerificationService } from '../verification/verification.service';
import { VerificationType } from '../common/enums/verification-type.enum';
import { MailService } from '../mail/mail.service';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';
import { PatientService } from '../patient/patient.service';
import { AdminService } from '../admin/admin.service';

type AvatarSize = 'sm' | 'md' | 'lg';

@Injectable()
export class DoctorService {
    constructor(
        @InjectRepository(Doctor)
        private readonly doctorRepository: Repository<Doctor>,
        private readonly userService: UserService,
        private readonly verificationService: VerificationService,
        private readonly mailService: MailService,
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly patientService: PatientService,
        private readonly adminService: AdminService,
    ) {}

    private normalizePhone(phone: string) {
        return phone.trim();
    }

    private normalizeEmail(email: string) {
        return email.trim().toLowerCase();
    }

    private getAvatarRoot() {
        return path.join(process.cwd(), 'storage', 'doctor-avatars');
    }

    private buildAvatarUrl(doctorId: string, size: AvatarSize, version: number) {
        return `/doctors/${doctorId}/avatar?size=${size}&v=${version}`;
    }

    private mapDoctor(doctor: Doctor) {
        return {
            id: doctor.id,
            userId: doctor.user.id,
            email: doctor.user.email,
            lastName: doctor.lastName,
            firstName: doctor.firstName,
            middleName: doctor.middleName,
            phone: doctor.phone,
            isActive: doctor.isActive,
            hasAvatar: doctor.hasAvatar,
            avatarVersion: doctor.avatarVersion,
            avatar: doctor.hasAvatar
                ? {
                    sm: this.buildAvatarUrl(doctor.id, 'sm', doctor.avatarVersion),
                    md: this.buildAvatarUrl(doctor.id, 'md', doctor.avatarVersion),
                    lg: this.buildAvatarUrl(doctor.id, 'lg', doctor.avatarVersion),
                }
                : null,
            createdAt: doctor.createdAt,
            updatedAt: doctor.updatedAt,
        };
    }

    async findByUserId(userId: string): Promise<Doctor | null> {
        return this.doctorRepository.findOne({ where: { user: { id: userId } } });
    }

    async findByPhone(phone: string): Promise<Doctor | null> {
        return this.doctorRepository.findOne({ where: { phone: this.normalizePhone(phone) } });
    }

    async saveDoctor(doctor: Doctor): Promise<Doctor> {
        return this.doctorRepository.save(doctor);
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

        return user;
    }

    private async verifyActorPassword(currentUserId: string, password: string) {
        const user = await this.userService.findById(currentUserId);

        if (!user) {
            throw new UnauthorizedException('Користувача не знайдено');
        }

        if (!user.passwordHash) {
            throw new BadRequestException('Для цього акаунта пароль не встановлено');
        }

        const isValid = await argon2.verify(user.passwordHash, password);
        if (!isValid) {
            throw new UnauthorizedException('Невірний пароль');
        }
    }

    private async ensurePhoneAvailable(phone: string, exceptDoctorId?: string) {
        const normalizedPhone = this.normalizePhone(phone);

        const doctorWithPhone = await this.findByPhone(normalizedPhone);
        if (doctorWithPhone && doctorWithPhone.id !== exceptDoctorId) {
            throw new BadRequestException('Цей номер телефону вже використовується іншим лікарем');
        }

        const adminWithPhone = await this.adminService.findByPhone(normalizedPhone);
        if (adminWithPhone) {
            throw new BadRequestException('Цей номер телефону вже використовується іншим користувачем');
        }

        const patientWithPhone = await this.patientService.findByPhone(normalizedPhone);
        if (patientWithPhone) {
            throw new BadRequestException('Цей номер телефону вже використовується іншим користувачем');
        }

        return normalizedPhone;
    }

    async requestEmailVerification(currentUserId: string, email: string) {
        await this.ensureManagerAccess(currentUserId);

        const normalizedEmail = this.normalizeEmail(email);
        const existingUser = await this.userService.findByEmail(normalizedEmail);

        if (existingUser) {
            throw new BadRequestException('Користувач з такою поштою вже існує');
        }

        const code = await this.verificationService.createCode(
            normalizedEmail,
            VerificationType.EMAIL_VERIFY,
        );

        await this.mailService.sendVerificationEmail(normalizedEmail, code);

        return {
            ok: true,
            message: 'Код підтвердження надіслано на пошту лікаря',
        };
    }

    async createDoctor(currentUserId: string, dto: CreateDoctorDto) {
        await this.ensureManagerAccess(currentUserId);

        const normalizedEmail = this.normalizeEmail(dto.email);
        const normalizedPhone = await this.ensurePhoneAvailable(dto.phone);

        const existingUser = await this.userService.findByEmail(normalizedEmail);
        if (existingUser) {
            throw new BadRequestException('Користувач з такою поштою вже існує');
        }

        await this.verificationService.verifyCode(
            normalizedEmail,
            VerificationType.EMAIL_VERIFY,
            dto.emailCode,
        );

        await this.phoneVerificationService.ensureVerified(
            dto.phoneVerificationSessionId,
            normalizedPhone,
        );

        const passwordHash = await argon2.hash(dto.password, {
            type: argon2.argon2id,
        });

        const user = await this.userService.save(
            this.userService.create({
                email: normalizedEmail,
                passwordHash,
                role: UserRole.DOCTOR,
                authProvider: AuthProvider.LOCAL,
                googleId: null,
            }),
        );

        const doctor = this.doctorRepository.create({
            user,
            lastName: dto.lastName,
            firstName: dto.firstName,
            middleName: dto.middleName || null,
            phone: normalizedPhone,
            phoneVerified: true,
            isActive: true,
            hasAvatar: false,
            avatarVersion: 1,
            avatarSmPath: null,
            avatarMdPath: null,
            avatarLgPath: null,
        });

        const savedDoctor = await this.doctorRepository.save(doctor);

        return {
            ok: true,
            message: 'Лікаря створено',
            doctor: this.mapDoctor(savedDoctor),
        };
    }

    async getAllDoctors(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const doctors = await this.doctorRepository.find({
            order: {
                lastName: 'ASC',
                firstName: 'ASC',
            },
        });

        return {
            ok: true,
            doctors: doctors.map((doctor) => this.mapDoctor(doctor)),
        };
    }

    async getDoctorById(currentUserId: string, doctorId: string) {
        await this.ensureManagerAccess(currentUserId);

        const doctor = await this.doctorRepository.findOne({ where: { id: doctorId } });

        if (!doctor) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        return {
            ok: true,
            doctor: this.mapDoctor(doctor),
        };
    }

    async toggleDoctorActive(currentUserId: string, doctorId: string) {
        await this.ensureManagerAccess(currentUserId);

        const doctor = await this.doctorRepository.findOne({ where: { id: doctorId } });

        if (!doctor) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        doctor.isActive = !doctor.isActive;
        await this.doctorRepository.save(doctor);

        return {
            ok: true,
            message: doctor.isActive ? 'Лікаря активовано' : 'Лікаря деактивовано',
            isActive: doctor.isActive,
        };
    }

    async updateDoctor(currentUserId: string, doctorId: string, dto: UpdateDoctorDto) {
        await this.ensureManagerAccess(currentUserId);
        await this.verifyActorPassword(currentUserId, dto.actorPassword);

        const doctor = await this.doctorRepository.findOne({ where: { id: doctorId } });

        if (!doctor) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        let hasChanges = false;

        if (dto.email !== undefined) {
            const normalizedEmail = this.normalizeEmail(dto.email);
            const emailChanged = doctor.user.email !== normalizedEmail;

            if (emailChanged) {
                if (!dto.emailCode?.trim()) {
                    throw new BadRequestException('Для зміни пошти потрібен код підтвердження');
                }

                const existingUser = await this.userService.findByEmail(normalizedEmail);
                if (existingUser && existingUser.id !== doctor.user.id) {
                    throw new BadRequestException('Користувач з такою поштою вже існує');
                }

                await this.verificationService.verifyCode(
                    normalizedEmail,
                    VerificationType.EMAIL_VERIFY,
                    dto.emailCode.trim(),
                );

                doctor.user.email = normalizedEmail;
                doctor.user.googleId = null;
                doctor.user.authProvider = AuthProvider.LOCAL;
                await this.userService.save(doctor.user);
                hasChanges = true;
            }
        }

        if (dto.phone !== undefined) {
            const normalizedPhone = this.normalizePhone(dto.phone);
            const phoneChanged = doctor.phone !== normalizedPhone;

            if (phoneChanged) {
                if (!dto.phoneVerificationSessionId?.trim()) {
                    throw new BadRequestException('Для зміни телефону потрібна верифікація телефону');
                }

                await this.phoneVerificationService.ensureVerified(
                    dto.phoneVerificationSessionId.trim(),
                    normalizedPhone,
                );

                await this.ensurePhoneAvailable(normalizedPhone, doctor.id);

                doctor.phone = normalizedPhone;
                doctor.phoneVerified = true;
                hasChanges = true;
            }
        }

        if (dto.lastName !== undefined) {
            doctor.lastName = dto.lastName;
            hasChanges = true;
        }

        if (dto.firstName !== undefined) {
            doctor.firstName = dto.firstName;
            hasChanges = true;
        }

        if (dto.middleName !== undefined) {
            doctor.middleName = dto.middleName || null;
            hasChanges = true;
        }

        if (!hasChanges) {
            throw new BadRequestException('Немає змін для збереження');
        }

        const savedDoctor = await this.doctorRepository.save(doctor);

        return {
            ok: true,
            message: 'Профіль лікаря оновлено',
            doctor: this.mapDoctor(savedDoctor),
        };
    }

    async uploadAvatar(currentUserId: string, doctorId: string, file: Express.Multer.File) {
        await this.ensureManagerAccess(currentUserId);

        const doctor = await this.doctorRepository.findOne({ where: { id: doctorId } });
        if (!doctor) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        if (!file) {
            throw new BadRequestException('Файл не отримано');
        }

        if (!file.mimetype.startsWith('image/')) {
            throw new BadRequestException('Дозволені лише зображення');
        }

        const avatarRoot = this.getAvatarRoot();
        const doctorDir = path.join(avatarRoot, doctor.id);

        fs.mkdirSync(doctorDir, { recursive: true });

        const smPath = path.join(doctorDir, 'avatar-sm.webp');
        const mdPath = path.join(doctorDir, 'avatar-md.webp');
        const lgPath = path.join(doctorDir, 'avatar-lg.webp');

        const pipeline = sharp(file.buffer).rotate();

        await pipeline
            .clone()
            .resize(160, 160, { fit: 'cover', position: 'centre' })
            .webp({ quality: 68 })
            .toFile(smPath);

        await pipeline
            .clone()
            .resize(320, 320, { fit: 'cover', position: 'centre' })
            .webp({ quality: 76 })
            .toFile(mdPath);

        await pipeline
            .clone()
            .resize(640, 640, { fit: 'cover', position: 'centre' })
            .webp({ quality: 84 })
            .toFile(lgPath);

        doctor.hasAvatar = true;
        doctor.avatarVersion = (doctor.avatarVersion || 1) + 1;
        doctor.avatarSmPath = smPath;
        doctor.avatarMdPath = mdPath;
        doctor.avatarLgPath = lgPath;

        const savedDoctor = await this.doctorRepository.save(doctor);

        return {
            ok: true,
            message: 'Аватар лікаря оновлено',
            doctor: this.mapDoctor(savedDoctor),
        };
    }

    async getAvatarFile(doctorId: string, size: AvatarSize) {
        const doctor = await this.doctorRepository.findOne({ where: { id: doctorId } });

        if (!doctor || !doctor.hasAvatar) {
            throw new NotFoundException('Аватар не знайдено');
        }

        const selectedPath =
            size === 'sm' ? doctor.avatarSmPath : size === 'lg' ? doctor.avatarLgPath : doctor.avatarMdPath;

        const fallbackPath = doctor.avatarMdPath || doctor.avatarSmPath || doctor.avatarLgPath;

        const filePath = selectedPath || fallbackPath;

        if (!filePath || !fs.existsSync(filePath)) {
            throw new NotFoundException('Аватар не знайдено');
        }

        return {
            filePath,
            contentType: 'image/webp',
            version: doctor.avatarVersion,
        };
    }

    async getDoctorsForOptions() {
        const doctors = await this.doctorRepository.find({
            where: { isActive: true },
            order: {
                lastName: 'ASC',
                firstName: 'ASC',
            },
        });

        return doctors.map((doctor) => ({
            id: doctor.user.id,
            email: doctor.user.email,
            fullName: `${doctor.lastName} ${doctor.firstName}${doctor.middleName ? ` ${doctor.middleName}` : ''}`,
            hasAvatar: doctor.hasAvatar,
            avatarVersion: doctor.avatarVersion,
        }));
    }
}
