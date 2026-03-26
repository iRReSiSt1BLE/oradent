import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { UserModule } from '../user/user.module';
import { PatientModule } from '../patient/patient.module';
import { VerificationModule } from '../verification/verification.module';
import { MailModule } from '../mail/mail.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AdminModule } from '../admin/admin.module';

@Module({
    imports: [
        UserModule,
        PatientModule,
        VerificationModule,
        MailModule,
        PhoneVerificationModule,
        TelegramModule,
        AdminModule,
    ],
    controllers: [ProfileController],
    providers: [ProfileService],
    exports: [ProfileService],
})
export class ProfileModule {}
