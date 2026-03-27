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
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateClinicServiceDto {
    @IsString()
    @Length(1, 120)
    name: string;

    @IsOptional()
    @IsString()
    @Length(0, 3000)
    description?: string;

    @Type(() => Number)
    @IsInt()
    @Min(5)
    @Max(480)
    durationMinutes: number;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(1)
    priceUsd: number;

    @IsUUID('4')
    categoryId: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayUnique()
    @IsUUID('4', { each: true })
    doctorIds?: string[];
}
