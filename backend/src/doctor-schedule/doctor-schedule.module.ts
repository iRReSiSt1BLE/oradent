import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DoctorWorkSchedule } from './entities/doctor-work-schedule.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { Appointment } from '../appointment/entities/appointment.entity';
import { DoctorScheduleController } from './doctor-schedule.controller';
import { DoctorScheduleService } from './doctor-schedule.service';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([DoctorWorkSchedule, Doctor, Appointment, ClinicServiceEntity]),
        UserModule,
        AdminModule,
    ],
    controllers: [DoctorScheduleController],
    providers: [DoctorScheduleService],
    exports: [DoctorScheduleService],
})
export class DoctorScheduleModule {}
