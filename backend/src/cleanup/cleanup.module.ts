import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { VerificationModule } from '../verification/verification.module';
import { AuthModule } from '../auth/auth.module';
import { PhoneVerificationModule } from '../phone-verification/phone-verification.module';

@Module({
    imports: [
        VerificationModule,
        AuthModule,
        PhoneVerificationModule,
    ],
    providers: [CleanupService],
})
export class CleanupModule {}