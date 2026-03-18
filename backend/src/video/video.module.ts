import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoSignatureService } from './video-signature.service';
import { VideoTsaService } from './video-tsa.service';
import { VideoEncryptionService } from './video-encryption.service';

@Module({
    imports: [TypeOrmModule.forFeature([Video])],
    controllers: [VideoController],
    providers: [
        VideoService,
        VideoSignatureService,
        VideoTsaService,
        VideoEncryptionService,
    ],
    exports: [
        VideoService,
        VideoSignatureService,
        VideoTsaService,
        VideoEncryptionService,
    ],
})
export class VideoModule {}
