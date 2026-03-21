import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateGuestAppointmentDto {
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
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;

    @IsString()
    phoneVerificationSessionId: string;

    @IsOptional()
    @IsString()
    doctorId?: string;

    @IsOptional()
    @IsString()
    serviceId?: string;

    @IsOptional()
    @IsString()
    appointmentDate?: string;

    @IsOptional()
    @IsString()
    reason?: string;
}