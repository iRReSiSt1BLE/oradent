import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentModule } from './appointment/appointment.module';
import { VideoModule } from './video/video.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PatientModule } from './patient/patient.module';
import { VerificationModule } from './verification/verification.module';
import { PatientMedicalRecordModule } from './patient-medical-record/patient-medical-record.module';
import { PhoneVerificationModule } from './phone-verification/phone-verification.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CleanupModule } from './cleanup/cleanup.module';
import { ProfileModule } from './profile/profile.module';
import { AdminModule } from './admin/admin.module';
import { ServicesModule } from './services/services.module';
import { DoctorModule } from './doctor/doctor.module';
import { DoctorScheduleModule } from './doctor-schedule/doctor-schedule.module';
import { CabinetModule } from './cabinet/cabinet.module';
import { CaptureAgentModule } from './capture-agent/capture-agent.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                type: 'mysql',
                host: configService.get<string>('DB_HOST'),
                port: Number(configService.get<string>('DB_PORT', '3306')),
                username: configService.get<string>('DB_USER'),
                password: configService.get<string>('DB_PASSWORD'),
                database: configService.get<string>('DB_NAME'),
                autoLoadEntities: true,
                synchronize: true,
                retryAttempts: 8,
                retryDelay: 3000,
                connectorPackage: 'mysql2',
                extra: {
                    waitForConnections: true,
                    connectionLimit: 10,
                    maxIdle: 10,
                    idleTimeout: 60000,
                    queueLimit: 0,
                    enableKeepAlive: true,
                    keepAliveInitialDelay: 0,
                    connectTimeout: 10000,
                },
            }),
        }),
        ScheduleModule.forRoot(),
        CleanupModule,
        UserModule,
        PatientModule,
        AuthModule,
        AppointmentModule,
        VideoModule,
        VerificationModule,
        PatientMedicalRecordModule,
        PhoneVerificationModule,
        ProfileModule,
        AdminModule,
        DoctorModule,
        ServicesModule,
        DoctorScheduleModule,
        CabinetModule,
        CaptureAgentModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}
