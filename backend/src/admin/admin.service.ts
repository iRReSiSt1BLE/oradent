import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { Admin } from './entities/admin.entity';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UserService } from '../user/user.service';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthProvider } from '../common/enums/auth-provider.enum';
import { ConfigService } from '@nestjs/config';
import { VerificationService } from '../verification/verification.service';
import { VerificationType } from '../common/enums/verification-type.enum';
import { MailService } from '../mail/mail.service';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';
import { UpdateAdminDto } from './dto/update-admin.dto';


@Injectable()
export class AdminService implements OnModuleInit {
    constructor(
        @InjectRepository(Admin)
        private readonly adminRepository: Repository<Admin>,
        private readonly userService: UserService,
        private readonly configService: ConfigService,
        private readonly verificationService: VerificationService,
        private readonly mailService: MailService,
        private readonly phoneVerificationService: PhoneVerificationService,
    ) {}

    async onModuleInit() {
        await this.ensureDefaultSuperAdmin();
    }

    async ensureDefaultSuperAdmin() {
        const email = this.configService.get<string>('SUPER_ADMIN_EMAIL');
        const password = this.configService.get<string>('SUPER_ADMIN_PASSWORD');
        const lastName = this.configService.get<string>('SUPER_ADMIN_LAST_NAME') || 'Owner';
        const firstName = this.configService.get<string>('SUPER_ADMIN_FIRST_NAME') || 'Super';
        const middleName = this.configService.get<string>('SUPER_ADMIN_MIDDLE_NAME') || null;
        const phone = this.configService.get<string>('SUPER_ADMIN_PHONE') || '+380000000000';

        if (!email || !password) return;

        const existingUser = await this.userService.findByEmail(email.trim().toLowerCase());
        if (existingUser) {
            const existingAdmin = await this.findByUserId(existingUser.id);
            if (!existingAdmin) {
                const admin = this.adminRepository.create({
                    user: existingUser,
                    lastName,
                    firstName,
                    middleName,
                    phone,
                    phoneVerified: false,
                    isActive: true,
                });
                await this.adminRepository.save(admin);
            }
            return;
        }

        const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

        const user = await this.userService.save(
            this.userService.create({
                email: email.trim().toLowerCase(),
                passwordHash,
                role: UserRole.SUPER_ADMIN,
                authProvider: AuthProvider.LOCAL,
                googleId: null,
            }),
        );

        const admin = this.adminRepository.create({
            user,
            lastName,
            firstName,
            middleName,
            phone,
            phoneVerified: false,
            isActive: true,
        });

        await this.adminRepository.save(admin);
    }

    async findByUserId(userId: string): Promise<Admin | null> {
        return this.adminRepository.findOne({
            where: { user: { id: userId } },
        });
    }

    async ensureSuperAdmin(userId: string) {
        const user = await this.userService.findById(userId);

        if (!user || user.role !== UserRole.SUPER_ADMIN) {
            throw new ForbiddenException('Тільки суперадмін може виконувати цю дію');
        }

        const admin = await this.findByUserId(userId);

        if (!admin || !admin.isActive) {
            throw new ForbiddenException('Профіль суперадміна неактивний');
        }

        return { user, admin };
    }

