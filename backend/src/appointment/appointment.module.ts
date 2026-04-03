import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from './entities/appointment.entity';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';
import { PatientModule } from '../patient/patient.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';
import { UserModule } from '../user/user.module';
import { ServicesModule } from '../services/services.module';
import { Video } from '../video/entities/video.entity';
import { DoctorScheduleModule } from '../doctor-schedule/doctor-schedule.module';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([Appointment, Video, ClinicServiceEntity]),
        PatientModule,
        PhoneVerificationModule,
        UserModule,
        ServicesModule,
        DoctorScheduleModule,
    ],
    controllers: [AppointmentController],
    providers: [AppointmentService],
    exports: [AppointmentService],
})
export class AppointmentModule {}
