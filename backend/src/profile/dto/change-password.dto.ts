import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
    @IsString()
    @Length(8, 100)
    currentPassword: string;

    @IsString()
    @Length(8, 100)
    newPassword: string;
}
