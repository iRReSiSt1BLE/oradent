import {
    BadRequestException,
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
import {AuthProvider} from "../common/enums/auth-provider.enum";

@Injectable()
export class ProfileService {
    constructor(
        private readonly userService: UserService,
        private readonly patientService: PatientService,
        private readonly verificationService: VerificationService,
        private readonly mailService: MailService,
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly telegramService: TelegramService,
    ) {}

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

    async getMyProfile(userId: string) {
        const user = await this.userService.findById(userId);

        if (!user || !user.patient) {
            throw new BadRequestException('Профіль не знайдено');
        }

        return {
            ok: true,
            profile: {
                userId: user.id,
                email: user.email,
                authProvider: user.authProvider,
                role: user.role,
                patientId: user.patient.id,
                lastName: user.patient.lastName,
                firstName: user.patient.firstName,
                middleName: user.patient.middleName,
                phone: user.patient.phone,
                phoneVerified: user.patient.phoneVerified,
            },
        };
    }

    async updateProfile(userId: string, dto: UpdateProfileDto) {
        await this.requireLocalPassword(userId, dto.password);

        const user = await this.userService.findById(userId);

        if (!user || !user.patient) {
            throw new BadRequestException('Профіль не знайдено');
        }

        user.patient.lastName = dto.lastName;
        user.patient.firstName = dto.firstName;
        user.patient.middleName = dto.middleName || null;

        const savedPatient = await this.patientService.save(user.patient);

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
        const user = await this.userService.findById(userId);

        if (!user || !user.patient) {
            throw new BadRequestException('Профіль не знайдено');
        }

        const normalizedNewEmail = dto.newEmail.trim().toLowerCase();

        const existingUser = await this.userService.findByEmail(normalizedNewEmail);
        if (existingUser && existingUser.id !== user.id) {
            throw new BadRequestException('Користувач з такою поштою вже існує');
        }

        await this.verificationService.verifyCode(
            normalizedNewEmail,
            VerificationType.EMAIL_CHANGE,
            dto.code,
        );

        user.email = normalizedNewEmail;
        user.googleId = null;
        user.authProvider = AuthProvider.LOCAL;

        user.patient.email = normalizedNewEmail;

        await this.patientService.save(user.patient);
        await this.userService.save(user);

        return {
            ok: true,
            message: 'Пошту оновлено',
            email: user.email,
        };
    }
    async startPhoneChange(userId: string, dto: StartPhoneChangeDto) {
        await this.requireLocalPassword(userId, dto.password);

        const user = await this.userService.findById(userId);

        if (!user || !user.patient) {
            throw new BadRequestException('Профіль не знайдено');
        }

        const session = await this.phoneVerificationService.createSession(dto.phone, '');

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
        const user = await this.userService.findById(userId);

        if (!user || !user.patient) {
            throw new BadRequestException('Профіль не знайдено');
        }

        await this.phoneVerificationService.ensureVerified(
            dto.phoneVerificationSessionId,
            dto.phone,
        );

        user.patient.phone = dto.phone;
        user.patient.phoneVerified = true;

        await this.patientService.save(user.patient);

        return {
            ok: true,
            message: 'Телефон оновлено',
            phone: user.patient.phone,
            phoneVerified: user.patient.phoneVerified,
        };
    }
}