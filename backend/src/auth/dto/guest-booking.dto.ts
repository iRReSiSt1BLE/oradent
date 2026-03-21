import { IsString, Length, Matches } from 'class-validator';

export class GuestBookingDto {
    @IsString()
    @Length(1, 100)
    lastName: string;

    @IsString()
    @Length(1, 100)
    firstName: string;

    @IsString()
    @Length(1, 100)
    middleName: string;

    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;

    @IsString()
    @Length(4, 10)
    verificationCode: string;
}