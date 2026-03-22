import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';
import { normalizePhone } from '../common/utils/normalize-phone.util';

@Injectable()
export class TelegramService {
    constructor(
        private readonly configService: ConfigService,
        private readonly phoneVerificationService: PhoneVerificationService,
    ) {}

    getBotUsername(): string {
        const username = this.configService.get<string>('TELEGRAM_BOT_USERNAME');

        if (!username) {
            throw new InternalServerErrorException('Не задано TELEGRAM_BOT_USERNAME');
        }

        return username;
    }

    getBotToken(): string {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

        if (!token) {
            throw new InternalServerErrorException('Не задано TELEGRAM_BOT_TOKEN');
        }

        return token;
    }

    buildStartLink(sessionId: string): string {
        return `https://t.me/${this.getBotUsername()}?start=${sessionId}`;
    }

    async handleUpdate(update: any): Promise<void> {
        if (update?.message?.text?.startsWith('/start')) {
            await this.handleStartCommand(update.message);
            return;
        }

        if (update?.message?.contact) {
            await this.handleContact(update.message);
        }
    }

    private async handleStartCommand(message: any): Promise<void> {
        const text: string = message.text || '';
        const parts = text.split(' ');
        const sessionId = parts[1];

        if (!sessionId) {
            await this.sendMessage(
                message.chat.id,
                'Сесію підтвердження не передано. Повернись на сайт і відкрий Telegram ще раз.',
            );
            return;
        }

        try {
            await this.phoneVerificationService.attachTelegramChat(sessionId, {
                telegramUserId: message.from?.id ? String(message.from.id) : null,
                telegramChatId: message.chat?.id ? String(message.chat.id) : null,
                telegramUsername: message.from?.username || null,
            });

            await this.sendReplyKeyboard(
                message.chat.id,
                'Натисни кнопку нижче, щоб поділитися своїм номером телефону.',
            );
        } catch (error) {
            await this.sendMessage(
                message.chat.id,
                error instanceof Error ? error.message : 'Не вдалося ініціалізувати підтвердження.',
            );
        }
    }

    private async handleContact(message: any): Promise<void> {
        const contact = message.contact;

        const chatId = message.chat?.id ? String(message.chat.id) : null;
        if (!chatId) {
            return;
        }

        const session = await this.phoneVerificationService.findActiveByTelegramChatId(chatId);

        if (!session) {
            await this.sendMessage(
                message.chat.id,
                'Активну сесію підтвердження не знайдено. Повернись на сайт і почни ще раз.',
            );
            return;
        }

        const normalizedTelegramPhone = normalizePhone(contact.phone_number);
        const normalizedSessionPhone = normalizePhone(session.phone);

        if (normalizedTelegramPhone !== normalizedSessionPhone) {
            await this.sendMessage(
                message.chat.id,
                'Номер телефону не збігається з номером, вказаним у формі.',
            );
            return;
        }

        await this.phoneVerificationService.markVerified(session.id, {
            telegramUserId: message.from?.id ? String(message.from.id) : null,
            telegramChatId: chatId,
            telegramUsername: message.from?.username || null,
        });

        await this.sendMessage(
            message.chat.id,
            'Номер телефону успішно підтверджено. Можна повертатися на сайт.',
        );
    }

    private async sendReplyKeyboard(chatId: string | number, text: string): Promise<void> {
        await fetch(`https://api.telegram.org/bot${this.getBotToken()}/sendMessage`, {
        method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                reply_markup: {
                    keyboard: [
                        [
                            {
                                text: 'Поділитися контактом',
                                request_contact: true,
                            },
                        ],
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                },
            }),
        });
    }

    private async sendMessage(chatId: string | number, text: string): Promise<void> {
        await fetch(`https://api.telegram.org/bot${this.getBotToken()}/sendMessage`, {
        method: 'POST',
            headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: chatId,
            text,
        }),
    });
}
}
