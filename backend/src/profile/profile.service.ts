import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserService } from '../user/user.service';
import { PatientService } from '../patient/patient.service';
import { VerificationService } from '../verification/verification.service';
import { MailService } from '../mail/mail.service';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';
import { TelegramService } from '../telegram/telegram.service';
import { VerificationType } from '../common/enums/verification-type.enum';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { StartPhoneChangeDto } from './dto/start-phone-change.dto';
import { ConfirmPhoneChangeDto } from './dto/confirm-phone-change.dto';
import { AuthProvider } from '../common/enums/auth-provider.enum';
import { AdminService } from '../admin/admin.service';
import { UserRole } from '../common/enums/user-role.enum';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class ProfileService {
    constructor(
        private readonly userService: UserService,
        private readonly patientService: PatientService,
        private readonly verificationService: VerificationService,
        private readonly mailService: MailService,
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly telegramService: TelegramService,
        private readonly adminService: AdminService,
    ) {}

    private normalizePhone(phone: string) {
        return phone.trim();
    }

    private async requireLocalPassword(userId: string, password: string) {
        const user = await this.userService.findById(userId);

        if (!user) {
            throw new UnauthorizedException('Користувача не знайдено');
        }

        if (!user.passwordHash) {
            throw new BadRequestException(
                'Для цього акаунта пароль не встановлено. Спочатку налаштуйте локальний пароль.',
            );
        }

        const isValid = await argon2.verify(user.passwordHash, password);

        if (!isValid) {
            throw new UnauthorizedException('Невірний пароль');
        }

        return user;
    }

    private async resolveProfileOwner(userId: string) {
        const user = await this.userService.findById(userId);

        if (!user) {
            throw new BadRequestException('Профіль не знайдено');
        }

        if (user.patient) {
            return {
                mode: 'patient' as const,
                user,
                patient: user.patient,
                admin: null,
            };
        }

        if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
            const admin = await this.adminService.findByUserId(user.id);

            if (!admin) {
                throw new BadRequestException('Профіль адміністратора не знайдено');
            }

            return {
                mode: 'admin' as const,
                user,
                patient: null,
                admin,
            };
        }

        throw new BadRequestException('Профіль не знайдено');
    }

    private async ensurePhoneAvailableForOwner(
        phone: string,
        owner: Awaited<ReturnType<ProfileService['resolveProfileOwner']>>,
    ) {
        const normalizedPhone = this.normalizePhone(phone);

        const patientWithPhone = await this.patientService.findByPhone(normalizedPhone);
        if (
            patientWithPhone &&
            !(owner.mode === 'patient' && patientWithPhone.id === owner.patient.id)
        ) {
            throw new BadRequestException('Цей номер телефону вже використовується іншим користувачем');
        }

        const adminWithPhone = await this.adminService.findByPhone(normalizedPhone);
        if (
            adminWithPhone &&
            !(owner.mode === 'admin' && adminWithPhone.id === owner.admin.id)
        ) {
            throw new BadRequestException('Цей номер телефону вже використовується іншим користувачем');
        }

        return normalizedPhone;
    }

    async getMyProfile(userId: string) {
        const owner = await this.resolveProfileOwner(userId);

        if (owner.mode === 'patient') {
            return {
                ok: true,
                profile: {
                    userId: owner.user.id,
                    email: owner.user.email,
                    authProvider: owner.user.authProvider,
                    role: owner.user.role,
                    patientId: owner.patient.id,
                    lastName: owner.patient.lastName,
                    firstName: owner.patient.firstName,
                    middleName: owner.patient.middleName,
                    phone: owner.patient.phone,
                    phoneVerified: owner.patient.phoneVerified,
                },
            };
        }

        return {
            ok: true,
            profile: {
                userId: owner.user.id,
                email: owner.user.email,
                authProvider: owner.user.authProvider,
                role: owner.user.role,
                patientId: null,
                lastName: owner.admin.lastName,
                firstName: owner.admin.firstName,
                middleName: owner.admin.middleName,
                phone: owner.admin.phone,
                phoneVerified: owner.admin.phoneVerified,
            },
        };
    }

    async updateProfile(userId: string, dto: UpdateProfileDto) {
        await this.requireLocalPassword(userId, dto.password);
        const owner = await this.resolveProfileOwner(userId);

        if (owner.mode === 'admin') {
            if (owner.user.role === UserRole.ADMIN) {
                throw new ForbiddenException('Адміністратор не може змінювати ПІБ');
            }

            owner.admin.lastName = dto.lastName;
            owner.admin.firstName = dto.firstName;
            owner.admin.middleName = dto.middleName || null;

            const savedAdmin = await this.adminService.saveAdmin(owner.admin);

            return {
                ok: true,
                message: 'Профіль оновлено',
                profile: {
                    lastName: savedAdmin.lastName,
                    firstName: savedAdmin.firstName,
                    middleName: savedAdmin.middleName,
                },
            };
        }

        owner.patient.lastName = dto.lastName;
        owner.patient.firstName = dto.firstName;
        owner.patient.middleName = dto.middleName || null;

        const savedPatient = await this.patientService.save(owner.patient);

        return {
            ok: true,
            message: 'Профіль оновлено',
            profile: {
                lastName: savedPatient.lastName,
                firstName: savedPatient.firstName,
                middleName: savedPatient.middleName,
            },
        };
    }

    async changePassword(userId: string, dto: ChangePasswordDto) {
        const user = await this.requireLocalPassword(userId, dto.currentPassword);

        if (dto.currentPassword === dto.newPassword) {
            throw new BadRequestException('Новий пароль має відрізнятися від поточного');
        }

        user.passwordHash = await argon2.hash(dto.newPassword, {
            type: argon2.argon2id,
        });

        await this.userService.save(user);

        return {
            ok: true,
            message: 'Пароль успішно змінено',
        };
    }

    async requestEmailChange(userId: string, dto: RequestEmailChangeDto) {
        const user = await this.requireLocalPassword(userId, dto.password);

        const normalizedNewEmail = dto.newEmail.trim().toLowerCase();

        if (user.email.toLowerCase() === normalizedNewEmail) {
            throw new BadRequestException('Це вже поточна пошта');
        }

        const existingUser = await this.userService.findByEmail(normalizedNewEmail);
        if (existingUser) {
            throw new BadRequestException('Користувач з такою поштою вже існує');
        }

        const code = await this.verificationService.createCode(
            normalizedNewEmail,
            VerificationType.EMAIL_CHANGE,
        );

        await this.mailService.sendEmailChangeCode(normalizedNewEmail, code);

        return {
            ok: true,
            message: 'Код підтвердження відправлено на нову пошту',
        };
    }

    async confirmEmailChange(userId: string, dto: ConfirmEmailChangeDto) {
        const owner = await this.resolveProfileOwner(userId);

        const normalizedNewEmail = dto.newEmail.trim().toLowerCase();

        const existingUser = await this.userService.findByEmail(normalizedNewEmail);
        if (existingUser && existingUser.id !== owner.user.id) {
            throw new BadRequestException('Користувач з такою поштою вже існує');
        }

        await this.verificationService.verifyCode(
            normalizedNewEmail,
            VerificationType.EMAIL_CHANGE,
            dto.code,
        );

        owner.user.email = normalizedNewEmail;
        owner.user.googleId = null;
        owner.user.authProvider = AuthProvider.LOCAL;

        if (owner.mode === 'patient') {
            owner.patient.email = normalizedNewEmail;
            await this.patientService.save(owner.patient);
        }

        await this.userService.save(owner.user);

        return {
            ok: true,
            message: 'Пошту оновлено',
            email: owner.user.email,
        };
    }

    async startPhoneChange(userId: string, dto: StartPhoneChangeDto) {
        await this.requireLocalPassword(userId, dto.password);
        const owner = await this.resolveProfileOwner(userId);

        const normalizedPhone = await this.ensurePhoneAvailableForOwner(dto.phone, owner);

        const session = await this.phoneVerificationService.createSession(normalizedPhone, '');

        const realTelegramBotUrl = this.telegramService.buildStartLink(session.id);
        session.telegramBotUrl = realTelegramBotUrl;
        await this.phoneVerificationService.save(session);

        return {
            ok: true,
            sessionId: session.id,
            phone: session.phone,
            status: session.status,
            telegramBotUrl: realTelegramBotUrl,
        };
    }

    async confirmPhoneChange(userId: string, dto: ConfirmPhoneChangeDto) {
        const owner = await this.resolveProfileOwner(userId);
        const normalizedPhone = this.normalizePhone(dto.phone);

        await this.phoneVerificationService.ensureVerified(
            dto.phoneVerificationSessionId,
            normalizedPhone,
        );

        await this.ensurePhoneAvailableForOwner(normalizedPhone, owner);

        if (owner.mode === 'patient') {
            owner.patient.phone = normalizedPhone;
            owner.patient.phoneVerified = true;
            await this.patientService.save(owner.patient);

            return {
                ok: true,
                message: 'Телефон оновлено',
                phone: owner.patient.phone,
                phoneVerified: owner.patient.phoneVerified,
            };
        }

        owner.admin.phone = normalizedPhone;
        owner.admin.phoneVerified = true;
        await this.adminService.saveAdmin(owner.admin);

        return {
            ok: true,
            message: 'Телефон оновлено',
            phone: owner.admin.phone,
            phoneVerified: owner.admin.phoneVerified,
        };
    }
}
