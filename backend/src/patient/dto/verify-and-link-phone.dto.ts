import { IsString, Matches } from 'class-validator';

export class VerifyAndLinkPhoneDto {
    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;

    @IsString()
    phoneVerificationSessionId: string;
}