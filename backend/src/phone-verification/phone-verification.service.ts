import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { PhoneVerificationSession } from './entities/phone-verification-session.entity';
import { PhoneVerificationStatus } from '../common/enums/phone-verification-status.enum';

@Injectable()
export class PhoneVerificationService {
    constructor(
        @InjectRepository(PhoneVerificationSession)
        private readonly phoneVerificationRepository: Repository<PhoneVerificationSession>,
    ) {}

    async createSession(
        phone: string,
        telegramBotUrl: string,
    ): Promise<PhoneVerificationSession> {
        const entity = this.phoneVerificationRepository.create({
            phone,
            status: PhoneVerificationStatus.PENDING,
            telegramBotUrl,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            telegramUserId: null,
            telegramChatId: null,
            telegramUsername: null,
            verifiedAt: null,
        });

        return this.phoneVerificationRepository.save(entity);
    }

    async save(session: PhoneVerificationSession): Promise<PhoneVerificationSession> {
        return this.phoneVerificationRepository.save(session);
    }

    async findById(id: string): Promise<PhoneVerificationSession | null> {
        return this.phoneVerificationRepository.findOne({
            where: { id },
        });
    }

    async findActiveByTelegramChatId(
        telegramChatId: string,
    ): Promise<PhoneVerificationSession | null> {
        return this.phoneVerificationRepository.findOne({
            where: [
                {
                    telegramChatId,
                    status: PhoneVerificationStatus.TELEGRAM_CONNECTED,
                },
                {
                    telegramChatId,
                    status: PhoneVerificationStatus.PENDING,
                },
            ],
            order: {
                createdAt: 'DESC',
            },
        });
    }

    async attachTelegramChat(
        sessionId: string,
        telegramData: {
            telegramUserId?: string | null;
            telegramChatId?: string | null;
            telegramUsername?: string | null;
        },
    ): Promise<PhoneVerificationSession> {
        const session = await this.findById(sessionId);

        if (!session) {
            throw new BadRequestException('Сесію не знайдено');
        }

        if (session.expiresAt.getTime() < Date.now()) {
            await this.phoneVerificationRepository.delete(session.id);
            throw new BadRequestException('Сесія підтвердження прострочена');
        }

        session.telegramUserId = telegramData.telegramUserId ?? session.telegramUserId;
        session.telegramChatId = telegramData.telegramChatId ?? session.telegramChatId;
        session.telegramUsername = telegramData.telegramUsername ?? session.telegramUsername;
        session.status = PhoneVerificationStatus.TELEGRAM_CONNECTED;

        return this.phoneVerificationRepository.save(session);
    }

    async markVerified(
        id: string,
        telegramData?: {
            telegramUserId?: string | null;
            telegramChatId?: string | null;
            telegramUsername?: string | null;
        },
    ): Promise<void> {
        const session = await this.findById(id);

        if (!session) {
            throw new BadRequestException('Сесію не знайдено');
        }

        session.status = PhoneVerificationStatus.VERIFIED;
        session.verifiedAt = new Date();
        session.telegramUserId = telegramData?.telegramUserId ?? session.telegramUserId;
        session.telegramChatId = telegramData?.telegramChatId ?? session.telegramChatId;
        session.telegramUsername = telegramData?.telegramUsername ?? session.telegramUsername;

        await this.phoneVerificationRepository.save(session);
    }

    async ensureVerified(id: string, phone: string): Promise<void> {
        const session = await this.findById(id);

        if (!session) {
            throw new BadRequestException('Сесію підтвердження не знайдено');
        }

        if (session.expiresAt.getTime() < Date.now()) {
            await this.phoneVerificationRepository.delete(session.id);
            throw new BadRequestException('Сесія підтвердження прострочена');
        }

        if (session.phone !== phone) {
            throw new BadRequestException('Номер телефону не збігається');
        }
        if (session.status !== PhoneVerificationStatus.VERIFIED) {
            throw new BadRequestException('Номер телефону ще не підтверджено');
        }

        await this.phoneVerificationRepository.delete(session.id);
    }

    async deleteExpired(): Promise<void> {
        await this.phoneVerificationRepository.delete({
            expiresAt: LessThan(new Date()),
        });
    }
}