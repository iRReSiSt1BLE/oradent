import { IsEmail } from 'class-validator';

export class RequestAdminEmailVerificationDto {
    @IsEmail()
    email: string;
}
