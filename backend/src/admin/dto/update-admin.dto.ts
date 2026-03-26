import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    Matches,
} from 'class-validator';

export class UpdateAdminDto {
    @IsOptional()
    @IsString()
    @Length(1, 100)
    lastName?: string;

    @IsOptional()
    @IsString()
    @Length(1, 100)
    firstName?: string;

    @IsOptional()
    @IsString()
    @Length(1, 100)
    middleName?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @Length(4, 12)
    emailCode?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    phoneVerificationSessionId?: string;

    @IsString()
    @IsNotEmpty()
    @Length(8, 100)
    superAdminPassword: string;
}
