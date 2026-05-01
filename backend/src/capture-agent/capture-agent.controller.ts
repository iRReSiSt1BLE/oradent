import { Body, Controller, Get, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { EnrollCaptureAgentDto } from './dto/enroll-capture-agent.dto';
import { CaptureAgentService } from './capture-agent.service';
import { CaptureAgentIceService } from './capture-agent-ice.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('capture-agent')
export class CaptureAgentController {
  constructor(
    private readonly captureAgentService: CaptureAgentService,
    private readonly captureAgentIceService: CaptureAgentIceService,
  ) {}

  @Get('ping')
  ping() {
    return {
      ok: true,
      service: 'capture-agent',
      time: new Date().toISOString(),
    };
  }

  @Get('webrtc/ice-servers')
  @UseGuards(JwtAuthGuard)
  getWebRtcIceServers() {
    return this.captureAgentIceService.getIceServers();
  }

  @Post('enroll')
  enroll(@Body() dto: EnrollCaptureAgentDto, @Ip() ip?: string) {
    return this.captureAgentService.enroll(dto, ip ?? null);
  }

  @Get('agents')
  listAgents() {
    return this.captureAgentService.listAgents();
  }

  @Get('agents/:agentKey')
  getAgentByKey(@Param('agentKey') agentKey: string) {
    return this.captureAgentService.getAgentByKey(agentKey);
  }
}
