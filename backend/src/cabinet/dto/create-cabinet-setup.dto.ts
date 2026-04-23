import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCabinetSetupDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  draftName?: string;
}
