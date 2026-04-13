import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    Length,
    Matches,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class BreakDto {
    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    start: string;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    end: string;
}

class CycleTemplateDto {
    @IsInt()
    @Min(1)
    @Max(31)
    workDays: number;

    @IsInt()
    @Min(1)
    @Max(31)
    offDays: number;

    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    anchorDate: string;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    start: string;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    end: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BreakDto)
    breaks: BreakDto[];
}

class ManualWeekTemplateDto {
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    anchorDate: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(7)
    @IsInt({ each: true })
    @Min(0, { each: true })
    @Max(6, { each: true })
    weekdays: number[];

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    start: string;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    end: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BreakDto)
    breaks: BreakDto[];
}

class DayOverrideDto {
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    date: string;

    @IsBoolean()
    enabled: boolean;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    start: string;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    end: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BreakDto)
    breaks: BreakDto[];
}

export class UpdateDoctorScheduleDto {
    @IsOptional()
    @IsString()
    @Length(2, 50)
    timezone?: string;

    @IsOptional()
    @IsInt()
    @Min(5)
    @Max(180)
    slotMinutes?: number;

    @IsOptional()
    @IsBoolean()
    workDaysConfigEnabled?: boolean;

    @IsOptional()
    @IsString()
    @Matches(/^(cycle|manual)$/)
    workDaysMode?: 'cycle' | 'manual';

    @IsOptional()
    @ValidateNested()
    @Type(() => CycleTemplateDto)
    cycleTemplate?: CycleTemplateDto;

    @IsOptional()
    @ValidateNested()
    @Type(() => ManualWeekTemplateDto)
    manualWeekTemplate?: ManualWeekTemplateDto;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayOverrideDto)
    dayOverrides?: DayOverrideDto[];

    @IsOptional()
    @IsBoolean()
    replaceDayOverrides?: boolean;
}