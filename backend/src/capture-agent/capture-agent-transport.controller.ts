import { Controller, Get, Headers, InternalServerErrorException } from '@nestjs/common';
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

    const transportKey = (
      this.configService.get<string>('CAPTURE_AGENT_TRANSPORT_KEY') ||
      this.configService.get<string>('CAPTURE_AGENT_ENROLLMENT_TOKEN') ||
      ''
    ).trim();

    if (!transportKey) {
      throw new InternalServerErrorException('Не задано CAPTURE_AGENT_TRANSPORT_KEY або CAPTURE_AGENT_ENROLLMENT_TOKEN');
    }

    return {
      ok: true,
      transportKey,
    };
  }
}
