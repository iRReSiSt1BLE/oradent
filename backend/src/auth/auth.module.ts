import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { PatientModule } from '../patient/patient.module';
import { VerificationModule } from '../verification/verification.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { PendingRegistration } from './entities/pending-registration.entity';
import { PendingRegistrationService } from './pending-registration.service';
import { MailModule } from '../mail/mail.module';
import {AdminModule} from "../admin/admin.module";

@Module({
    imports: [
        ConfigModule,
        TypeOrmModule.forFeature([PendingRegistration]),
        UserModule,
        PatientModule,
        VerificationModule,
        MailModule,
        AdminModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get('JWT_SECRET') || 'fallback_secret',
                signOptions: {
                    expiresIn: (configService.get('JWT_EXPIRES_IN') || '7d') as StringValue,
                },
            }),
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        JwtStrategy,
        GoogleStrategy,
        GoogleAuthGuard,
        PendingRegistrationService,
    ],
    exports: [AuthService, JwtModule, PendingRegistrationService],
})
export class AuthModule {}