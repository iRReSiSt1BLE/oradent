import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VerificationService } from '../verification/verification.service';
import { PendingRegistrationService } from '../auth/pending-registration.service';
import { PhoneVerificationService } from '../phone-verification/phone-verification.service';

@Injectable()
export class CleanupService {
    constructor(
        private readonly verificationService: VerificationService,
        private readonly pendingRegistrationService: PendingRegistrationService,
        private readonly phoneVerificationService: PhoneVerificationService,
    ) {}

    @Cron(CronExpression.EVERY_10_MINUTES)
    async handleCleanup() {
        await this.verificationService.deleteExpired();
        await this.pendingRegistrationService.deleteExpired();
        await this.phoneVerificationService.deleteExpired();
    }
}