import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../appointment/entities/appointment.entity';
import { CaptureAgentModule } from '../capture-agent/capture-agent.module';
import { Doctor } from '../doctor/entities/doctor.entity';
import { Patient } from '../patient/entities/patient.entity';
import { UserModule } from '../user/user.module';
import { VideoModule } from '../video/video.module';
import { DentalChartController } from './dental-chart.controller';
import { DentalChartService } from './dental-chart.service';
import { DentalSnapshot } from './entities/dental-snapshot.entity';

@Module({
  imports: [
    ConfigModule,
    CaptureAgentModule,
    VideoModule,
    UserModule,
    TypeOrmModule.forFeature([DentalSnapshot, Appointment, Patient, Doctor]),
  ],
  controllers: [DentalChartController],
  providers: [DentalChartService],
  exports: [DentalChartService],
})
export class DentalChartModule {}
