import {IsNotEmpty, IsOptional, IsString} from 'class-validator';

export class CreateAuthenticatedAppointmentDto {
    @IsOptional()
    @IsString()
    phoneVerificationSessionId?: string;

    @IsNotEmpty()
    @IsString()
    doctorId?: string;

    @IsNotEmpty()
    @IsString()
    serviceId?: string;

    @IsNotEmpty()
    @IsString()
    appointmentDate?: string;

}