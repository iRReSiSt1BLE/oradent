import {
    IsArray,
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    Length,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

type HomeContentI18nDto = {
    ua?: string;
    en?: string;
    de?: string;
    fr?: string;
};

class HomeContentItemDto {
    @IsOptional()
    title?: HomeContentI18nDto;

    @IsOptional()
    text?: HomeContentI18nDto;
}

export class UpdateHomeContentBlockDto {
    @IsString()
    @Length(1, 80)
    key: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(999)
    sortOrder?: number;

    @IsOptional()
    eyebrow?: HomeContentI18nDto;

    @IsOptional()
    title?: HomeContentI18nDto;

    @IsOptional()
    subtitle?: HomeContentI18nDto;

    @IsOptional()
    body?: HomeContentI18nDto;

    @IsOptional()
    buttonLabel?: HomeContentI18nDto;

    @IsOptional()
    @IsString()
    @Length(0, 255)
    buttonHref?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => HomeContentItemDto)
    items?: HomeContentItemDto[];

    @IsOptional()
    imageAlt?: HomeContentI18nDto;
}

export class UpdateHomeContentDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdateHomeContentBlockDto)
    blocks: UpdateHomeContentBlockDto[];
}
