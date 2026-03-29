import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
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
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { RequestDoctorEmailVerificationDto } from './dto/request-doctor-email-verification.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';

@Controller('doctors')
export class DoctorController {
    constructor(private readonly doctorService: DoctorService) {}

    @Get('public')
    getPublic() {
        return this.doctorService.getPublicDoctors();
    }

    @UseGuards(JwtAuthGuard)
    @Get()
    getAll(@Req() req: { user: { id: string } }) {
        return this.doctorService.getAllDoctors(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Get('options')
    getOptions(@Req() req: { user: { id: string } }) {
        return this.doctorService.getDoctorsForOptions();
    }

    @UseGuards(JwtAuthGuard)
    @Get(':id')
    getById(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
    ) {
        return this.doctorService.getDoctorById(req.user.id, id);
    }

    @UseGuards(JwtAuthGuard)
    @Post('request-email-verification')
    requestEmailVerification(
        @Req() req: { user: { id: string } },
        @Body() dto: RequestDoctorEmailVerificationDto,
    ) {
        return this.doctorService.requestEmailVerification(req.user.id, dto.email);
    }

    @UseGuards(JwtAuthGuard)
    @Post()
    create(@Req() req: { user: { id: string } }, @Body() dto: CreateDoctorDto) {
        return this.doctorService.createDoctor(req.user.id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':id/toggle-active')
    toggleActive(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
    ) {
        return this.doctorService.toggleDoctorActive(req.user.id, id);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':id')
    update(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() dto: UpdateDoctorDto,
    ) {
        return this.doctorService.updateDoctor(req.user.id, id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/avatar')
    @UseInterceptors(
        FileInterceptor('avatar', {
            storage: memoryStorage(),
            limits: {
                fileSize: 1024 * 1024 * 8,
            },
        }),
    )
    uploadAvatar(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.doctorService.uploadAvatar(req.user.id, id, file);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(':id/avatar')
    removeAvatar(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
    ) {
        return this.doctorService.removeAvatar(req.user.id, id);
    }

    @Get(':id/avatar')
    async getAvatar(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Query('size') size: 'sm' | 'md' | 'lg' | undefined,
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        const normalizedSize = size === 'sm' || size === 'lg' ? size : 'md';
        const data = await this.doctorService.getAvatarFile(id, normalizedSize);

        res.set({
            'Content-Type': data.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: `"doctor-avatar-${id}-${data.version}-${normalizedSize}"`,
        });

        return new StreamableFile(require('fs').createReadStream(data.filePath));
    }
}
