import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { DentalSnapshotJaw, DentalSnapshotTargetType } from '../entities/dental-snapshot.entity';

export class UpdateDentalSnapshotDto {
  @IsOptional()
  @IsIn(['TOOTH', 'JAW', 'MOUTH'])
  targetType?: DentalSnapshotTargetType;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  targetId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toothNumber?: number | null;

  @IsOptional()
  @IsIn(['UPPER', 'LOWER', 'WHOLE'])
  jaw?: DentalSnapshotJaw | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsString()
  currentAppointmentId?: string | null;
}
