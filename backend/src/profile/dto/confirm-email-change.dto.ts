import { IsEmail, IsString, Length } from 'class-validator';

export class ConfirmEmailChangeDto {
    @IsEmail()
    newEmail: string;

    @IsString()
    @Length(4, 10)
    code: string;
}