import {
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { Video } from './entities/video.entity';
import { UploadVideoDto } from './dto/upload-video.dto';
import { VideoSignatureService } from './video-signature.service';
import { VideoTsaService } from './video-tsa.service';
import { VideoEncryptionService } from './video-encryption.service';
import { Appointment } from '../appointment/entities/appointment.entity';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

type JwtUser = {
    id: string;
    email: string;
    role: UserRole;
    patientId: string | null;
};

@Injectable()
export class VideoService {
    constructor(
        @InjectRepository(Video)
        private readonly videoRepository: Repository<Video>,
        @InjectRepository(Appointment)
        private readonly appointmentRepository: Repository<Appointment>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly configService: ConfigService,
        private readonly videoSignatureService: VideoSignatureService,
        private readonly videoTsaService: VideoTsaService,
        private readonly videoEncryptionService: VideoEncryptionService,
    ) {}

    private async assertAppointmentAccess(
        appointmentId: string,
        actor: JwtUser,
    ): Promise<Appointment> {
        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new NotFoundException('Прийом не знайдено');
        }

        if (
            actor.role === UserRole.ADMIN ||
            actor.role === UserRole.SUPER_ADMIN
        ) {
            return appointment;
        }

        if (actor.role === UserRole.DOCTOR) {
            if (appointment.doctorId !== actor.id) {
                throw new ForbiddenException(
                    'Немає доступу до цього прийому',
                );
            }
            return appointment;
        }

        if (actor.role === UserRole.PATIENT) {
            if (!actor.patientId || appointment.patient?.id !== actor.patientId) {
                throw new ForbiddenException(
                    'Немає доступу до цього прийому',
                );
            }
            return appointment;
        }

        throw new ForbiddenException('Немає доступу');
    }

    private async verifyAccountPassword(userId: string, password: string) {
        const user = await this.userRepository.findOne({ where: { id: userId } });

        if (!user || !user.passwordHash) {
            throw new ForbiddenException('Для цього акаунта пароль не встановлено');
        }

        const ok = await argon2.verify(user.passwordHash, password);

        if (!ok) {
            throw new ForbiddenException('Невірний пароль');
        }
    }

    private decryptVideoToStream(video: Video): {
        file: StreamableFile;
        mimeType: string;
        fileName: string;
    } {
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

    async saveUploadedVideo(
        file: Express.Multer.File,
        dto: UploadVideoDto,
        actor: JwtUser,
    ): Promise<Video> {
        if (!file) {
            throw new InternalServerErrorException('Файл не отримано');
        }

        if (!dto.appointmentId) {
            throw new InternalServerErrorException('Потрібен appointmentId');
        }

        await this.assertAppointmentAccess(dto.appointmentId, actor);

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
            appointmentId: dto.appointmentId,
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

    async getVideosByAppointmentId(
        appointmentId: string,
        actor: JwtUser,
    ): Promise<Video[]> {
        await this.assertAppointmentAccess(appointmentId, actor);

        return this.videoRepository.find({
            where: { appointmentId },
            order: { createdAt: 'DESC' },
        });
    }

    async getAllVideosForRole(actor: JwtUser): Promise<Video[]> {
        if (actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN) {
            return this.videoRepository.find({
                order: { createdAt: 'DESC' },
            });
        }

        if (actor.role === UserRole.DOCTOR) {
            const myAppointments = await this.appointmentRepository.find({
                where: { doctorId: actor.id },
                select: ['id'],
            });
            const ids = myAppointments.map((a) => a.id);
            if (ids.length === 0) return [];
            return this.videoRepository
                .createQueryBuilder('v')
                .where('v.appointmentId IN (:...ids)', { ids })
                .orderBy('v.createdAt', 'DESC')
                .getMany();
        }

        if (actor.role === UserRole.PATIENT && actor.patientId) {
            const myAppointments = await this.appointmentRepository.find({
                where: { patient: { id: actor.patientId } },
                relations: ['patient'],
                select: ['id'],
            });
            const ids = myAppointments.map((a) => a.id);
            if (ids.length === 0) return [];
            return this.videoRepository
                .createQueryBuilder('v')
                .where('v.appointmentId IN (:...ids)', { ids })
                .orderBy('v.createdAt', 'DESC')
                .getMany();
        }

        return [];
    }

    async streamDecryptedVideoWithPassword(
        id: string,
        password: string,
        actor: JwtUser,
    ): Promise<{
        file: StreamableFile;
        mimeType: string;
        fileName: string;
    }> {
        await this.verifyAccountPassword(actor.id, password);

        const video = await this.videoRepository.findOne({
            where: { id },
        });

        if (!video) {
            throw new NotFoundException('Відео не знайдено');
        }

        if (!video.appointmentId) {
            throw new ForbiddenException('Відео не привʼязане до прийому');
        }

        await this.assertAppointmentAccess(video.appointmentId, actor);

        return this.decryptVideoToStream(video);
    }
}
