import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Max,
    Min,
    ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClinicServiceDto {
    @IsString()
    @Length(1, 700)
    name: string;

    @IsOptional()
    @IsString()
    @Length(0, 12000)
    description?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(9999)
    sortOrder?: number;

    @Type(() => Number)
    @IsInt()
    @Min(5)
    @Max(480)
    durationMinutes: number;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(1)
    priceUah: number;

    @IsUUID('4')
    categoryId: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsUUID('4', { each: true })
    specialtyIds?: string[];

    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsUUID('4', { each: true })
    requiredServiceIds?: string[];

    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsUUID('4', { each: true })
    prerequisiteServiceIds?: string[];

    @IsOptional()
    @IsBoolean()
    allowMultipleInCart?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(999)
    maxCartQuantity?: number | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(365)
    minIntervalDays?: number;

    @ValidateIf((o) => o.maxIntervalDays !== undefined && o.maxIntervalDays !== null)
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(365)
    maxIntervalDays?: number;
}
