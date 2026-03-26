import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    Matches,
} from 'class-validator';

export class CreateAdminDto {
    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    lastName: string;

    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    firstName: string;

    @IsOptional()
    @IsString()
    @Length(1, 100)
    middleName?: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;

    @IsEmail()
    email: string;

    @IsString()
    @Length(8, 100)
    password: string;

    @IsString()
    @IsNotEmpty()
    @Length(4, 12)
    emailCode: string;

    @IsString()
    @IsNotEmpty()
    phoneVerificationSessionId: string;
}
