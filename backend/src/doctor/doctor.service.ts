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
import { ConfigService } from '@nestjs/config';
import { Doctor } from './entities/doctor.entity';
import { DoctorSpecialty } from './entities/doctor-specialty.entity';
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
import { Appointment } from '../appointment/entities/appointment.entity';

type AvatarSize = 'sm' | 'md' | 'lg';
type DbI18nMap = {
    ua?: string;
    en?: string;
    de?: string;
    fr?: string;
};
@Injectable()
export class DoctorService {
    constructor(
        @InjectRepository(Doctor)
        private readonly doctorRepository: Repository<Doctor>,
        @InjectRepository(DoctorSpecialty)
        private readonly specialtyRepository: Repository<DoctorSpecialty>,
        @InjectRepository(Appointment)
        private readonly appointmentRepository: Repository<Appointment>,
        private readonly userService: UserService,
        private readonly verificationService: VerificationService,
        private readonly mailService: MailService,
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly patientService: PatientService,
        private readonly adminService: AdminService,
        private readonly configService: ConfigService,
    ) {}

    private normalizePhone(phone: string) {
        return phone.trim();
    }

    private normalizeEmail(email: string) {
        return email.trim().toLowerCase();
    }

    private normalizeNullableText(value?: string) {
        if (value === undefined) return undefined;
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
    }

    private normalizeSpecialties(values?: string[], single?: string) {
        const source = values && values.length > 0 ? values : single ? [single] : [];
        const prepared = source.map((v) => v.trim()).filter((v) => v.length > 0);
        const unique: string[] = [];

        for (const item of prepared) {
            if (!unique.some((x) => x.toLowerCase() === item.toLowerCase())) {
                unique.push(item);
            }
        }

        return unique;
    }



    private parseDbI18n(raw: string | null | undefined): DbI18nMap | null {
        if (!raw) return null;

        try {
            const start = raw.indexOf('{');
            if (start === -1) return null;

            const parsed = JSON.parse(raw.slice(start));
            const data = parsed?.data;

            if (data && typeof data === 'object') {
                return data as DbI18nMap;
            }

            return null;
        } catch {
            return null;
        }
    }

    private getLocalizedDbText(raw: string | null | undefined, lang: keyof DbI18nMap = 'ua'): string {
        const parsed = this.parseDbI18n(raw);
        if (!parsed) {
            return raw ?? '';
        }

        return parsed[lang] || parsed.ua || parsed.en || parsed.de || parsed.fr || raw || '';
    }

    private mapDbI18n(raw: string | null | undefined): DbI18nMap {
        const parsed = this.parseDbI18n(raw);
        if (!parsed) {
            return {};
        }

        return {
            ua: parsed.ua || '',
            en: parsed.en || '',
            de: parsed.de || '',
            fr: parsed.fr || '',
        };
    }

    private async ensureSpecialtiesExist(names: string[]) {
        for (const name of names) {
            const existing = await this.specialtyRepository
                .createQueryBuilder('s')
                .where('LOWER(s.name) = LOWER(:name)', { name })
                .getOne();

            if (!existing) {
                throw new BadRequestException(`Спеціальність не знайдено: ${name}`);
            }
        }
    }

    private async resolveSpecialties(values: string[], single?: string | null): Promise<string[]> {
        const raw = this.normalizeSpecialties(values, single ?? undefined);

        if (raw.length === 0) {
            return [];
        }

        const allSpecialties = await this.specialtyRepository.find({
            where: { isActive: true },
        });

        const byId = new Map(allSpecialties.map((item) => [item.id, item]));
        const byName = new Map(
            allSpecialties.map((item) => [item.name.trim().toLowerCase(), item]),
        );

        const resolved: string[] = [];

        for (const item of raw) {
            const normalized = item.trim();

            const byIdMatch = byId.get(normalized);
            if (byIdMatch) {
                resolved.push(byIdMatch.name);
                continue;
            }

            const byNameMatch = byName.get(normalized.toLowerCase());
            if (byNameMatch) {
                resolved.push(byNameMatch.name);
                continue;
            }

            throw new BadRequestException(`Спеціальність не знайдено: ${item}`);
        }

        const unique: string[] = [];
        for (const item of resolved) {
            if (!unique.some((x) => x.toLowerCase() === item.toLowerCase())) {
                unique.push(item);
            }
        }

        return unique;
    }

