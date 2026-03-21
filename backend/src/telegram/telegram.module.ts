import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';

@Module({
    imports: [ConfigModule, forwardRef(() => PhoneVerificationModule)],
    controllers: [TelegramController],
    providers: [TelegramService],
    exports: [TelegramService],
})
export class TelegramModule {}