import {
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsOptional,
    IsString,
    IsUUID,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../common/enums/payment-method.enum';

class PaidBookingStepDto {
    @IsUUID('4')
    serviceId: string;

    @IsUUID('4')
    doctorId: string;

    @IsString()
    appointmentDate: string;
}

export class CreatePaidGooglePayTestBookingDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => PaidBookingStepDto)
    steps: PaidBookingStepDto[];

    @IsOptional()
    @IsString()
    googleTransactionId?: string;

    @IsOptional()
    @IsString()
    googlePaymentToken?: string;

    @IsOptional()
    @IsEnum(PaymentMethod)
    paymentMethod?: PaymentMethod;

    @IsOptional()
    @IsString()
    lastName?: string;

    @IsOptional()
    @IsString()
    firstName?: string;

    @IsOptional()
    @IsString()
    middleName?: string;

    @IsOptional()
    @IsString()
    phone?: string;
}