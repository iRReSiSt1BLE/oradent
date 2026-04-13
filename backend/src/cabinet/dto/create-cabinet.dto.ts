import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CabinetDeviceStartMode } from '../entities/cabinet-device.entity';

class CabinetDeviceDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(2000)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    cameraDeviceId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    cameraLabel?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    microphoneDeviceId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    microphoneLabel?: string;

    @IsEnum(CabinetDeviceStartMode)
    startMode: CabinetDeviceStartMode;
}

export class CreateCabinetDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(2000)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(8000)
    description?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsArray()
    @IsUUID('4', { each: true })
    serviceIds: string[];

    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    doctorIds?: string[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CabinetDeviceDto)
    devices?: CabinetDeviceDto[];
}
