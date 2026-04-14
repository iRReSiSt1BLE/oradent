import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoSignatureService } from './video-signature.service';
import { VideoTsaService } from './video-tsa.service';
import { VideoEncryptionService } from './video-encryption.service';
import { Appointment } from '../appointment/entities/appointment.entity';
import { User } from '../user/entities/user.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { VideoAccessGrant } from './entities/video-access-grant.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Video, Appointment, User, Doctor, VideoAccessGrant])],
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
