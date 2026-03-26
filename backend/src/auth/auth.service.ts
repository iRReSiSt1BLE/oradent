import {
    BadRequestException, ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { PatientService } from '../patient/patient.service';
import { VerificationService } from '../verification/verification.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerificationType } from '../common/enums/verification-type.enum';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthProvider } from '../common/enums/auth-provider.enum';
import { PendingRegistrationService } from './pending-registration.service';
import { MailService } from '../mail/mail.service';
import {AdminService} from "../admin/admin.service";


@Injectable()
export class AuthService {
    constructor(
        private readonly userService: UserService,
        private readonly patientService: PatientService,
        private readonly verificationService: VerificationService,
        private readonly jwtService: JwtService,
        private readonly pendingRegistrationService: PendingRegistrationService,
        private readonly mailService: MailService,
        private readonly adminService: AdminService,
    ) {}

    async register(dto: RegisterDto) {
        const existingUser = await this.userService.findByEmail(dto.email);

        if (existingUser) {
            throw new BadRequestException('Користувач з такою поштою вже існує');
        }

        const passwordHash = await argon2.hash(dto.password, {
            type: argon2.argon2id,
        });

        await this.pendingRegistrationService.createOrReplace({
            lastName: dto.lastName,
            firstName: dto.firstName,
            middleName: dto.middleName || null,
            email: dto.email,
            passwordHash,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });

        const code = await this.verificationService.createCode(
            dto.email,
            VerificationType.EMAIL_VERIFY,
        );

        await this.mailService.sendVerificationEmail(dto.email, code);

        return {
            ok: true,
            message: 'Код підтвердження відправлено на пошту',
        };
    }

    async verifyEmail(dto: VerifyEmailDto) {
        await this.verificationService.verifyCode(
            dto.email,
            VerificationType.EMAIL_VERIFY,
            dto.code,
        );

        const existingUser = await this.userService.findByEmail(dto.email);
        if (existingUser) {
            throw new BadRequestException('Користувач вже існує');
        }

        const pendingRegistration =
            await this.pendingRegistrationService.findByEmail(dto.email);

        if (!pendingRegistration) {
            throw new BadRequestException('Заявку на реєстрацію не знайдено');
        }

        if (pendingRegistration.expiresAt.getTime() < Date.now()) {
            throw new BadRequestException('Термін підтвердження реєстрації минув');
        }

        const patient = await this.patientService.create({
            lastName: pendingRegistration.lastName,
            firstName: pendingRegistration.firstName,
            middleName: pendingRegistration.middleName,
            phone: null,
            email: pendingRegistration.email,
            phoneVerified: false,
        });

        const user = new User();
        user.email = pendingRegistration.email;
        user.passwordHash = pendingRegistration.passwordHash;
        user.role = UserRole.PATIENT;
        user.authProvider = AuthProvider.LOCAL;
        user.googleId = null;
        user.patient = patient;

        await this.userService.save(user);
        await this.pendingRegistrationService.remove(pendingRegistration);

        return {
            ok: true,
            message: 'Пошту підтверджено. Акаунт створено.',
        };
    }

    async login(dto: LoginDto) {
        const user = await this.userService.findByEmail(dto.email);

        if (!user || !user.passwordHash) {
            throw new UnauthorizedException('Невірна пошта або пароль');
        }

        if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
            const admin = await this.adminService.findByUserId(user.id);

            if (!admin || !admin.isActive) {
                throw new ForbiddenException('Адміністратор деактивований');
            }
        }

        const isValid = await argon2.verify(user.passwordHash, dto.password);

        if (!isValid) {
            throw new UnauthorizedException('Невірна пошта або пароль');
        }
        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        const accessToken = await this.jwtService.signAsync(payload);

        return {
            ok: true,
            message: 'Вхід успішний',
            accessToken,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                patientId: user.patient?.id || null,
            },
        };
    }

    async getMe(userId: string) {
        const user = await this.userService.findById(userId);

        if (!user) {
            throw new UnauthorizedException('Користувача не знайдено');
        }

        return {
            ok: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                authProvider: user.authProvider,
                patientId: user.patient?.id || null,
            },
        };
    }


    async googleLogin(googleUser: {
        googleId: string;
        email: string | null;
        firstName: string;
        lastName: string;
    }): Promise<{ accessToken: string; user: User }> {
        if (!googleUser.email) {
            throw new BadRequestException('Google не повернув email');
        }

        const normalizedGoogleEmail = googleUser.email.trim().toLowerCase();

        let user: User | null = await this.userService.findByGoogleId(googleUser.googleId);


        if (!user) {
            const existingByEmail = await this.userService.findByEmail(normalizedGoogleEmail);

            if (!existingByEmail) {
                throw new BadRequestException(
                    'Акаунт із таким email не знайдено. Спочатку зареєструйся звичайним способом.',
                );
            }

            if (existingByEmail.googleId && existingByEmail.googleId !== googleUser.googleId) {
                throw new BadRequestException(
                    'Цей акаунт уже прив’язаний до іншого Google-профілю.',
                );
            }

            existingByEmail.googleId = googleUser.googleId;
            existingByEmail.authProvider = AuthProvider.GOOGLE;

            user = await this.userService.save(existingByEmail);
        }

        if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
            const admin = await this.adminService.findByUserId(user.id);

            if (!admin || !admin.isActive) {
                throw new ForbiddenException('Адміністратор деактивований');
            }
        }

        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        const accessToken: string = await this.jwtService.signAsync(payload);

        return {
            accessToken,
            user,
        };
    }
}