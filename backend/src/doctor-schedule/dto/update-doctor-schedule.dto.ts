import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
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

class WeeklyDayDto {
    @IsInt()
    @Min(0)
    @Max(6)
    weekday: number;

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

    @IsIn(['WEEKLY', 'CYCLE'])
    templateType: 'WEEKLY' | 'CYCLE';

    @IsOptional()
    @IsArray()
    @ArrayMinSize(7)
    @ArrayMaxSize(7)
    @ValidateNested({ each: true })
    @Type(() => WeeklyDayDto)
    weeklyTemplate?: WeeklyDayDto[];

    @IsOptional()
    @ValidateNested()
    @Type(() => CycleTemplateDto)
    cycleTemplate?: CycleTemplateDto;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DayOverrideDto)
    dayOverrides?: DayOverrideDto[];
}
