import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../appointment/entities/appointment.entity';
import { CabinetModule } from '../cabinet/cabinet.module';
import { CabinetSetupSession } from '../cabinet/entities/cabinet-setup-session.entity';
import { Cabinet } from '../cabinet/entities/cabinet.entity';
import { CaptureAgentController } from './capture-agent.controller';
import { CaptureAgentGateway } from './capture-agent.gateway';
import { CaptureAgentPreviewGateway } from './capture-agent-preview.gateway';
import { CaptureAgentPreviewSignalingService } from './capture-agent-preview-signaling.service';
import { CaptureAgentRealtimeService } from './capture-agent-realtime.service';
import { CaptureAgentService } from './capture-agent.service';
import { AppointmentPreviewController } from './appointment-preview.controller';
import { AppointmentPreviewFrameStore } from './appointment-preview-frame.store';
import { AppointmentPreviewService } from './appointment-preview.service';
import { CaptureAgentTransportController } from './capture-agent-transport.controller';
import { CaptureAgent } from './entities/capture-agent.entity';
import { CaptureDevicePair } from './entities/capture-device-pair.entity';
import { CaptureDevice } from './entities/capture-device.entity';
import { Doctor } from '../doctor/entities/doctor.entity';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([
      CaptureAgent,
      CaptureDevice,
      CaptureDevicePair,
      Cabinet,
      CabinetSetupSession,
      Appointment,
      Doctor,
    ]),
    forwardRef(() => CabinetModule),
  ],
  controllers: [
    CaptureAgentController,
    AppointmentPreviewController,
    CaptureAgentTransportController,
  ],
  providers: [
    CaptureAgentService,
    CaptureAgentGateway,
    CaptureAgentPreviewGateway,
    CaptureAgentPreviewSignalingService,
    CaptureAgentRealtimeService,
    AppointmentPreviewFrameStore,
    AppointmentPreviewService,
  ],
  exports: [
    CaptureAgentService,
    CaptureAgentRealtimeService,
    CaptureAgentPreviewSignalingService,
    AppointmentPreviewFrameStore,
  ],
})
export class CaptureAgentModule {}
