export interface SmsProvider {
    sendVerificationSms(phone: string, code: string): Promise<void>;
}