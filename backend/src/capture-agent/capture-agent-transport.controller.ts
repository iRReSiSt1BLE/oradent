import { Controller, Get, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CaptureAgentService } from './capture-agent.service';

@Controller('capture-agent')
export class CaptureAgentTransportController {
  constructor(
    private readonly captureAgentService: CaptureAgentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('transport-secret')
  async getTransportSecret(@Headers('x-agent-token') agentToken?: string) {
    await this.captureAgentService.validateAgentToken(agentToken);

    return {
      ok: true,
      transportKey:
        this.configService.get<string>('CAPTURE_AGENT_TRANSPORT_KEY') ||
        this.configService.get<string>('CAPTURE_AGENT_ENROLLMENT_TOKEN') ||
        'oradent-capture-transport',
    };
  }
}
