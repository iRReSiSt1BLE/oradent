import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Res,
    StreamableFile,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { VideoService } from './video.service';
import { UploadVideoDto } from './dto/upload-video.dto';

@Controller('video')
export class VideoController {
    constructor(private readonly videoService: VideoService) {}

    @Post('upload')
    @UseInterceptors(
        FileInterceptor('video', {
            storage: memoryStorage(),
            limits: {
                fileSize: 1024 * 1024 * 500,
            },
        }),
    )
    async uploadVideo(
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: UploadVideoDto,
    ) {
        const savedVideo = await this.videoService.saveUploadedVideo(file, dto);

        return {
            ok: true,
            message: 'Відео успішно завантажено',
            data: savedVideo,
        };
    }

    @Get()
    async getAllVideos() {
        const videos = await this.videoService.getAllVideos();

        return {
            ok: true,
            data: videos,
        };
    }

    @Get(':id/stream')
    async streamVideo(
        @Param('id') id: string,
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        const result = await this.videoService.streamDecryptedVideo(id);

        res.set({
            'Content-Type': result.mimeType,
            'Content-Disposition': `inline; filename="${result.fileName}"`,
        });

        return result.file;
    }
}