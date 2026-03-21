import { IsOptional, IsString } from 'class-validator';

export class CreateAuthenticatedAppointmentDto {
    @IsOptional()
    @IsString()
    phoneVerificationSessionId?: string;

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