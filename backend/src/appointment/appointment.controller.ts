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

    @Get()
    getAllAppointments() {
        return this.appointmentService.getAllAppointments();
    }

    @Get(':id')
    findById(@Param('id') id: string) {
        return this.appointmentService.findById(id);
    }
}