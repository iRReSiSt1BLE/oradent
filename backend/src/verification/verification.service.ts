import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationCode } from './entities/verification-code.entity';
import { VerificationType } from '../common/enums/verification-type.enum';
import { MockSmsProvider } from './providers/mock-sms.provider';

@Injectable()
export class VerificationService {
    constructor(
        @InjectRepository(VerificationCode)
        private readonly verificationRepository: Repository<VerificationCode>,
        private readonly mockSmsProvider: MockSmsProvider,
    ) {}

    private generateCode(): string {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    async createCode(target: string, type: VerificationType): Promise<string> {
        const code = this.generateCode();

        const entity = this.verificationRepository.create({
            target,
            type,
            code,
            isUsed: false,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });

        await this.verificationRepository.save(entity);
        return code;
    }

    async sendPhoneCode(phone: string): Promise<void> {
        const code = await this.createCode(phone, VerificationType.PHONE_VERIFY);
        await this.mockSmsProvider.sendVerificationSms(phone, code);
    }

    async verifyCode(
        target: string,
        type: VerificationType,
        code: string,
    ): Promise<void> {
        const record = await this.verificationRepository.findOne({
            where: {
                target,
                type,
                code,
                isUsed: false,
            },
            order: { createdAt: 'DESC' },
        });

        if (!record) {
            throw new BadRequestException('Невірний код');
        }

        if (record.expiresAt.getTime() < Date.now()) {
            throw new BadRequestException('Код прострочений');
        }

        record.isUsed = true;
        await this.verificationRepository.save(record);
    }
}