import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDentalSnapshotDto } from './dto/create-dental-snapshot.dto';
import { UpdateDentalSnapshotDto } from './dto/update-dental-snapshot.dto';
import { DentalChartService } from './dental-chart.service';

@Controller('dental-chart')
export class DentalChartController {
  constructor(private readonly dentalChartService: DentalChartService) {}

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyDentalChart(@Req() req: any) {
    return this.dentalChartService.getMyChart(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('appointment/:appointmentId')
  getAppointmentDentalChart(@Param('appointmentId') appointmentId: string, @Req() req: any) {
    return this.dentalChartService.getAppointmentChart(appointmentId, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('appointment/:appointmentId/auth')
  getAppointmentDentalChartWithPassword(
    @Param('appointmentId') appointmentId: string,
    @Body() body: { password?: string },
    @Req() req: any,
  ) {
    return this.dentalChartService.getAppointmentChartWithPassword(
      appointmentId,
      req.user,
      String(body?.password || ''),
    );
  }

  @Post('agent-snapshot')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  saveAgentSnapshot(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Headers('x-agent-token') agentToken?: string,
  ) {
    return this.dentalChartService.saveAgentSnapshot(file, body, agentToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('appointment/:appointmentId/snapshots')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  createSnapshot(
    @Param('appointmentId') appointmentId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateDentalSnapshotDto,
    @Req() req: any,
  ) {
    return this.dentalChartService.createSnapshotForAppointment(appointmentId, req.user, dto, file);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('snapshots/:snapshotId')
  updateSnapshot(
    @Param('snapshotId') snapshotId: string,
    @Body() dto: UpdateDentalSnapshotDto,
    @Req() req: any,
  ) {
    return this.dentalChartService.updateSnapshot(snapshotId, req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('snapshots/:snapshotId')
  deleteSnapshot(
    @Param('snapshotId') snapshotId: string,
    @Query('currentAppointmentId') currentAppointmentId: string | undefined,
    @Req() req: any,
  ) {
    return this.dentalChartService.deleteSnapshot(snapshotId, req.user, currentAppointmentId || null);
  }

  @UseGuards(JwtAuthGuard)
  @Get('snapshots/:snapshotId/file')
  async getSnapshotFile(
    @Param('snapshotId') snapshotId: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.dentalChartService.getSnapshotFile(snapshotId, req.user);
    const safeFileName = String(file.fileName || 'dental-snapshot');
    res.setHeader('Content-Type', String(file.mimeType || 'application/octet-stream'));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFileName)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(file.stream);
  }
}
