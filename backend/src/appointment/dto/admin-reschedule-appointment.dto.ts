import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminRescheduleAppointmentDto {
    @IsOptional()
    @IsString()
    doctorId?: string;

    @IsDateString()
    appointmentDate: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}