import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestAdminEmailVerificationDto } from './dto/request-admin-email-verification.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

@UseGuards(JwtAuthGuard)
@Controller('admins')
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    @Get()
    getAll(@Req() req: { user: { id: string } }) {
        return this.adminService.getAllAdmins(req.user.id);
    }

    @Post('request-email-verification')
    requestEmailVerification(
        @Req() req: { user: { id: string } },
        @Body() dto: RequestAdminEmailVerificationDto,
    ) {
        return this.adminService.requestEmailVerification(req.user.id, dto.email);
    }

    @Post()
    create(@Req() req: { user: { id: string } }, @Body() dto: CreateAdminDto) {
        return this.adminService.createAdmin(req.user.id, dto);
    }

    @Patch(':id/toggle-active')
    toggleActive(@Req() req: { user: { id: string } }, @Param('id') id: string) {
        return this.adminService.toggleAdminActive(req.user.id, id);
    }

    @Patch(':id')
    updateAdmin(
        @Req() req: { user: { id: string } },
        @Param('id') id: string,
        @Body() dto: UpdateAdminDto,
    ) {
        return this.adminService.updateAdmin(req.user.id, id, dto);
    }
}
