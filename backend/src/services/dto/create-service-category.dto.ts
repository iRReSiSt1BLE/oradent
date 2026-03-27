import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateServiceCategoryDto {
    @IsString()
    @Length(1, 120)
    name: string;

    @IsOptional()
    @IsString()
    @Length(0, 3000)
    description?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(-1000)
    @Max(1000)
    sortOrder?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
