import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';
import { Appointment } from './entities/appointment.entity';
import { PatientModule } from '../patient/patient.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';
import { UserModule } from '../user/user.module';
import { ServicesModule } from '../services/services.module';
import { Video } from '../video/entities/video.entity';
import { DoctorScheduleModule } from '../doctor-schedule/doctor-schedule.module';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { MailModule } from '../mail/mail.module';
import {Patient} from "../patient/entities/patient.entity";
import { Cabinet } from '../cabinet/entities/cabinet.entity';
import { VideoAccessGrant } from '../video/entities/video-access-grant.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Appointment,
            Video,
            ClinicServiceEntity,
            Doctor,
            Patient,
            Cabinet,
            VideoAccessGrant,
        ]),
        PatientModule,
        PhoneVerificationModule,
        UserModule,
        ServicesModule,
        DoctorScheduleModule,
        MailModule,
    ],
    controllers: [AppointmentController],
    providers: [AppointmentService],
    exports: [AppointmentService],
})
export class AppointmentModule {}