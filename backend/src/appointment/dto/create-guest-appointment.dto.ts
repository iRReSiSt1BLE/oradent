import {
    IsDateString,
    IsNotEmpty,
    IsString,
    Length,
    Matches,
} from 'class-validator';

export class CreateGuestAppointmentDto {
    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    lastName: string;

    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    firstName: string;

    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    middleName: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?[0-9]{10,15}$/)
    phone: string;

    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    doctorId: string;

    @IsString()
    @IsNotEmpty()
    @Length(1, 100)
    serviceId: string;

    @IsDateString()
    @IsNotEmpty()
    appointmentDate: string;

    @IsString()
    @IsNotEmpty()
    phoneVerificationSessionId: string;
}