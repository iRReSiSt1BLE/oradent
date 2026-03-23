import { IsString, Matches } from 'class-validator';

export class ConfirmPhoneChangeDto {
    @IsString()
    phoneVerificationSessionId: string;

    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;
}