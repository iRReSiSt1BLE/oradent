import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationCode } from './entities/verification-code.entity';
import { VerificationService } from './verification.service';
import { MockSmsProvider } from './providers/mock-sms.provider';

@Module({
    imports: [TypeOrmModule.forFeature([VerificationCode])],
    providers: [VerificationService, MockSmsProvider],
    exports: [VerificationService],
})
export class VerificationModule {}