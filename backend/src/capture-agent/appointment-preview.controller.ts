import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AppointmentPreviewService } from './appointment-preview.service';

@Controller('capture-agent/appointment-preview')
@UseGuards(JwtAuthGuard)
export class AppointmentPreviewController {
  constructor(private readonly appointmentPreviewService: AppointmentPreviewService) {}

  @Post('start')
  startPreview(
    @Req() req: any,
    @Body() body: { appointmentId?: string; cabinetDeviceId?: string },
  ) {
    return this.appointmentPreviewService.startPreview(
      req.user,
      String(body?.appointmentId || ''),
      String(body?.cabinetDeviceId || ''),
    );
  }

  @Post('stop')
  stopPreview(
    @Req() req: any,
    @Body() body: { appointmentId?: string; cabinetDeviceId?: string },
  ) {
    return this.appointmentPreviewService.stopPreview(
      req.user,
      String(body?.appointmentId || ''),
      String(body?.cabinetDeviceId || ''),
    );
  }

  @Get('frame')
  getLatestFrame(
    @Req() req: any,
    @Query('appointmentId') appointmentId?: string,
    @Query('cabinetDeviceId') cabinetDeviceId?: string,
  ) {
    return this.appointmentPreviewService.getLatestFrame(
      req.user,
      String(appointmentId || ''),
      String(cabinetDeviceId || ''),
    );
  }
}
