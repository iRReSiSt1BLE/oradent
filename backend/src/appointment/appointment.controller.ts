import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AppointmentService } from './appointment.service';
import { CreateGuestAppointmentDto } from './dto/create-guest-appointment.dto';
import { CreateAuthenticatedAppointmentDto } from './dto/create-authenticated-appointment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { GetSmartAppointmentPlanDto } from './dto/get-smart-appointment-plan.dto';
import {CreatePaidGooglePayTestBookingDto} from "./dto/create-paid-google-pay-test-booking.dto";
import { AdminCancelAppointmentDto } from './dto/admin-cancel-appointment.dto';
import { AdminRescheduleAppointmentDto } from './dto/admin-reschedule-appointment.dto';
import { AdminRefundAppointmentDto } from './dto/admin-refund-appointment.dto';

type JwtUser = {
    id: string;
    email: string;
    role: UserRole;
    patientId: string | null;
};

@Controller('appointment')
export class AppointmentController {
    constructor(private readonly appointmentService: AppointmentService) {}

    @Post('guest')
    createGuestAppointment(@Body() dto: CreateGuestAppointmentDto) {
        return this.appointmentService.createGuestAppointment(dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('authenticated')
    createAuthenticatedAppointment(
        @Req() req: { user: { id: string } },
        @Body() dto: CreateAuthenticatedAppointmentDto,
    ) {
        return this.appointmentService.createAuthenticatedAppointment(
            req.user.id,
            dto,
        );
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/complete-recording')
    completeRecording(
        @Param('id') id: string,
        @Req() req: { user: JwtUser },
    ) {
        return this.appointmentService.completeRecording(id, req.user);
    }

    @UseGuards(JwtAuthGuard)
    @Get('my')
    getMyAppointments(@Req() req: { user: { id: string } }) {
        return this.appointmentService.getMyAppointments(req.user.id);
    }

    @Get()
    getAllAppointments() {
        return this.appointmentService.getAllAppointments();
    }

    @Post('smart-plan')
    getSmartPlan(
        @Req() req: { user?: { id: string } },
        @Body() dto: GetSmartAppointmentPlanDto,
    ) {
        return this.appointmentService.getSmartAppointmentPlan(req.user?.id ?? null, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Get('admin/patient/:patientId')
    async getAdminPatientAppointments(
        @Req() req: { user: { id: string } },
        @Param('patientId') patientId: string,
    ) {
        return this.appointmentService.getAdminPatientAppointments(req.user.id, patientId);
    }

    @UseGuards(JwtAuthGuard)
    @Post('admin/:id/cancel')
    async adminCancelAppointment(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
        @Body() dto: AdminCancelAppointmentDto,
    ) {
        return this.appointmentService.adminCancelAppointment(req.user.id, id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('admin/:id/reschedule')
    async adminRescheduleAppointment(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
        @Body() dto: AdminRescheduleAppointmentDto,
    ) {
        return this.appointmentService.adminRescheduleAppointment(req.user.id, id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('admin/:id/refund')
    async adminRefundAppointment(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
        @Body() dto: AdminRefundAppointmentDto,
    ) {
        return this.appointmentService.adminRefundAppointment(req.user.id, id, dto);
    }


    @Get(':id')
    findById(@Param('id') id: string) {
        return this.appointmentService.findById(id);
    }

    @Post('create-paid-google-pay-test')
    @UseGuards(JwtAuthGuard)
    createPaidGooglePayTest(@Req() req, @Body() dto: CreatePaidGooglePayTestBookingDto) {
        return this.appointmentService.createPaidGooglePayTestBooking(req.user.id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/pay-google-pay-test')
    payMyAppointmentGooglePayTest(
        @Param('id') id: string,
        @Req() req: { user: { id: string } },
        @Body()
        body: {
            googleTransactionId?: string;
            googlePaymentToken?: string;
        },
    ) {
        return this.appointmentService.payMyAppointmentGooglePayTest(
            req.user.id,
            id,
            body,
        );
    }

    @UseGuards(JwtAuthGuard)
    @Post('create-offline-booking')
    createOfflineBooking(
        @Req() req: { user: { id: string } },
        @Body()
        dto: {
            steps: Array<{
                serviceId: string;
                doctorId: string;
                appointmentDate: string;
            }>;
            paymentMethod?: 'CASH';
            phoneVerificationSessionId?: string;
            lastName?: string;
            firstName?: string;
            middleName?: string;
            phone?: string;
        },
    ) {
        return this.appointmentService.createOfflineBooking(req.user.id, dto);
    }


    @Post('create-guest-smart-booking')
    createGuestSmartBooking(
        @Body()
        body: {
            lastName: string;
            firstName: string;
            middleName?: string;
            phone: string;
            phoneVerificationSessionId: string;
            steps: Array<{
                serviceId: string;
                doctorId: string;
                appointmentDate: string;
            }>;
            paymentMethod?: 'CASH';
        },
    ) {
        return this.appointmentService.createGuestSmartBooking(body);
    }

    @Post('create-paid-google-pay-test-guest-booking')
    createPaidGooglePayTestGuestBooking(
        @Body()
        body: {
            lastName: string;
            firstName: string;
            middleName?: string;
            phone: string;
            phoneVerificationSessionId: string;
            steps: Array<{
                serviceId: string;
                doctorId: string;
                appointmentDate: string;
            }>;
            googleTransactionId?: string;
            googlePaymentToken?: string;
            paymentMethod?: 'GOOGLE_PAY';
        },
    ) {
        return this.appointmentService.createPaidGooglePayTestGuestBooking(body);
    }


}

