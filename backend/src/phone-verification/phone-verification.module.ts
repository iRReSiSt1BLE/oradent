import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PhoneVerificationSession } from './entities/phone-verification-session.entity';
import { PhoneVerificationService } from './phone-verification.service';
import { PhoneVerificationController } from './phone-verification.controller';
import { TelegramController } from '../telegram/telegram.controller';
import { TelegramService } from '../telegram/telegram.service';

@Module({
    imports: [TypeOrmModule.forFeature([PhoneVerificationSession]), ConfigModule],
    providers: [PhoneVerificationService, TelegramService],
    controllers: [PhoneVerificationController, TelegramController],
    exports: [PhoneVerificationService],
})
export class PhoneVerificationModule {}