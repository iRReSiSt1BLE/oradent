import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PhoneVerificationSession } from './entities/phone-verification-session.entity';
import { PhoneVerificationStatus } from '../common/enums/phone-verification-status.enum';

@Injectable()
export class PhoneVerificationService {
    constructor(
        @InjectRepository(PhoneVerificationSession)
        private readonly sessionRepository: Repository<PhoneVerificationSession>,
    ) {}

    normalizePhone(phone: string): string {
        return phone.replace(/[^\d+]/g, '');
    }

    async createSession(phone: string) {
        const normalizedPhone = this.normalizePhone(phone);
        const token = randomUUID();

        const session = this.sessionRepository.create({
            token,
            phone: normalizedPhone,
            status: PhoneVerificationStatus.PENDING,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            telegramUserId: null,
            telegramChatId: null,
            telegramUsername: null,
            verifiedAt: null,
        });

        const saved = await this.sessionRepository.save(session);

        return saved;
    }

    async findByToken(token: string) {
        const session = await this.sessionRepository.findOne({
            where: { token },
        });

        if (!session) {
            throw new NotFoundException('Сесію верифікації не знайдено');
        }

        return session;
    }

    async findById(id: string) {
        const session = await this.sessionRepository.findOne({
            where: { id },
        });

        if (!session) {
            throw new NotFoundException('Сесію верифікації не знайдено');
        }

        return session;
    }

    async attachTelegramUser(
        token: string,
        params: {
            telegramUserId: string;
            telegramChatId: string;
            telegramUsername: string | null;
        },
    ) {
        const session = await this.findByToken(token);

        if (session.expiresAt.getTime() < Date.now()) {
            session.status = PhoneVerificationStatus.EXPIRED;
            await this.sessionRepository.save(session);
            throw new BadRequestException('Сесія верифікації прострочена');
        }

        session.telegramUserId = params.telegramUserId;
        session.telegramChatId = params.telegramChatId;
        session.telegramUsername = params.telegramUsername;
        session.status = PhoneVerificationStatus.TELEGRAM_CONNECTED;

        return this.sessionRepository.save(session);
    }

    async findLatestPendingByTelegramChatId(chatId: string) {
        return this.sessionRepository.findOne({
            where: {
                telegramChatId: chatId,
            },
            order: {
                createdAt: 'DESC',
            },
        });
    }

    async verifyByTelegramContact(chatId: string, contactPhone: string) {
        const session = await this.findLatestPendingByTelegramChatId(chatId);

        if (!session) {
            throw new NotFoundException('Активну Telegram-сесію не знайдено');
        }

        if (session.expiresAt.getTime() < Date.now()) {
            session.status = PhoneVerificationStatus.EXPIRED;
            await this.sessionRepository.save(session);
            throw new BadRequestException('Сесія верифікації прострочена');
        }

        const normalizedContactPhone = this.normalizePhone(contactPhone);
        const normalizedSessionPhone = this.normalizePhone(session.phone);

        if (normalizedContactPhone !== normalizedSessionPhone) {
            session.status = PhoneVerificationStatus.FAILED;
            await this.sessionRepository.save(session);
            throw new BadRequestException('Номер телефону не збігається');
        }

        session.status = PhoneVerificationStatus.VERIFIED;
        session.verifiedAt = new Date();

        return this.sessionRepository.save(session);
    }

    async ensureVerified(sessionId: string, phone: string) {
        const session = await this.findById(sessionId);

        if (session.status !== PhoneVerificationStatus.VERIFIED) {
            throw new BadRequestException('Телефон ще не підтверджено');
        }

        if (this.normalizePhone(session.phone) !== this.normalizePhone(phone)) {
            throw new BadRequestException('Сесія підтвердження не відповідає номеру');
        }
        return session;
    }
}