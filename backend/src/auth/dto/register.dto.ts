import { IsEmail, IsString, Length, Matches, IsOptional } from 'class-validator';

export class RegisterDto {
    @IsString()
    @Length(1, 100)
    lastName: string;

    @IsString()
    @Length(1, 100)
    firstName: string;

    @IsOptional()
    @IsString()
    @Length(1, 100)
    middleName?: string;

    @IsEmail()
    email: string;

    @IsString()
    @Length(8, 100)
    password: string;
}