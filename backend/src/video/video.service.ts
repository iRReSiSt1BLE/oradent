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
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { decryptAgentTransportPayload } from './video-transport-crypto';
import { Video } from './entities/video.entity';
import { UploadVideoDto } from './dto/upload-video.dto';
import { UploadAgentVideoDto } from './dto/upload-agent-video.dto';
import { VideoSignatureService } from './video-signature.service';
import { VideoTsaService } from './video-tsa.service';
import { VideoEncryptionService } from './video-encryption.service';
import { Appointment } from '../appointment/entities/appointment.entity';
import { User } from '../user/entities/user.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { VideoAccessGrant } from './entities/video-access-grant.entity';
import { CaptureAgentService } from '../capture-agent/capture-agent.service';

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
        @InjectRepository(Doctor)
        private readonly doctorRepository: Repository<Doctor>,
        @InjectRepository(VideoAccessGrant)
        private readonly videoAccessGrantRepository: Repository<VideoAccessGrant>,
        private readonly configService: ConfigService,
        private readonly videoSignatureService: VideoSignatureService,
        private readonly videoTsaService: VideoTsaService,
        private readonly videoEncryptionService: VideoEncryptionService,
        private readonly captureAgentService: CaptureAgentService,
    ) {}

    private async resolveDoctorEntityByAnyId(ref: string | null | undefined) {
        if (!ref) return null;

        return this.doctorRepository.findOne({
            where: [
                { id: ref },
                { user: { id: ref } },
            ],
            relations: ['user'],
        });
    }

    private async doctorOwnsAppointment(appointment: Appointment, actorUserId: string) {
        if (!appointment.doctorId) return false;
        if (appointment.doctorId === actorUserId) return true;

        const doctor = await this.resolveDoctorEntityByAnyId(appointment.doctorId);
        if (!doctor) return false;
        return doctor.id === actorUserId || doctor.user?.id === actorUserId;
    }

    private async hasValidShareAccess(appointmentId: string, actorUserId: string) {
        const now = new Date();
        const grants = await this.videoAccessGrantRepository.find({
            where: { appointmentId, sharedWithDoctorId: actorUserId },
            order: { updatedAt: 'DESC', createdAt: 'DESC' },
        });

        return grants.some((grant) => !grant.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime());
    }


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
            const ownsAppointment = await this.doctorOwnsAppointment(appointment, actor.id);
            const hasSharedAccess = ownsAppointment
                ? false
                : await this.hasValidShareAccess(appointment.id, actor.id);

            if (!ownsAppointment && !hasSharedAccess) {
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

    private getTransportSecret() {
        return (
            this.configService.get<string>('CAPTURE_AGENT_TRANSPORT_KEY') ||
            this.configService.get<string>('CAPTURE_AGENT_ENROLLMENT_TOKEN') ||
            'oradent-capture-transport'
        );
    }

    private getOrCreateStorageEncryptionKey(): Buffer {
        const keyPath = this.configService.get<string>('VIDEO_ENCRYPTION_KEY_PATH');

        if (!keyPath) {
            throw new InternalServerErrorException('Не задано VIDEO_ENCRYPTION_KEY_PATH');
        }

        fs.mkdirSync(path.dirname(keyPath), { recursive: true });

        if (!fs.existsSync(keyPath)) {
            fs.writeFileSync(keyPath, randomBytes(32));
        }

        const key = fs.readFileSync(keyPath);

        if (key.length !== 32) {
            throw new InternalServerErrorException('AES key must be exactly 32 bytes');
        }

        return key;
    }

    private deriveAgentTransportKey(secret: string): Buffer {
        return createHash('sha256').update(secret).digest();
    }

    private async decryptAgentTransportFileToPlainFile(params: {
        encryptedPath: string;
        plainPath: string;
        secret: string;
        ivBase64: string;
        authTagBase64: string;
    }): Promise<{ sha256Hash: string; size: number }> {
        const decipher = createDecipheriv(
            'aes-256-gcm',
            this.deriveAgentTransportKey(params.secret),
            Buffer.from(params.ivBase64, 'base64'),
        );
        decipher.setAuthTag(Buffer.from(params.authTagBase64, 'base64'));

        const hash = createHash('sha256');
        let size = 0;

        const hashPlainTransform = new Transform({
            transform(chunk, _encoding, callback) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += buffer.length;
                hash.update(buffer);
                callback(null, buffer);
            },
        });

        await pipeline(
            fs.createReadStream(params.encryptedPath),
            decipher,
            hashPlainTransform,
            fs.createWriteStream(params.plainPath),
        );

        return {
            sha256Hash: hash.digest('hex'),
            size,
        };
    }

    private async encryptPlainFileToStorage(params: {
        plainPath: string;
        encryptedPath: string;
    }): Promise<{
        ivBase64: string;
        authTagBase64: string;
        algorithm: string;
    }> {
        const key = this.getOrCreateStorageEncryptionKey();
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);

        await pipeline(
            fs.createReadStream(params.plainPath),
            cipher,
            fs.createWriteStream(params.encryptedPath),
        );

        return {
            ivBase64: iv.toString('base64'),
            authTagBase64: cipher.getAuthTag().toString('base64'),
            algorithm: 'AES-256-GCM',
        };
    }

    private safeUnlink(filePath: string | undefined | null): void {
        if (!filePath) return;

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch {
            // ignore local temporary cleanup failures
        }
    }

    private async persistPlainVideoBuffer(params: {
        appointmentId: string;
        originalFileName: string;
        mimeType: string;
        startedAt?: string | null;
        endedAt?: string | null;
        plainBuffer: Buffer;
    }): Promise<Video> {
        const storageRoot = this.configService.get<string>('VIDEO_STORAGE_ROOT');
        const recordsDir = this.configService.get<string>('VIDEO_RECORDS_DIR') || 'records';

        if (!storageRoot) {
            throw new InternalServerErrorException('Не задано VIDEO_STORAGE_ROOT у .env');
        }

        const uuid = randomUUID();
        const now = new Date();
        const datePart = now.toISOString().slice(0, 10);
        const folderName = `${datePart}_${uuid}`;
        const recordFolderRelativePath = path.join(recordsDir, folderName).replace(/\\/g, '/');
        const recordFolderFullPath = path.join(storageRoot, recordsDir, folderName);
        fs.mkdirSync(recordFolderFullPath, { recursive: true });

        const plainSha256Hash = createHash('sha256').update(params.plainBuffer).digest('hex');
        const encryptionResult = this.videoEncryptionService.encryptBuffer(params.plainBuffer);

        const storedFileName = 'video.enc';
        const manifestFileName = 'manifest.json';
        const fullVideoPath = path.join(recordFolderFullPath, storedFileName);
        const fullManifestPath = path.join(recordFolderFullPath, manifestFileName);

        try {
            fs.writeFileSync(fullVideoPath, encryptionResult.encryptedBuffer);
        } catch {
            throw new InternalServerErrorException('Не вдалося зберегти зашифрований відеофайл');
        }

        const storageRelativePath = path.join(recordFolderRelativePath, storedFileName).replace(/\\/g, '/');
        const manifestRelativePath = path.join(recordFolderRelativePath, manifestFileName).replace(/\\/g, '/');

        const video = this.videoRepository.create({
            appointmentId: params.appointmentId,
            originalFileName: params.originalFileName,
            storedFileName,
            storageRelativePath,
            mimeType: params.mimeType,
            size: params.plainBuffer.length,
            startedAt: params.startedAt ? new Date(params.startedAt) : null,
            endedAt: params.endedAt ? new Date(params.endedAt) : null,
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

        const { signatureBase64, algorithm } = this.videoSignatureService.signManifest(unsignedManifest);
        const signedManifest = { ...unsignedManifest, signatureAlgorithm: algorithm, manifestSignature: signatureBase64 };

        try {
            fs.writeFileSync(fullManifestPath, JSON.stringify(signedManifest, null, 2), 'utf-8');
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
        savedVideo.tsaRequestRelativePath = path.join(recordFolderRelativePath, tsaResult.tsaRequestRelativeFileName).replace(/\\/g, '/');
        savedVideo.tsaResponseRelativePath = path.join(recordFolderRelativePath, tsaResult.tsaResponseRelativeFileName).replace(/\\/g, '/');
        savedVideo.tsaProvider = tsaResult.tsaProvider;
        savedVideo.tsaHashAlgorithm = tsaResult.tsaHashAlgorithm;

        const finalizedVideo = await this.videoRepository.save(savedVideo);

        const appointment = await this.appointmentRepository.findOne({ where: { id: params.appointmentId } });
        if (appointment) {
            appointment.recordingCompleted = true;
            appointment.recordingCompletedAt = appointment.recordingCompletedAt || new Date();
            await this.appointmentRepository.save(appointment);
        }

        return finalizedVideo;
    }

    private async persistPlainVideoFile(params: {
        appointmentId: string;
        originalFileName: string;
        mimeType: string;
        startedAt?: string | null;
        endedAt?: string | null;
        plainFilePath: string;
        plainSha256Hash: string;
        plainSize: number;
    }): Promise<Video> {
        const storageRoot = this.configService.get<string>('VIDEO_STORAGE_ROOT');
        const recordsDir = this.configService.get<string>('VIDEO_RECORDS_DIR') || 'records';

        if (!storageRoot) {
            throw new InternalServerErrorException('Не задано VIDEO_STORAGE_ROOT у .env');
        }

        const uuid = randomUUID();
        const now = new Date();
        const datePart = now.toISOString().slice(0, 10);
        const folderName = `${datePart}_${uuid}`;
        const recordFolderRelativePath = path.join(recordsDir, folderName).replace(/\\/g, '/');
        const recordFolderFullPath = path.join(storageRoot, recordsDir, folderName);
        fs.mkdirSync(recordFolderFullPath, { recursive: true });

        const storedFileName = 'video.enc';
        const manifestFileName = 'manifest.json';
        const fullVideoPath = path.join(recordFolderFullPath, storedFileName);
        const fullManifestPath = path.join(recordFolderFullPath, manifestFileName);

        let encryptionResult: {
            ivBase64: string;
            authTagBase64: string;
            algorithm: string;
        };

        try {
            encryptionResult = await this.encryptPlainFileToStorage({
                plainPath: params.plainFilePath,
                encryptedPath: fullVideoPath,
            });
        } catch {
            throw new InternalServerErrorException('Не вдалося зашифрувати і зберегти відеофайл');
        }

        const storageRelativePath = path.join(recordFolderRelativePath, storedFileName).replace(/\\/g, '/');
        const manifestRelativePath = path.join(recordFolderRelativePath, manifestFileName).replace(/\\/g, '/');

        const video = this.videoRepository.create({
            appointmentId: params.appointmentId,
            originalFileName: params.originalFileName,
            storedFileName,
            storageRelativePath,
            mimeType: params.mimeType,
            size: params.plainSize,
            startedAt: params.startedAt ? new Date(params.startedAt) : null,
            endedAt: params.endedAt ? new Date(params.endedAt) : null,
            sha256Hash: params.plainSha256Hash,
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

        const { signatureBase64, algorithm } = this.videoSignatureService.signManifest(unsignedManifest);
        const signedManifest = { ...unsignedManifest, signatureAlgorithm: algorithm, manifestSignature: signatureBase64 };

        try {
            fs.writeFileSync(fullManifestPath, JSON.stringify(signedManifest, null, 2), 'utf-8');
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
        savedVideo.tsaRequestRelativePath = path.join(recordFolderRelativePath, tsaResult.tsaRequestRelativeFileName).replace(/\\/g, '/');
        savedVideo.tsaResponseRelativePath = path.join(recordFolderRelativePath, tsaResult.tsaResponseRelativeFileName).replace(/\\/g, '/');
        savedVideo.tsaProvider = tsaResult.tsaProvider;
        savedVideo.tsaHashAlgorithm = tsaResult.tsaHashAlgorithm;

        const finalizedVideo = await this.videoRepository.save(savedVideo);

        const appointment = await this.appointmentRepository.findOne({ where: { id: params.appointmentId } });
        if (appointment) {
            appointment.recordingCompleted = true;
            appointment.recordingCompletedAt = appointment.recordingCompletedAt || new Date();
            await this.appointmentRepository.save(appointment);
        }

        return finalizedVideo;
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

        return this.persistPlainVideoBuffer({
            appointmentId: dto.appointmentId,
            originalFileName: file.originalname,
            mimeType: file.mimetype,
            startedAt: dto.startedAt || null,
            endedAt: dto.endedAt || null,
            plainBuffer: file.buffer,
        });
    }

    async saveAgentUploadedVideo(
        file: Express.Multer.File,
        dto: UploadAgentVideoDto,
        agentToken?: string,
    ): Promise<Video> {
        if (!file) {
            throw new InternalServerErrorException('Файл від агента не отримано');
        }

        const agent = await this.captureAgentService.validateAgentToken(agentToken);
        const appointment = await this.appointmentRepository.findOne({
            where: { id: dto.appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new NotFoundException('Прийом не знайдено');
        }

        if (!agent.cabinetId || appointment.cabinetId !== agent.cabinetId) {
            throw new ForbiddenException('Capture agent не має права завантажувати відео для цього прийому');
        }

        const uploadedPath = (file as Express.Multer.File & { path?: string }).path;
        const plainTempPath = uploadedPath ? `${uploadedPath}.plain` : null;

        if (uploadedPath && plainTempPath) {
            try {
                const decrypted = await this.decryptAgentTransportFileToPlainFile({
                    encryptedPath: uploadedPath,
                    plainPath: plainTempPath,
                    secret: this.getTransportSecret(),
                    ivBase64: dto.transportIv,
                    authTagBase64: dto.transportAuthTag,
                });

                if (decrypted.sha256Hash.toLowerCase() !== String(dto.sha256Hash || '').trim().toLowerCase()) {
                    throw new ForbiddenException('SHA-256 відео не збігається');
                }

                return await this.persistPlainVideoFile({
                    appointmentId: dto.appointmentId,
                    originalFileName: dto.originalFileName || file.originalname || 'agent-recording.webm',
                    mimeType: dto.mimeType || 'video/webm',
                    startedAt: dto.startedAt || null,
                    endedAt: dto.endedAt || null,
                    plainFilePath: plainTempPath,
                    plainSha256Hash: decrypted.sha256Hash,
                    plainSize: decrypted.size,
                });
            } catch (error) {
                if (error instanceof ForbiddenException) {
                    throw error;
                }

                throw new ForbiddenException('Не вдалося розшифрувати відео від capture agent. Перепідключіть агент, щоб оновити transportKey.');
            } finally {
                this.safeUnlink(uploadedPath);
                this.safeUnlink(plainTempPath);
            }
        }

        let plainBuffer: Buffer;
        try {
            plainBuffer = decryptAgentTransportPayload({
                encryptedBuffer: file.buffer,
                secret: this.getTransportSecret(),
                ivBase64: dto.transportIv,
                authTagBase64: dto.transportAuthTag,
            });
        } catch {
            throw new ForbiddenException('Не вдалося розшифрувати відео від capture agent. Перепідключіть агент, щоб оновити transportKey.');
        }

        const computedHash = createHash('sha256').update(plainBuffer).digest('hex');
        if (computedHash.toLowerCase() !== String(dto.sha256Hash || '').trim().toLowerCase()) {
            throw new ForbiddenException('SHA-256 відео не збігається');
        }

        return this.persistPlainVideoBuffer({
            appointmentId: dto.appointmentId,
            originalFileName: dto.originalFileName || file.originalname || 'agent-recording.webm',
            mimeType: dto.mimeType || 'video/webm',
            startedAt: dto.startedAt || null,
            endedAt: dto.endedAt || null,
            plainBuffer,
        });
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
            const doctor = await this.resolveDoctorEntityByAnyId(actor.id);
            const doctorRefs = [actor.id, doctor?.id].filter(Boolean) as string[];

            const myAppointments = await this.appointmentRepository.find({
                where: doctorRefs.map((doctorId) => ({ doctorId })),
                select: ['id'],
            });

            const sharedGrants = await this.videoAccessGrantRepository.find({
                where: { sharedWithDoctorId: actor.id },
                select: ['appointmentId', 'expiresAt'],
                order: { updatedAt: 'DESC', createdAt: 'DESC' },
            });

            const now = new Date();
            const sharedAppointmentIds = sharedGrants
                .filter((grant) => !grant.expiresAt || new Date(grant.expiresAt).getTime() > now.getTime())
                .map((grant) => grant.appointmentId);

            const ids = [...new Set([...myAppointments.map((a) => a.id), ...sharedAppointmentIds].filter(Boolean))];
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

    async shareAppointmentVideos(
        appointmentId: string,
        actor: JwtUser,
        payload: {
            sharedWithDoctorId: string;
            password: string;
            expiresAt?: string | null;
        },
    ) {
        if (actor.role !== UserRole.DOCTOR) {
            throw new ForbiddenException('Лише лікар може ділитися відео');
        }

        await this.verifyAccountPassword(actor.id, String(payload.password || ''));

        const appointment = await this.appointmentRepository.findOne({
            where: { id: appointmentId },
            relations: ['patient'],
        });

        if (!appointment) {
            throw new NotFoundException('Прийом не знайдено');
        }

        const ownsAppointment = await this.doctorOwnsAppointment(appointment, actor.id);
        if (!ownsAppointment) {
            throw new ForbiddenException('Можна ділитися лише своїми записами');
        }

        const targetDoctor = await this.resolveDoctorEntityByAnyId(payload.sharedWithDoctorId);
        if (!targetDoctor?.user?.id) {
            throw new NotFoundException('Лікаря не знайдено');
        }

        if (targetDoctor.user.id === actor.id || targetDoctor.id === actor.id) {
            throw new ForbiddenException('Неможливо поділитися записом із самим собою');
        }

        const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
        if (payload.expiresAt && Number.isNaN(expiresAt!.getTime())) {
            throw new ForbiddenException('Невірний строк доступу');
        }

        let grant = await this.videoAccessGrantRepository.findOne({
            where: {
                appointmentId,
                sharedWithDoctorId: targetDoctor.user.id,
            },
            order: { updatedAt: 'DESC', createdAt: 'DESC' },
        });

        if (!grant) {
            grant = this.videoAccessGrantRepository.create({
                appointmentId,
                sharedByDoctorId: actor.id,
                sharedWithDoctorId: targetDoctor.user.id,
                expiresAt,
            });
        } else {
            grant.sharedByDoctorId = actor.id;
            grant.expiresAt = expiresAt;
        }

        const savedGrant = await this.videoAccessGrantRepository.save(grant);

        return {
            ok: true,
            message: 'Доступ до відео успішно надано',
            grant: {
                id: savedGrant.id,
                appointmentId: savedGrant.appointmentId,
                sharedWithDoctorId: savedGrant.sharedWithDoctorId,
                expiresAt: savedGrant.expiresAt,
                sharedDoctorName: `${targetDoctor.lastName || ''} ${targetDoctor.firstName || ''}${targetDoctor.middleName ? ` ${targetDoctor.middleName}` : ''}`.replace(/\s+/g, ' ').trim(),
            },
        };
    }
}
