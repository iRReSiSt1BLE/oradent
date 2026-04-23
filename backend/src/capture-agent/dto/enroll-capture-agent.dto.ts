import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
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

export class CaptureAgentDevicePairDto {
  @IsString()
  @MaxLength(80)
  pairKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string | null;

  @IsString()
  @MaxLength(1024)
  videoDeviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  videoLabel?: string | null;

  @IsString()
  @MaxLength(1024)
  audioDeviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  audioLabel?: string | null;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class EnrollCaptureAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  agentKey?: string;

  @IsString()
  @MaxLength(255)
  agentName: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cabinetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cabinetCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  enrollmentToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  appVersion?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CaptureAgentDeviceDto)
  devices?: CaptureAgentDeviceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CaptureAgentDevicePairDto)
  devicePairs?: CaptureAgentDevicePairDto[];
}
