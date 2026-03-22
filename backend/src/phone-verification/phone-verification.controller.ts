import crypto from 'crypto';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PhoneVerificationService } from './phone-verification.service';
import { StartPhoneVerificationDto } from './dto/start-phone-verification.dto';
import { TelegramService } from '../telegram/telegram.service';

@Controller('phone-verification')
export class PhoneVerificationController {
    constructor(
        private readonly phoneVerificationService: PhoneVerificationService,
        private readonly telegramService: TelegramService,
    ) {}

    @Post('start')
    async start(@Body() dto: StartPhoneVerificationDto) {
        const tempSessionId = crypto.randomUUID();
        const tempTelegramBotUrl = this.telegramService.buildStartLink(tempSessionId);

        const session = await this.phoneVerificationService.createSession(
            dto.phone,
            tempTelegramBotUrl,
        );

        const realTelegramBotUrl = this.telegramService.buildStartLink(session.id);

        if (session.telegramBotUrl !== realTelegramBotUrl) {
            session.telegramBotUrl = realTelegramBotUrl;
            await this.phoneVerificationService.save(session);
        }

        return {
            ok: true,
            sessionId: session.id,
            phone: session.phone,
            status: session.status,
            telegramBotUrl: realTelegramBotUrl,
        };
    }

    @Get(':id/status')
    async getStatus(@Param('id') id: string) {
        const session = await this.phoneVerificationService.findById(id);

        if (!session) {
            return {
                ok: false,
                message: 'Сесію не знайдено',
            };
        }

        return {
            ok: true,
            sessionId: session.id,
            status: session.status,
            phone: session.phone,
            verifiedAt: session.verifiedAt,
        };
    }
}