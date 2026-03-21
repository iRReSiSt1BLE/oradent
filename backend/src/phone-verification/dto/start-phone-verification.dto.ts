import { IsString, Matches } from 'class-validator';

export class StartPhoneVerificationDto {
    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;
}