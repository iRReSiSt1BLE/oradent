import { IsString, Length, Matches } from 'class-validator';

export class VerifyPhoneDto {
    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;

    @IsString()
    @Length(4, 10)
    code: string;
}