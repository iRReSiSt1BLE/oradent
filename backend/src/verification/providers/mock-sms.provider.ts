import { Injectable } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

@Injectable()
export class MockSmsProvider implements SmsProvider {
    async sendVerificationSms(phone: string, code: string): Promise<void> {
        console.log(`[MOCK SMS] phone=${phone}, code=${code}`);
    }
}