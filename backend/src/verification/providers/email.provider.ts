export interface EmailProvider {
    sendVerificationEmail(email: string, code: string): Promise<void>;
}