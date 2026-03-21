import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StartPhoneVerificationDto } from './dto/start-phone-verification.dto';
import { PhoneVerificationService } from './phone-verification.service';
import { TelegramService } from '../telegram/telegram.service';

@Controller('phone-verification')
export class PhoneVerificationController {
    constructor(
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly telegramService: TelegramService,
    ) {}

    @Post('start')
    async start(@Body() dto: StartPhoneVerificationDto) {
        const session = await this.phoneVerificationService.createSession(dto.phone);

        return {
            ok: true,
            sessionId: session.id,
            phone: session.phone,
            status: session.status,
            telegramBotUrl: this.telegramService.buildStartLink(session.token),
        };
    }

    @Get(':id/status')
    async getStatus(@Param('id') id: string) {
        const session = await this.phoneVerificationService.findById(id);

        return {
            ok: true,
            sessionId: session.id,
            status: session.status,
            phone: session.phone,
            verifiedAt: session.verifiedAt,
        };
    }
}