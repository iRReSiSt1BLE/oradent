import { Body, Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { EnrollCaptureAgentDto } from './dto/enroll-capture-agent.dto';
import { CaptureAgentService } from './capture-agent.service';

@Controller('capture-agent')
export class CaptureAgentController {
  constructor(private readonly captureAgentService: CaptureAgentService) {}

  @Get('ping')
  ping() {
    return {
      ok: true,
      service: 'capture-agent',
      time: new Date().toISOString(),
    };
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
