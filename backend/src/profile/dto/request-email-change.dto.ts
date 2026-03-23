import { IsEmail, IsString, Length } from 'class-validator';

export class RequestEmailChangeDto {
    @IsEmail()
    newEmail: string;

    @IsString()
    @Length(8, 100)
    password: string;
}