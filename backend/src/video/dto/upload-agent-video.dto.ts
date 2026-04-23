import { IsISO8601, IsOptional, IsString, IsUUID, Matches } from "class-validator";

export class UploadAgentVideoDto {
    @IsUUID()
    appointmentId: string;

    @IsOptional()
    @IsUUID()
    cabinetDeviceId?: string;

    @IsOptional()
    @IsString()
    pairKey?: string;

    @IsOptional()
    @IsString()
    originalFileName?: string;

    @IsOptional()
    @IsString()
    mimeType?: string;

    @IsOptional()
    @IsString()
    @IsISO8601()
    startedAt?: string;

    @IsOptional()
    @IsString()
    @IsISO8601()
    endedAt?: string;

    @IsString()
    @Matches(/^[a-fA-F0-9]{64}$/)
    sha256Hash: string;

    @IsString()
    transportIv: string;

    @IsString()
    transportAuthTag: string;
}
