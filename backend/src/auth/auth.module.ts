import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { PatientModule } from '../patient/patient.module';
import { VerificationModule } from '../verification/verification.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../mail/mail.module';
import {PendingRegistrationService} from "./pending-registration.service";
import {PendingRegistration} from "./entities/pending-registration.entity";
import {TypeOrmModule} from "@nestjs/typeorm";

@Module({
    imports: [
        ConfigModule,

        TypeOrmModule.forFeature([PendingRegistration]),
        UserModule,
        PatientModule,
        MailModule,
        VerificationModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get('JWT_SECRET') || 'fallback_secret',
                signOptions: {
                    expiresIn: configService.get('JWT_EXPIRES_IN') || '7d',
                },
            }),
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, PendingRegistrationService],
    exports: [AuthService, JwtModule],
})
export class AuthModule {}