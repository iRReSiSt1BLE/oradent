import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DoctorScheduleService } from './doctor-schedule.service';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { BlockDoctorDayDto } from './dto/block-doctor-day.dto';
import { BlockDoctorSlotDto } from './dto/block-doctor-slot.dto';

@Controller('doctor-schedule')
export class DoctorScheduleController {
    constructor(private readonly scheduleService: DoctorScheduleService) {}

    @Get(':doctorId/month')
    getMonth(
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Query('month') month: string,
    ) {
        return this.scheduleService.getMonth(doctorId, month);
    }

    @Get(':doctorId/day')
    getDay(
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Query('date') date: string,
    ) {
        return this.scheduleService.getDay(doctorId, date);
    }

    @UseGuards(JwtAuthGuard)
    @Get(':doctorId')
    getRaw(
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
    ) {
        return this.scheduleService.getRawSchedule(doctorId);
    }

    @UseGuards(JwtAuthGuard)
    @Put(':doctorId/settings')
    updateSettings(
        @Req() req: { user: { id: string } },
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Body() dto: UpdateDoctorScheduleDto,
    ) {
        return this.scheduleService.updateSchedule(req.user.id, doctorId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':doctorId/block-day')
    blockDay(
        @Req() req: { user: { id: string } },
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Body() dto: BlockDoctorDayDto,
    ) {
        return this.scheduleService.blockDay(req.user.id, doctorId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(':doctorId/block-day/:date')
    unblockDay(
        @Req() req: { user: { id: string } },
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Param('date') date: string,
    ) {
        return this.scheduleService.unblockDay(req.user.id, doctorId, date);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':doctorId/block-slot')
    blockSlot(
        @Req() req: { user: { id: string } },
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Body() dto: BlockDoctorSlotDto,
    ) {
        return this.scheduleService.blockSlot(req.user.id, doctorId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':doctorId/unblock-slot')
    unblockSlot(
        @Req() req: { user: { id: string } },
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Query('date') date: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        return this.scheduleService.unblockSlot(req.user.id, doctorId, date, start, end);
    }

    @UseGuards(JwtAuthGuard)
    @Get(':doctorId/day-conflicts')
    getDayConflicts(
        @Req() req: { user: { id: string } },
        @Param('doctorId', new ParseUUIDPipe()) doctorId: string,
        @Query('date') date: string,
    ) {
        return this.scheduleService.getDayConflicts(req.user.id, doctorId, date);
    }
}