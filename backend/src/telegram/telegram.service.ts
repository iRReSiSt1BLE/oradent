import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';

@Injectable()
export class TelegramService {
    constructor(
        private readonly configService: ConfigService,
        private readonly phoneVerificationService: PhoneVerificationService,
    ) {}

    getBotUsername(): string {
        const username = this.configService.get<string>('TELEGRAM_BOT_USERNAME');

        if (!username) {
            throw new InternalServerErrorException(
                'Не задано TELEGRAM_BOT_USERNAME',
            );
        }

        return username;
    }

    getBotToken(): string {
        const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

        if (!token) {
            throw new InternalServerErrorException(
                'Не задано TELEGRAM_BOT_TOKEN',
            );
        }

        return token;
    }

    buildStartLink(token: string): string {
        return `https://t.me/${this.getBotUsername()}?start=verify_${token}`;
    }

    async handleUpdate(update: any) {
        const message = update?.message;
        if (!message) return;

        const chatId = String(message.chat?.id);
        const from = message.from;

        if (message.text && message.text.startsWith('/start verify_')) {
            const token = message.text.replace('/start verify_', '').trim();

            await this.phoneVerificationService.attachTelegramUser(token, {
                telegramUserId: String(from?.id),
                telegramChatId: chatId,
                telegramUsername: from?.username || null,
            });

            await this.sendRequestContactMessage(chatId);
            return;
        }

        if (message.contact) {
            await this.phoneVerificationService.verifyByTelegramContact(
                chatId,
                message.contact.phone_number,
            );

            await this.sendMessage(
                chatId,
                'Номер телефону успішно підтверджено. Можна повертатися на сайт.',
            );
        }
    }

    async sendRequestContactMessage(chatId: string) {
        return this.callTelegram('sendMessage', {
            chat_id: chatId,
            text: 'Щоб підтвердити номер, натисніть кнопку нижче та поділіться своїм контактом.',
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
        });
    }

    async sendMessage(chatId: string, text: string) {
        return this.callTelegram('sendMessage', {
            chat_id: chatId,
            text,
        });
    }

    private async callTelegram(method: string, body: any) {
        const botToken = this.getBotToken();
        const url = `https://api.telegram.org/bot${botToken}/${method}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
            throw new InternalServerErrorException(
                `Telegram API error: ${JSON.stringify(data)}`,
        );
        }

        return data;
    }
}