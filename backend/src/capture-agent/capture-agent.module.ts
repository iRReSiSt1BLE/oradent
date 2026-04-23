import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cabinet } from '../cabinet/entities/cabinet.entity';
import { CaptureAgentController } from './capture-agent.controller';
import { CaptureAgentGateway } from './capture-agent.gateway';
import { CaptureAgentService } from './capture-agent.service';
import { CaptureAgent } from './entities/capture-agent.entity';
import { CaptureDevice } from './entities/capture-device.entity';
import { CaptureDevicePair } from './entities/capture-device-pair.entity';
import { CabinetSetupSession } from '../cabinet/entities/cabinet-setup-session.entity';
import { CabinetModule } from '../cabinet/cabinet.module';
import { CaptureAgentRealtimeService } from './capture-agent-realtime.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([CaptureAgent, CaptureDevice, CaptureDevicePair, Cabinet, CabinetSetupSession]),
    forwardRef(() => CabinetModule),
  ],
  controllers: [CaptureAgentController],
  providers: [CaptureAgentService, CaptureAgentGateway, CaptureAgentRealtimeService],
  exports: [CaptureAgentService, CaptureAgentRealtimeService],
})
export class CaptureAgentModule {}
