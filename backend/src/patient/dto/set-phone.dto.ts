import { IsString, Matches } from 'class-validator';

export class SetPhoneDto {
    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;
}