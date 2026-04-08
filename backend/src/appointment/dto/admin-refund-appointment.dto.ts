import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminRefundAppointmentDto {
    @IsOptional()
    @IsString()
    @IsIn(['PENDING', 'REFUNDED', 'FAILED'])
    refundStatus?: 'PENDING' | 'REFUNDED' | 'FAILED';

    @IsOptional()
    @IsString()
    @MaxLength(255)
    refundReference?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}