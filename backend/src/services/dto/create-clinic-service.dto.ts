import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Matches,
    Max,
    Min,
} from 'class-validator';

export class CreateClinicServiceDto {
    @IsString()
    @IsNotEmpty()
    @Length(1, 120)
    name: string;

    @IsOptional()
    @IsString()
    @Length(1, 4000)
    description?: string;

    @IsInt()
    @Min(5)
    @Max(1440)
    durationMinutes: number;

    @Matches(/^\d+(\.\d{1,2})?$/)
    priceUah: number;

    @IsUUID()
    categoryId: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID('4', { each: true })
    specialtyIds?: string[];
}