    async requestEmailVerification(currentUserId: string, email: string) {
        await this.ensureSuperAdmin(currentUserId);

        const normalizedEmail = email.trim().toLowerCase();
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
            message: 'Код підтвердження надіслано на пошту адміністратора',
        };
    }

    async createAdmin(currentUserId: string, dto: CreateAdminDto) {
        await this.ensureSuperAdmin(currentUserId);

        const normalizedEmail = dto.email.trim().toLowerCase();

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
            dto.phone,
        );

        const passwordHash = await argon2.hash(dto.password, {
            type: argon2.argon2id,
        });

        const user = await this.userService.save(
            this.userService.create({
                email: normalizedEmail,
                passwordHash,
                role: UserRole.ADMIN,
                authProvider: AuthProvider.LOCAL,
                googleId: null,
            }),
        );

        const admin = this.adminRepository.create({
            user,
            lastName: dto.lastName,
            firstName: dto.firstName,
            middleName: dto.middleName || null,
            phone: dto.phone,
            phoneVerified: true,
            isActive: true,
        });

        const savedAdmin = await this.adminRepository.save(admin);

        return {
            ok: true,
            message: 'Адміністратора створено',
            admin: {
                id: savedAdmin.id,
                userId: savedAdmin.user.id,
                email: savedAdmin.user.email,
                lastName: savedAdmin.lastName,
                firstName: savedAdmin.firstName,
                middleName: savedAdmin.middleName,
                phone: savedAdmin.phone,
                isActive: savedAdmin.isActive,
                role: savedAdmin.user.role,
            },
        };
    }

    async getAllAdmins(currentUserId: string) {
        await this.ensureSuperAdmin(currentUserId);

        const admins = await this.adminRepository.find({
            order: {
                lastName: 'ASC',
                firstName: 'ASC',
            },
        });

        return {
            ok: true,
            admins: admins.map((admin) => ({
                id: admin.id,
                userId: admin.user.id,
                email: admin.user.email,
                lastName: admin.lastName,
                firstName: admin.firstName,
                middleName: admin.middleName,
                phone: admin.phone,
                isActive: admin.isActive,
                role: admin.user.role,
            })),
        };
    }

    async toggleAdminActive(currentUserId: string, adminId: string) {
        await this.ensureSuperAdmin(currentUserId);

        const admin = await this.adminRepository.findOne({
            where: { id: adminId },
        });

        if (!admin) {
            throw new BadRequestException('Адміністратора не знайдено');
        }

        if (admin.user.role === UserRole.SUPER_ADMIN) {
            throw new BadRequestException('Не можна деактивувати суперадміністратора');
        }

        admin.isActive = !admin.isActive;
        await this.adminRepository.save(admin);

        return {
            ok: true,
            message: admin.isActive ? 'Адміністратора активовано' : 'Адміністратора деактивовано',
            isActive: admin.isActive,
        };
    }


    async updateAdmin(currentUserId: string, adminId: string, dto: UpdateAdminDto) {
        await this.ensureSuperAdmin(currentUserId);

        const admin = await this.adminRepository.findOne({
            where: { id: adminId },
        });

        if (!admin) {
            throw new BadRequestException('Адміністратора не знайдено');
        }

        if (dto.email) {
            const normalizedEmail = dto.email.trim().toLowerCase();
            const existingUser = await this.userService.findByEmail(normalizedEmail);

            if (existingUser && existingUser.id !== admin.user.id) {
                throw new BadRequestException('Користувач з такою поштою вже існує');
            }

            if (admin.user.email !== normalizedEmail) {
                admin.user.email = normalizedEmail;

                admin.user.googleId = null;
                admin.user.authProvider = AuthProvider.LOCAL;
            }

            await this.userService.save(admin.user);
        }


        if (dto.lastName !== undefined) admin.lastName = dto.lastName;
        if (dto.firstName !== undefined) admin.firstName = dto.firstName;
        if (dto.middleName !== undefined) admin.middleName = dto.middleName || null;

        if (dto.phone !== undefined) {
            if (admin.phone !== dto.phone) {
                admin.phoneVerified = false;
            }
            admin.phone = dto.phone;
        }

        const savedAdmin = await this.adminRepository.save(admin);

        return {
            ok: true,
            message: 'Профіль адміністратора оновлено',
            admin: {
                id: savedAdmin.id,
                userId: savedAdmin.user.id,
                email: savedAdmin.user.email,
                lastName: savedAdmin.lastName,
                firstName: savedAdmin.firstName,
                middleName: savedAdmin.middleName,
                phone: savedAdmin.phone,
                isActive: savedAdmin.isActive,
                role: savedAdmin.user.role,
            },
        };
    }

}
