import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PhoneVerificationSession } from './entities/phone-verification-session.entity';
import { PhoneVerificationService } from './phone-verification.service';
import { PhoneVerificationController } from './phone-verification.controller';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([PhoneVerificationSession]),
        TelegramModule,
    ],
    controllers: [PhoneVerificationController],
    providers: [PhoneVerificationService],
    exports: [PhoneVerificationService],
})
export class PhoneVerificationModule {}