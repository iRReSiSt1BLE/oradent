import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateDoctorSpecialtyDto {
    @IsString()
    @IsNotEmpty()
    name: string;
}
