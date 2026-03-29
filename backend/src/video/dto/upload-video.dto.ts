import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadVideoDto {
    @IsOptional()
    @IsUUID()
    appointmentId?: string;

    @IsOptional()
    @IsString()
    @IsISO8601()
    startedAt?: string;

    @IsOptional()
    @IsString()
    @IsISO8601()
    endedAt?: string;
}
