import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RequestCabinetPreviewDto {
  @IsOptional()
  @IsUUID()
  setupSessionId?: string;

  @IsOptional()
  @IsUUID()
  cabinetId?: string;

  @IsString()
  @MaxLength(80)
  pairKey: string;
}
