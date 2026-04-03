import {
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    Max,
    Min,
} from 'class-validator';

export class CreateServiceCategoryDto {
    @IsString()
    @IsNotEmpty()
    @Length(1, 120)
    name: string;

    @IsOptional()
    @IsString()
    @Length(1, 4000)
    description?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(9999)
    sortOrder?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}