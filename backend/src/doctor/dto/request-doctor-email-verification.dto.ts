import { IsEmail } from 'class-validator';

export class RequestDoctorEmailVerificationDto {
    @IsEmail()
    email: string;
}
