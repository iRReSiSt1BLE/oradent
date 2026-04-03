import {
    ArrayMinSize,
    IsArray,
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    Matches,
} from 'class-validator';

export class CreateDoctorDto {
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

    @IsOptional()
    @IsString()
    @Length(1, 140)
    specialty?: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    @Length(1, 140, { each: true })
    specialties?: string[];

    @IsOptional()
    @IsString()
    @Length(1, 4000)
    infoBlock?: string;

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
