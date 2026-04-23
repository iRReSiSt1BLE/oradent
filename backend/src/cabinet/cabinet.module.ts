import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cabinet } from './entities/cabinet.entity';
import { CabinetDevice } from './entities/cabinet-device.entity';
import { CabinetDoctor } from './entities/cabinet-doctor.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';
import { CabinetController } from './cabinet.controller';
import { CabinetService } from './cabinet.service';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';
import { CaptureAgent } from '../capture-agent/entities/capture-agent.entity';
import { CaptureDevicePair } from '../capture-agent/entities/capture-device-pair.entity';
import { CabinetSetupSession } from './entities/cabinet-setup-session.entity';
import { CabinetSetupGateway } from './cabinet-setup.gateway';
import { CabinetSetupRealtimeService } from './cabinet-setup-realtime.service';
import { CaptureAgentModule } from '../capture-agent/capture-agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cabinet,
      CabinetDevice,
      CabinetDoctor,
      Doctor,
      ClinicServiceEntity,
      CaptureAgent,
      CaptureDevicePair,
      CabinetSetupSession,
    ]),
    UserModule,
    AdminModule,
    JwtModule.register({}),
    forwardRef(() => CaptureAgentModule),
  ],
  controllers: [CabinetController],
  providers: [CabinetService, CabinetSetupGateway, CabinetSetupRealtimeService],
  exports: [CabinetService, CabinetSetupRealtimeService],
})
export class CabinetModule {}
