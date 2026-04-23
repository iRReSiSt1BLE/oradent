import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CabinetService } from './cabinet.service';
import { CreateCabinetSetupDto } from './dto/create-cabinet-setup.dto';
import { CreateCabinetDto } from './dto/create-cabinet.dto';
import { UpdateCabinetDto } from './dto/update-cabinet.dto';
import { RequestCabinetPreviewDto } from './dto/request-cabinet-preview.dto';

@Controller('cabinets')
export class CabinetController {
  constructor(private readonly cabinetService: CabinetService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getAllForAdmin(@Req() req: { user: { id: string } }) {
    return this.cabinetService.getAllForAdmin(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('doctors/options')
  getDoctorsForAssignment(@Req() req: { user: { id: string } }) {
    return this.cabinetService.getDoctorsForAssignment(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('services/options')
  getServicesForAssignment(@Req() req: { user: { id: string } }) {
    return this.cabinetService.getServicesForAssignment(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('setup/init')
  initSetupSession(
    @Req() req: { user: { id: string } },
    @Body() dto: CreateCabinetSetupDto,
  ) {
    return this.cabinetService.initSetupSession(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('setup/:id')
  getSetupSession(
    @Req() req: { user: { id: string } },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cabinetService.getSetupSession(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('setup/:id')
  removeSetupSession(
    @Req() req: { user: { id: string } },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cabinetService.removeSetupSession(req.user.id, id);
  }


  @UseGuards(JwtAuthGuard)
  @Post('preview')
  requestPreview(
    @Req() req: { user: { id: string } },
    @Body() dto: RequestCabinetPreviewDto,
  ) {
    return this.cabinetService.requestPreview(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Req() req: { user: { id: string } },
    @Body() dto: CreateCabinetDto,
  ) {
    return this.cabinetService.create(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Req() req: { user: { id: string } },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCabinetDto,
  ) {
    return this.cabinetService.update(req.user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/toggle-active')
  toggleActive(
    @Req() req: { user: { id: string } },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cabinetService.toggleActive(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(
    @Req() req: { user: { id: string } },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cabinetService.remove(req.user.id, id);
  }
}
