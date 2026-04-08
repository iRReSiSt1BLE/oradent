import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminCancelAppointmentDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}