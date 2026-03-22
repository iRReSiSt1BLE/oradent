import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { VerificationCode } from './entities/verification-code.entity';
import { VerificationType } from '../common/enums/verification-type.enum';

@Injectable()
export class VerificationService {
    constructor(
        @InjectRepository(VerificationCode)
        private readonly verificationCodeRepository: Repository<VerificationCode>,
    ) {}

    generateCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async createCode(target: string, type: VerificationType): Promise<string> {
        await this.verificationCodeRepository.delete({
            target,
            type,
        });

        const code = this.generateCode();

        const entity = this.verificationCodeRepository.create({
            target,
            type,
            code,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });

        await this.verificationCodeRepository.save(entity);

        return code;
    }

    async verifyCode(
        target: string,
        type: VerificationType,
        code: string,
    ): Promise<void> {
        const entity = await this.verificationCodeRepository.findOne({
            where: {
                target,
                type,
                code,
            },
        });

        if (!entity) {
            throw new BadRequestException('Невірний код');
        }

        if (entity.expiresAt.getTime() < Date.now()) {
            await this.verificationCodeRepository.delete(entity.id);
            throw new BadRequestException('Термін дії коду минув');
        }

        await this.verificationCodeRepository.delete(entity.id);
    }

    async deleteExpired(): Promise<void> {
        await this.verificationCodeRepository.delete({
            expiresAt: LessThan(new Date()),
        });
    }
}