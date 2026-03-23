import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateProfileDto {
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

    @IsString()
    @Length(8, 100)
    password: string;
}