    private getAvatarRoot() {
        const configured = this.configService.get<string>('DOCTOR_AVATAR_STORAGE_ROOT');
        if (configured && configured.trim().length > 0) {
            return configured.trim();
        }

        if (process.platform === 'win32') {
            return 'C:\\Users\\hmax0\\Desktop\\oradent-storage\\doctor-avatars';
        }

        return '/home/u569589412/doctor-avatars';
    }

    private buildAvatarUrl(doctorId: string, size: AvatarSize, version: number) {
        return `/doctors/${doctorId}/avatar?size=${size}&v=${version}`;
    }

    private mapDoctor(doctor: Doctor) {
        const specialties = doctor.specialties || (doctor.specialty ? [doctor.specialty] : []);

        return {
            id: doctor.id,
            userId: doctor.user?.id ?? null,
            email: doctor.user?.email ?? null,
            lastName: doctor.lastName,
            firstName: doctor.firstName,
            middleName: doctor.middleName,
            specialty: doctor.specialty,
            specialties,
            infoBlock: doctor.infoBlock,
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
    async findById(id: string): Promise<Doctor | null> {
        return this.doctorRepository.findOne({
            where: { id },
            relations: ['user'],
        });
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

    async getSpecialties(currentUserId: string) {
        await this.ensureManagerAccess(currentUserId);

        const list = await this.specialtyRepository.find({
            where: { isActive: true },
            order: {
                order: 'ASC',
                name: 'ASC',
            },
        });

        return {
            ok: true,
            specialties: list.map((s) => ({
                id: s.id,
                name: this.getLocalizedDbText(s.name, 'ua'),
                nameI18n: this.mapDbI18n(s.name),
                order: s.order,
            })),
        };
    }

    async createSpecialty(currentUserId: string, name: string) {
        await this.ensureManagerAccess(currentUserId);

        const normalizedName = name.trim();
        if (!normalizedName) {
            throw new BadRequestException('Назва спеціальності обов’язкова');
        }

        const existing = await this.specialtyRepository
            .createQueryBuilder('s')
            .where('LOWER(s.name) = LOWER(:name)', { name: normalizedName })
            .getOne();

        if (existing) {
            return {
                ok: true,
                specialty: {
                    id: existing.id,
                    name: existing.name,
                    order: existing.order,
                },
            };
        }

        const maxOrder = await this.specialtyRepository
            .createQueryBuilder('s')
            .select('MAX(s.order)', 'max')
            .getRawOne<{ max: string | null }>();

        const specialty = this.specialtyRepository.create({
            name: normalizedName,
            isActive: true,
            order: Number(maxOrder?.max || 0) + 1,
        });

        const saved = await this.specialtyRepository.save(specialty);

        return {
            ok: true,
            specialty: {
                id: saved.id,
                name: saved.name,
                order: saved.order,
            },
        };
    }

    async updateSpecialty(currentUserId: string, specialtyId: string, name: string) {
        await this.ensureManagerAccess(currentUserId);

        const normalizedName = name.trim();
        if (!normalizedName) {
            throw new BadRequestException('Назва спеціальності обов’язкова');
        }

        const specialty = await this.specialtyRepository.findOne({ where: { id: specialtyId } });
        if (!specialty) {
            throw new NotFoundException('Спеціальність не знайдено');
        }

        const duplicate = await this.specialtyRepository
            .createQueryBuilder('s')
            .where('LOWER(s.name) = LOWER(:name)', { name: normalizedName })
            .andWhere('s.id != :id', { id: specialtyId })
            .getOne();

        if (duplicate) {
            throw new BadRequestException('Така спеціальність вже існує');
        }

        specialty.name = normalizedName;
        const saved = await this.specialtyRepository.save(specialty);

        return {
            ok: true,
            specialty: {
                id: saved.id,
                name: saved.name,
                order: saved.order,
            },
        };
    }

    async deleteSpecialty(currentUserId: string, specialtyId: string) {
        await this.ensureManagerAccess(currentUserId);

        const specialty = await this.specialtyRepository.findOne({ where: { id: specialtyId } });
        if (!specialty) {
            throw new NotFoundException('Спеціальність не знайдено');
        }

        const doctors = await this.doctorRepository.find();
        const usedByDoctors = doctors.some((doctor) => {
            const list = doctor.specialties || (doctor.specialty ? [doctor.specialty] : []);
            return list.some((item) => item.trim().toLowerCase() === specialty.name.trim().toLowerCase());
        });

        if (usedByDoctors) {
            throw new BadRequestException('Спеціальність використовується у профілях лікарів');
        }

        await this.specialtyRepository.remove(specialty);

        return {
            ok: true,
            message: 'Спеціальність видалено',
        };
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

        const specialties = await this.resolveSpecialties(dto.specialties || [], dto.specialty);
        if (specialties.length === 0) {
            throw new BadRequestException('Оберіть хоча б одну спеціальність');
        }

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
            lastName: dto.lastName.trim(),
            firstName: dto.firstName.trim(),
            middleName: this.normalizeNullableText(dto.middleName) ?? null,
            specialty: specialties[0] ?? null,
            specialties,
            infoBlock: this.normalizeNullableText(dto.infoBlock) ?? null,
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

    async getPublicDoctors() {
        const doctors = await this.doctorRepository.find({
            where: { isActive: true },
            order: {
                lastName: 'ASC',
                firstName: 'ASC',
            },
        });

        return {
            ok: true,
            doctors: doctors.map((doctor) => ({
                id: doctor.id,
                userId: doctor.user?.id ?? null,
                lastName: doctor.lastName,
                firstName: doctor.firstName,
                middleName: doctor.middleName,
                specialty: this.getLocalizedDbText(doctor.specialty, 'ua'),
                specialtyI18n: this.mapDbI18n(doctor.specialty),
                specialties: (doctor.specialties || (doctor.specialty ? [doctor.specialty] : [])).map((item) => ({
                    value: this.getLocalizedDbText(item, 'ua'),
                    i18n: this.mapDbI18n(item),
                })),
                infoBlock: this.getLocalizedDbText(doctor.infoBlock, 'ua'),
                infoBlockI18n: this.mapDbI18n(doctor.infoBlock),
                hasAvatar: doctor.hasAvatar,
                avatarVersion: doctor.avatarVersion,
                avatar: doctor.hasAvatar
                    ? {
                        sm: this.buildAvatarUrl(doctor.id, 'sm', doctor.avatarVersion),
                        md: this.buildAvatarUrl(doctor.id, 'md', doctor.avatarVersion),
                        lg: this.buildAvatarUrl(doctor.id, 'lg', doctor.avatarVersion),
                    }
                    : null,
            })),
        };
    }


    private buildPatientReviewName(appointment: Appointment) {
        if (appointment.reviewAnonymous) return 'Анонім';
        const patient = appointment.patient;
        if (!patient) return 'Пацієнт';
        const firstInitial = patient.firstName ? `${patient.firstName.trim().charAt(0)}.` : '';
        const middleInitial = patient.middleName ? `${patient.middleName.trim().charAt(0)}.` : '';
        const lastName = patient.lastName?.trim() || 'Пацієнт';
        return `${lastName} ${firstInitial}${middleInitial}`.trim();
    }

    async getPublicDoctorById(doctorId: string) {
        const doctor = await this.doctorRepository.findOne({
            where: { id: doctorId, isActive: true },
            relations: ['user'],
        });

        if (!doctor) {
            throw new NotFoundException('Лікаря не знайдено');
        }

        const doctorRefIds = [doctor.id, doctor.user?.id].filter(Boolean) as string[];
        const reviewAppointments = await this.appointmentRepository.find({
            where: doctorRefIds.map((id) => ({ doctorId: id })),
            relations: ['patient'],
            order: {
                reviewCreatedAt: 'DESC',
                appointmentDate: 'DESC',
                createdAt: 'DESC',
            },
        });

        const reviews = reviewAppointments
            .filter((item) => item.reviewRating !== null && item.reviewCreatedAt)
            .map((item) => ({
                appointmentId: item.id,
                rating: Number(item.reviewRating || 0),
                text: item.reviewText || '',
                anonymous: Boolean(item.reviewAnonymous),
                authorName: this.buildPatientReviewName(item),
                createdAt: item.reviewCreatedAt,
            }));

        const averageRating = reviews.length
            ? Math.round((reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / reviews.length) * 10) / 10
            : 0;

        return {
            ok: true,
            doctor: {
                id: doctor.id,
                userId: doctor.user?.id ?? null,
                lastName: doctor.lastName,
                firstName: doctor.firstName,
                middleName: doctor.middleName,
                specialty: this.getLocalizedDbText(doctor.specialty, 'ua'),
                specialtyI18n: this.mapDbI18n(doctor.specialty),
                specialties: (doctor.specialties || (doctor.specialty ? [doctor.specialty] : [])).map((item) => ({
                    value: this.getLocalizedDbText(item, 'ua'),
                    i18n: this.mapDbI18n(item),
                })),
                infoBlock: this.getLocalizedDbText(doctor.infoBlock, 'ua'),
                infoBlockI18n: this.mapDbI18n(doctor.infoBlock),
                hasAvatar: doctor.hasAvatar,
                avatarVersion: doctor.avatarVersion,
                avatar: doctor.hasAvatar
                    ? {
                        sm: this.buildAvatarUrl(doctor.id, 'sm', doctor.avatarVersion),
                        md: this.buildAvatarUrl(doctor.id, 'md', doctor.avatarVersion),
                        lg: this.buildAvatarUrl(doctor.id, 'lg', doctor.avatarVersion),
                    }
                    : null,
                reviews,
                reviewsCount: reviews.length,
                averageRating,
            },
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
                    throw new BadRequestException('Для зміни телефону потрібна верифікація');
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
            doctor.lastName = dto.lastName.trim();
            hasChanges = true;
        }

        if (dto.firstName !== undefined) {
            doctor.firstName = dto.firstName.trim();
            hasChanges = true;
        }

        if (dto.middleName !== undefined) {
            doctor.middleName = this.normalizeNullableText(dto.middleName) ?? null;
            hasChanges = true;
        }

        if (dto.specialties !== undefined || dto.specialty !== undefined) {
            const specialties = this.normalizeSpecialties(dto.specialties, dto.specialty);
            if (specialties.length === 0) {
                throw new BadRequestException('Оберіть хоча б одну спеціальність');
            }
            await this.ensureSpecialtiesExist(specialties);
            doctor.specialties = specialties;
            doctor.specialty = specialties[0] ?? null;
            hasChanges = true;
        }

        if (dto.infoBlock !== undefined) {
            doctor.infoBlock = this.normalizeNullableText(dto.infoBlock) ?? null;
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

    async removeAvatar(currentUserId: string, doctorId: string) {
        await this.ensureManagerAccess(currentUserId);

        const doctor = await this.doctorRepository.findOne({ where: { id: doctorId } });
        if (!doctor) {
            throw new BadRequestException('Лікаря не знайдено');
        }

        const files = [doctor.avatarSmPath, doctor.avatarMdPath, doctor.avatarLgPath].filter(
            (v): v is string => Boolean(v),
        );

        for (const filePath of files) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch {
            }
        }

        const doctorDir = path.join(this.getAvatarRoot(), doctor.id);
        try {
            if (fs.existsSync(doctorDir) && fs.readdirSync(doctorDir).length === 0) {
                fs.rmdirSync(doctorDir);
            }
        } catch {
        }

        doctor.hasAvatar = false;
        doctor.avatarVersion = (doctor.avatarVersion || 1) + 1;
        doctor.avatarSmPath = null;
        doctor.avatarMdPath = null;
        doctor.avatarLgPath = null;

        const savedDoctor = await this.doctorRepository.save(doctor);

        return {
            ok: true,
            message: 'Аватар лікаря видалено',
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
            id: doctor.id,
            userId: doctor.user?.id ?? null,
            email: doctor.user?.email ?? null,
            fullName: `${doctor.lastName} ${doctor.firstName}${doctor.middleName ? ` ${doctor.middleName}` : ''}`,
            hasAvatar: doctor.hasAvatar,
            avatarVersion: doctor.avatarVersion,
            avatar: doctor.hasAvatar
                ? {
                    sm: this.buildAvatarUrl(doctor.id, 'sm', doctor.avatarVersion),
                    md: this.buildAvatarUrl(doctor.id, 'md', doctor.avatarVersion),
                    lg: this.buildAvatarUrl(doctor.id, 'lg', doctor.avatarVersion),
                }
                : null,
        }));
    }



}
