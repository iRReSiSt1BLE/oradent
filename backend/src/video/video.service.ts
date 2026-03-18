import {
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Video } from './entities/video.entity';
import { UploadVideoDto } from './dto/upload-video.dto';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { VideoSignatureService } from './video-signature.service';
import { VideoTsaService } from './video-tsa.service';
import { VideoEncryptionService } from './video-encryption.service';

@Injectable()
export class VideoService {
    constructor(
        @InjectRepository(Video)
        private readonly videoRepository: Repository<Video>,
        private readonly configService: ConfigService,
        private readonly videoSignatureService: VideoSignatureService,
        private readonly videoTsaService: VideoTsaService,
        private readonly videoEncryptionService: VideoEncryptionService,
    ) {}

    async saveUploadedVideo(
        file: Express.Multer.File,
        dto: UploadVideoDto,
    ): Promise<Video> {
        if (!file) {
            throw new InternalServerErrorException('Файл не отримано');
        }

        const storageRoot = this.configService.get<string>('VIDEO_STORAGE_ROOT');
        const recordsDir =
            this.configService.get<string>('VIDEO_RECORDS_DIR') || 'records';

        if (!storageRoot) {
            throw new InternalServerErrorException(
                'Не задано VIDEO_STORAGE_ROOT у .env',
            );
        }

        const uuid = randomUUID();
        const now = new Date();
        const datePart = now.toISOString().slice(0, 10);
        const folderName = `${datePart}_${uuid}`;

        const recordFolderRelativePath = path
            .join(recordsDir, folderName)
            .replace(/\\/g, '/');

        const recordFolderFullPath = path.join(storageRoot, recordsDir, folderName);

        fs.mkdirSync(recordFolderFullPath, { recursive: true });

        const plainSha256Hash = createHash('sha256')
            .update(file.buffer)
            .digest('hex');

        const encryptionResult =
            this.videoEncryptionService.encryptBuffer(file.buffer);

        const storedFileName = 'video.enc';
        const manifestFileName = 'manifest.json';

        const fullVideoPath = path.join(recordFolderFullPath, storedFileName);
        const fullManifestPath = path.join(recordFolderFullPath, manifestFileName);

        try {
            fs.writeFileSync(fullVideoPath, encryptionResult.encryptedBuffer);
        } catch {
            throw new InternalServerErrorException(
                'Не вдалося зберегти зашифрований відеофайл',
            );
        }

        const storageRelativePath = path
            .join(recordFolderRelativePath, storedFileName)
            .replace(/\\/g, '/');

        const manifestRelativePath = path
            .join(recordFolderRelativePath, manifestFileName)
            .replace(/\\/g, '/');

        const video = this.videoRepository.create({
            appointmentId: dto.appointmentId || null,
            originalFileName: file.originalname,
            storedFileName,
            storageRelativePath,
            mimeType: file.mimetype,
            size: file.size,
            startedAt: dto.startedAt ? new Date(dto.startedAt) : null,
            endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
            sha256Hash: plainSha256Hash,
            manifestRelativePath: null,
            manifestSignature: null,
            signatureAlgorithm: null,
            tsaRequestRelativePath: null,
            tsaResponseRelativePath: null,
            tsaProvider: null,
            tsaHashAlgorithm: null,
            encryptionAlgorithm: encryptionResult.algorithm,
            encryptionIv: encryptionResult.ivBase64,
            encryptionAuthTag: encryptionResult.authTagBase64,
            encryptedAt: new Date(),
        });

        const savedVideo = await this.videoRepository.save(video);

        const unsignedManifest = {
            videoId: savedVideo.id,
            appointmentId: savedVideo.appointmentId,
            originalFileName: savedVideo.originalFileName,
            storedFileName: savedVideo.storedFileName,
            storageRelativePath: savedVideo.storageRelativePath,
            mimeType: savedVideo.mimeType,
            size: savedVideo.size,
            startedAt: savedVideo.startedAt,
            endedAt: savedVideo.endedAt,
            createdAt: savedVideo.createdAt,
            sha256Hash: savedVideo.sha256Hash,
            encryptionAlgorithm: savedVideo.encryptionAlgorithm,
            encryptedAt: savedVideo.encryptedAt,
            manifestVersion: 1,
        };

        const { signatureBase64, algorithm } =
            this.videoSignatureService.signManifest(unsignedManifest);

        const signedManifest = {
            ...unsignedManifest,
            signatureAlgorithm: algorithm,
            manifestSignature: signatureBase64,
        };

        try {
            fs.writeFileSync(
                fullManifestPath,
                JSON.stringify(signedManifest, null, 2),
                'utf-8',
            );
        } catch {
            throw new InternalServerErrorException('Не вдалося зберегти маніфест');
        }

        const tsaResult = await this.videoTsaService.createTimestampForManifest({
            manifestFullPath: fullManifestPath,
            recordFolderFullPath,
        });

        savedVideo.manifestRelativePath = manifestRelativePath;
        savedVideo.manifestSignature = signatureBase64;
        savedVideo.signatureAlgorithm = algorithm;
        savedVideo.tsaRequestRelativePath = path
            .join(recordFolderRelativePath, tsaResult.tsaRequestRelativeFileName)
            .replace(/\\/g, '/');
        savedVideo.tsaResponseRelativePath = path
            .join(recordFolderRelativePath, tsaResult.tsaResponseRelativeFileName)
            .replace(/\\/g, '/');
        savedVideo.tsaProvider = tsaResult.tsaProvider;
        savedVideo.tsaHashAlgorithm = tsaResult.tsaHashAlgorithm;

        return await this.videoRepository.save(savedVideo);
    }

    async getAllVideos(): Promise<Video[]> {
        return await this.videoRepository.find({
            order: { createdAt: 'DESC' },
        });
    }

    async streamDecryptedVideo(id: string): Promise<{
        file: StreamableFile;
        mimeType: string;
        fileName: string;
    }> {
        const video = await this.videoRepository.findOne({
            where: { id },
        });

        if (!video) {
            throw new NotFoundException('Відео не знайдено');
        }

        if (!video.encryptionIv || !video.encryptionAuthTag) {
            throw new InternalServerErrorException(
                'Відсутні параметри шифрування для відео',
            );
        }

        const storageRoot = this.configService.get<string>('VIDEO_STORAGE_ROOT');

        if (!storageRoot) {
            throw new InternalServerErrorException(
                'Не задано VIDEO_STORAGE_ROOT у .env',
            );
        }

        const fullEncryptedPath = path.join(storageRoot, video.storageRelativePath);

        if (!fs.existsSync(fullEncryptedPath)) {
            throw new NotFoundException('Файл відео не знайдено');
        }

        const encryptedBuffer = fs.readFileSync(fullEncryptedPath);

        const decryptedBuffer = this.videoEncryptionService.decryptBuffer({
            encryptedBuffer,
            ivBase64: video.encryptionIv,
            authTagBase64: video.encryptionAuthTag,
        });

        return {
            file: new StreamableFile(decryptedBuffer),
            mimeType: video.mimeType || 'video/webm',
            fileName: video.originalFileName || 'video.webm',
        };
    }
}