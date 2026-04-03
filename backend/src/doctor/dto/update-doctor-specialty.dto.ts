import { IsString, MinLength } from 'class-validator';

export class UpdateDoctorSpecialtyDto {
    @IsString()
    @MinLength(2)
    name!: string;
}

