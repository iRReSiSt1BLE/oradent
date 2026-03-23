import { IsString, Length, Matches } from 'class-validator';

export class StartPhoneChangeDto {
    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;

    @IsString()
    @Length(8, 100)
    password: string;
}