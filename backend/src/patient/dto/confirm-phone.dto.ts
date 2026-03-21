import { IsString } from 'class-validator';

export class ConfirmPhoneDto {
    @IsString()
    phoneVerificationSessionId: string;
}