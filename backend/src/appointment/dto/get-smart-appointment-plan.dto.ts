import {
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
} from 'class-validator';

export class GetSmartAppointmentPlanDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique()
    @IsUUID('4', { each: true })
    serviceIds: string[];

    @IsOptional()
    @IsString()
    preferredDate?: string;

    @IsOptional()
    @IsUUID('4')
    doctorId?: string;

    @IsOptional()
    @IsIn(['earliest', 'same-doctor-first'])
    mode?: 'earliest' | 'same-doctor-first';
}