import {
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    Length,
    Max,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateServiceCategoryDto {
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
    @Min(0)
    @Max(9999)
    sortOrder?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}