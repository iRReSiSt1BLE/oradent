import {
    IsArray,
    IsOptional,
    IsString,
    IsUrl,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CaptureAgentDeviceDto {
    @IsString()
    @MaxLength(32)
    kind: string;

    @IsString()
    @MaxLength(1024)
    deviceId: string;

    @IsOptional()
    @IsString()
    @MaxLength(1024)
    label?: string | null;
}

export class EnrollCaptureAgentDto {
    @IsString()
    @MaxLength(255)
    agentKey: string;

    @IsString()
    @MaxLength(255)
    agentName: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    cabinetId?: string;

    @IsString()
    @MaxLength(255)
    enrollmentToken: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    appVersion?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CaptureAgentDeviceDto)
    devices?: CaptureAgentDeviceDto[];
}
