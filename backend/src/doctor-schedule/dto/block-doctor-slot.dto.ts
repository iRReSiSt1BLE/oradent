import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class BlockDoctorSlotDto {
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    date: string;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    start: string;

    @IsString()
    @Matches(/^\d{2}:\d{2}$/)
    end: string;

    @IsOptional()
    @IsString()
    @Length(1, 200)
    reason?: string;
}
