import {
    Body,
    Controller,
    Delete,
    Get,
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
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateHomeContentDto } from './dto/update-home-content.dto';
import { HomeContentService } from './home-content.service';

type HomeImageVariant = 'desktop' | 'tablet' | 'mobile';

function normalizeVariant(value: string | undefined): HomeImageVariant {
    if (value === 'tablet' || value === 'mobile') return value;
    return 'desktop';
}

@Controller('home-content')
export class HomeContentController {
    constructor(private readonly homeContentService: HomeContentService) {}

    @Get('public')
    getPublic() {
        return this.homeContentService.getPublicContent();
    }

    @UseGuards(JwtAuthGuard)
    @Get('admin')
    getAdmin(@Req() req: { user: { id: string } }) {
        return this.homeContentService.getAdminContent(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Patch('blocks')
    updateBlocks(
        @Req() req: { user: { id: string } },
        @Body() dto: UpdateHomeContentDto,
    ) {
        return this.homeContentService.updateBlocks(req.user.id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('blocks/:key/image')
    @UseInterceptors(
        FileInterceptor('image', {
            storage: memoryStorage(),
            limits: {
                fileSize: 1024 * 1024 * 10,
            },
        }),
    )
    uploadImage(
        @Req() req: { user: { id: string } },
        @Param('key') key: string,
        @Query('variant') variant: string | undefined,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.homeContentService.uploadImage(req.user.id, key, normalizeVariant(variant), file);
    }

    @UseGuards(JwtAuthGuard)
    @Delete('blocks/:key/image')
    removeImage(
        @Req() req: { user: { id: string } },
        @Param('key') key: string,
        @Query('variant') variant: string | undefined,
    ) {
        return this.homeContentService.removeImage(req.user.id, key, normalizeVariant(variant));
    }

    @Get('blocks/:key/image')
    async getImage(
        @Param('key') key: string,
        @Query('variant') variant: string | undefined,
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        const normalizedVariant = normalizeVariant(variant);
        const data = await this.homeContentService.getImageFile(key, normalizedVariant);

        res.set({
            'Content-Type': data.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: `"home-content-${key}-${normalizedVariant}-${data.version}"`,
        });

        return new StreamableFile(createReadStream(data.filePath));
    }
}
