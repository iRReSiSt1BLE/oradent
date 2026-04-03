import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Matches,
    Max,
    Min,
} from 'class-validator';

export class UpdateClinicServiceDto {
    @IsOptional()
    @IsString()
    @Length(1, 120)
    name?: string;

    @IsOptional()
    @IsString()
    @Length(1, 4000)
    description?: string;

    @IsOptional()
    @IsInt()
    @Min(5)
    @Max(1440)
    durationMinutes?: number;

    @IsOptional()
    @Matches(/^\d+(\.\d{1,2})?$/)
    priceUah?: number;

    @IsOptional()
    @IsUUID()
    categoryId?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID('4', { each: true })
    specialtyIds?: string[];
}