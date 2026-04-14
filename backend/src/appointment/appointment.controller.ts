import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Req,
    Res,
    StreamableFile,
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
import type { Response } from 'express';

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
    @Get('admin/week')
    getAdminWeekAppointments(
        @Req() req: { user: { id: string } },
        @Query('date') date?: string,
    ) {
        return this.appointmentService.getAdminWeekAppointments(req.user.id, date);
    }

    @UseGuards(JwtAuthGuard)
    @Get('doctor/week')
    getDoctorWeekAppointments(
        @Req() req: { user: { id: string } },
        @Query('date') date?: string,
    ) {
        return this.appointmentService.getDoctorWeekAppointments(req.user.id, date);
    }

    @UseGuards(JwtAuthGuard)
    @Get('doctor/archive/my')
    getDoctorArchiveAppointments(
        @Req() req: { user: { id: string } },
    ) {
        return this.appointmentService.getDoctorArchiveAppointments(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Get('doctor/archive/shared')
    getDoctorSharedArchiveAppointments(
        @Req() req: { user: { id: string } },
    ) {
        return this.appointmentService.getDoctorSharedArchiveAppointments(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/consultation-pdf-auth')
    async streamConsultationPdfAuth(
        @Param('id') id: string,
        @Body() body: { password: string },
        @Req() req: { user: JwtUser },
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        const pdfBuffer = await this.appointmentService.getConsultationPdfBufferWithPassword(id, req.user, body.password);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline; filename="consultation-conclusion.pdf"',
        });
        return new StreamableFile(pdfBuffer);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/visit-flow-status')
    updateVisitFlowStatus(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
        @Body() body: { visitFlowStatus: string },
    ) {
        return this.appointmentService.updateVisitFlowStatus(req.user.id, id, body.visitFlowStatus);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/mark-paid')
    markAppointmentPaid(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
    ) {
        return this.appointmentService.markAppointmentPaid(req.user.id, id);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/change-cabinet')
    changeAppointmentCabinet(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
        @Body() body: { cabinetId: string },
    ) {
        return this.appointmentService.changeAppointmentCabinet(req.user.id, id, body.cabinetId);
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


    @Post('manual-availability/month')
    getManualAvailabilityMonth(
        @Body()
        body: {
            doctorId: string;
            serviceId: string;
            month: string;
        },
    ) {
        return this.appointmentService.getManualAvailabilityMonth(
            body.doctorId,
            body.serviceId,
            body.month,
        );
    }

    @Post('manual-availability/day')
    getManualAvailabilityDay(
        @Body()
        body: {
            doctorId: string;
            serviceId: string;
            date: string;
        },
    ) {
        return this.appointmentService.getManualAvailabilityDay(
            body.doctorId,
            body.serviceId,
            body.date,
        );
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
    @Get('doctor/:id')
    getDoctorAppointmentById(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
    ) {
        return this.appointmentService.getDoctorAppointmentById(req.user.id, id);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/doctor-complete')
    completeDoctorAppointment(
        @Req() req: { user: JwtUser },
        @Param('id') id: string,
        @Body()
        body: {
            consultationConclusion?: string;
            treatmentPlanItems?: string[];
            recommendationItems?: string[];
            medicationItems?: string[];
            email?: string;
            nextVisitDate?: string | null;
        },
    ) {
        return this.appointmentService.completeDoctorAppointment(id, req.user, body);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/doctor-follow-up')
    createDoctorFollowUp(
        @Req() req: { user: JwtUser },
        @Param('id') id: string,
        @Body()
        body: {
            doctorId: string;
            serviceId: string;
            appointmentDate: string;
            cabinetId?: string | null;
            email?: string;
        },
    ) {
        return this.appointmentService.createDoctorFollowUpAppointment(id, req.user, body);
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
                cabinetId?: string;
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
                cabinetId?: string;
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
                cabinetId?: string;
            }>;
            googleTransactionId?: string;
            googlePaymentToken?: string;
            paymentMethod?: 'GOOGLE_PAY';
        },
    ) {
        return this.appointmentService.createPaidGooglePayTestGuestBooking(body);
    }


}

