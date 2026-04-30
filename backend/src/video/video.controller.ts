import {
    Body,
    Controller,
    Get,
    Headers,
    Param,
    Post,
    Req,
    Res,
    StreamableFile,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import { VideoService } from './video.service';
import { UploadVideoDto } from './dto/upload-video.dto';
import { UploadAgentVideoDto } from './dto/upload-agent-video.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { StreamVideoDto } from './dto/stream-video.dto';

const VIDEO_UPLOAD_TMP_DIR = path.join(process.cwd(), 'tmp', 'video-uploads');
const AGENT_VIDEO_UPLOAD_TMP_DIR = path.join(process.cwd(), 'tmp', 'agent-video-uploads');

function ensureUploadTmpDir(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function makeSafeUploadFileName(file: Express.Multer.File, fallback: string) {
    const safeOriginalName = String(file.originalname || fallback).replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeOriginalName}`;
}


type JwtUser = {
    id: string;
    email: string;
    role: UserRole;
    patientId: string | null;
};

@Controller('video')
export class VideoController {
    constructor(private readonly videoService: VideoService) {}

    @UseGuards(JwtAuthGuard)
    @Post('upload')
    @UseInterceptors(
        FileInterceptor('video', {
            storage: diskStorage({
                destination: (_req, _file, callback) => {
                    ensureUploadTmpDir(VIDEO_UPLOAD_TMP_DIR);
                    callback(null, VIDEO_UPLOAD_TMP_DIR);
                },
                filename: (_req, file, callback) => {
                    callback(null, makeSafeUploadFileName(file, 'doctor-upload.webm'));
                },
            }),
            limits: {
                fileSize: 1024 * 1024 * 500,
            },
        }),
    )
    async uploadVideo(
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: UploadVideoDto,
        @Req() req: { user: JwtUser },
    ) {
        const savedVideo = await this.videoService.saveUploadedVideo(
            file,
            dto,
            req.user,
        );

        return {
            ok: true,
            message: 'Відео успішно завантажено',
            data: savedVideo,
        };
    }

    @Post('agent-upload')
    @UseInterceptors(
        FileInterceptor('video', {
            storage: diskStorage({
                destination: (_req, _file, callback) => {
                    ensureUploadTmpDir(AGENT_VIDEO_UPLOAD_TMP_DIR);
                    callback(null, AGENT_VIDEO_UPLOAD_TMP_DIR);
                },
                filename: (_req, file, callback) => {
                    callback(null, makeSafeUploadFileName(file, 'agent-recording.bin'));
                },
            }),
            limits: {
                fileSize: 1024 * 1024 * 450,
            },
        }),
    )
    async uploadVideoFromAgent(
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: UploadAgentVideoDto,
        @Headers('x-agent-token') agentToken?: string,
    ) {
        const savedVideo = await this.videoService.saveAgentUploadedVideo(file, dto, agentToken);

        return {
            ok: true,
            message: 'Відео від capture agent успішно завантажено',
            data: savedVideo,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Get('appointment/:appointmentId')
    async getVideosByAppointment(
        @Param('appointmentId') appointmentId: string,
        @Req() req: { user: JwtUser },
    ) {
        const videos = await this.videoService.getVideosByAppointmentId(
            appointmentId,
            req.user,
        );

        return {
            ok: true,
            data: videos,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Get()
    async getAllVideos(@Req() req: { user: JwtUser }) {
        const videos = await this.videoService.getAllVideosForRole(req.user);

        return {
            ok: true,
            data: videos,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Post('appointment/:appointmentId/share')
    async shareAppointmentVideos(
        @Param('appointmentId') appointmentId: string,
        @Body() body: {
            sharedWithDoctorId: string;
            password: string;
            expiresAt?: string | null;
        },
        @Req() req: { user: JwtUser },
    ) {
        return this.videoService.shareAppointmentVideos(appointmentId, req.user, body);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/stream-auth')
    async streamVideoWithPassword(
        @Param('id') id: string,
        @Body() dto: StreamVideoDto,
        @Req() req: { user: JwtUser },
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        const result = await this.videoService.streamDecryptedVideoWithPassword(
            id,
            dto.password,
            req.user,
        );

        res.set({
            'Content-Type': result.mimeType,
            'Content-Disposition': `inline; filename="${result.fileName}"`,
        });

        return result.file;
    }
}
