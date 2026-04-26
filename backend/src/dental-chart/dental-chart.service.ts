import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, extname, join, normalize, sep } from 'path';
import { In, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { Appointment } from '../appointment/entities/appointment.entity';
import { CaptureAgentService } from '../capture-agent/capture-agent.service';
import { UserRole } from '../common/enums/user-role.enum';
import { Doctor } from '../doctor/entities/doctor.entity';
import { Patient } from '../patient/entities/patient.entity';
import { UserService } from '../user/user.service';
import { VideoEncryptionService } from '../video/video-encryption.service';
import { decryptAgentTransportPayload } from '../video/video-transport-crypto';
import { CreateDentalSnapshotDto } from './dto/create-dental-snapshot.dto';
import { UpdateDentalSnapshotDto } from './dto/update-dental-snapshot.dto';
import {
  DentalSnapshot,
  DentalSnapshotJaw,
  DentalSnapshotTargetType,
} from './entities/dental-snapshot.entity';

export const DENTAL_PERMANENT_TEETH = [
  18, 17, 16, 15, 14, 13, 12, 11,
  21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41,
  31, 32, 33, 34, 35, 36, 37, 38,
];

export type DentalChartActor = {
  id: string;
  role: UserRole | string;
  patientId?: string | null;
};

type AgentSnapshotBody = {
  appointmentId?: string;
  cabinetDeviceId?: string;
  pairKey?: string;
  capturedAt?: string;
  mimeType?: string;
  originalFileName?: string;
  sha256Hash?: string;
  transportIv?: string;
  transportAuthTag?: string;
};

type SnapshotFile = Express.Multer.File;

@Injectable()
export class DentalChartService {
  constructor(
    @InjectRepository(DentalSnapshot)
    private readonly snapshotRepository: Repository<DentalSnapshot>,
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(Patient)
    private readonly patientRepository: Repository<Patient>,
    @InjectRepository(Doctor)
    private readonly doctorRepository: Repository<Doctor>,
    private readonly configService: ConfigService,
    private readonly captureAgentService: CaptureAgentService,
    private readonly videoEncryptionService: VideoEncryptionService,
    private readonly userService: UserService,
  ) {}

  async getMyChart(actor: DentalChartActor) {
    if (!actor.patientId) {
      throw new ForbiddenException('Dental chart is available only for a patient profile.');
    }

    const patient = await this.patientRepository.findOne({ where: { id: actor.patientId } });
    if (!patient) {
      throw new NotFoundException('Patient was not found.');
    }

    const snapshots = await this.snapshotRepository.find({
      where: { patientId: patient.id },
      order: { capturedAt: 'DESC', createdAt: 'DESC' },
    });

    return this.buildChartResponse(patient, snapshots);
  }

  async getAppointmentChart(appointmentId: string, actor: DentalChartActor) {
    const appointment = await this.assertAppointmentAccess(appointmentId, actor);
    return this.getChartForAppointmentEntity(appointment);
  }

  async getAppointmentChartWithPassword(appointmentId: string, actor: DentalChartActor, password: string) {
    const role = String(actor.role || '').toUpperCase();
    if (role === UserRole.DOCTOR || this.isAdmin(actor)) {
      await this.verifyActorPassword(actor.id, password);
    }

    const appointment = await this.assertAppointmentAccess(appointmentId, actor);
    return this.getChartForAppointmentEntity(appointment);
  }

  private async getChartForAppointmentEntity(appointment: Appointment) {
    if (!appointment.patient?.id) {
      throw new BadRequestException('Appointment has no patient attached.');
    }

    const patient = appointment.patient;

    const snapshots = await this.snapshotRepository.find({
      where: { patientId: patient.id },
      order: { capturedAt: 'DESC', createdAt: 'DESC' },
    });

    return this.buildChartResponse(patient, snapshots, appointment.id);
  }

  async saveAgentSnapshot(file: SnapshotFile | undefined, body: AgentSnapshotBody, agentToken?: string) {
    if (!agentToken) {
      throw new UnauthorizedException('Agent token is missing.');
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('Snapshot image is missing.');
    }

    if (!body.appointmentId) {
      throw new BadRequestException('appointmentId is required for dental snapshot upload.');
    }

    const agent = await this.captureAgentService.validateAgentToken(agentToken);
    if (!agent) {
      throw new UnauthorizedException('Invalid capture agent token.');
    }

    const appointment = await this.appointmentRepository.findOne({
      where: { id: body.appointmentId },
      relations: ['patient'],
    });

    if (!appointment) {
      throw new NotFoundException('Appointment was not found.');
    }

    if (!appointment.patient?.id) {
      throw new BadRequestException('Appointment has no patient attached.');
    }

    this.assertAppointmentNotLocked(appointment);

    if (appointment.cabinetId && appointment.cabinetId !== agent.cabinetId) {
      throw new ForbiddenException('Capture agent is not linked to the appointment cabinet.');
    }

    const plainBuffer = this.decodeAgentSnapshotBuffer(file.buffer, body);
    const expectedHash = String(body.sha256Hash || '').trim().toLowerCase();
    const hash = createHash('sha256').update(plainBuffer).digest('hex');
    if (expectedHash && expectedHash !== hash.toLowerCase()) {
      throw new ForbiddenException('SHA-256 знімка не збігається.');
    }

    const mimeType = this.normalizeSnapshotMimeType(body.mimeType || file.mimetype);
    const extension = this.extensionForMimeType(mimeType, body.originalFileName || file.originalname);
    const encrypted = this.videoEncryptionService.encryptBuffer(plainBuffer);
    const now = new Date();
    const capturedAt = this.parseDate(body.capturedAt) || now;
    const folderName = `${now.toISOString().slice(0, 10)}_${randomUUID()}`;
    const storedFileName = `snapshot.${extension}.enc`;
    const relativePath = join('dental-snapshots', folderName, storedFileName);
    const fullPath = this.resolveStoragePath(relativePath);

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, encrypted.encryptedBuffer);

    const snapshot = this.snapshotRepository.create({
      patientId: appointment.patient.id,
      appointmentId: appointment.id,
      doctorId: appointment.doctorId || null,
      cabinetId: appointment.cabinetId || agent.cabinetId || null,
      cabinetDeviceId: body.cabinetDeviceId || null,
      pairKey: body.pairKey || null,
      targetType: 'MOUTH',
      targetId: 'mouth',
      toothNumber: null,
      jaw: 'WHOLE',
      title: null,
      description: null,
      originalFileName: body.originalFileName || file.originalname || `snapshot.${extension}`,
      storedFileName,
      storageRelativePath: relativePath,
      mimeType,
      size: plainBuffer.length,
      sha256Hash: hash,
      encryptionAlgorithm: encrypted.algorithm,
      encryptionIv: encrypted.ivBase64,
      encryptionAuthTag: encrypted.authTagBase64,
      source: 'CAPTURE_AGENT',
      capturedAt,
    });

    const saved = await this.snapshotRepository.save(snapshot);
    return { ok: true, snapshot: await this.toSnapshotDto(saved) };
  }

  async createSnapshotForAppointment(
    appointmentId: string,
    actor: DentalChartActor,
    dto: CreateDentalSnapshotDto,
    file?: SnapshotFile,
  ) {
    const appointment = await this.assertAppointmentAccess(appointmentId, actor);

    if (!appointment.patient?.id) {
      throw new BadRequestException('Appointment has no patient attached.');
    }

    this.assertAppointmentNotLocked(appointment);

    const targetPatch = this.normalizeTargetPatch(dto);
    const title = this.cleanOptionalText(dto.title, 255);
    const description = this.cleanOptionalText(dto.description, 4000);

    if (!file?.buffer?.length && !title && !description) {
      throw new BadRequestException('Додайте фото або хоча б підпис/примітку.');
    }

    let originalFileName: string | null = null;
    let storedFileName: string | null = null;
    let storageRelativePath: string | null = null;
    let mimeType: string | null = null;
    let size = 0;
    let sha256Hash: string | null = null;
    let encryptionAlgorithm: string | null = null;
    let encryptionIv: string | null = null;
    let encryptionAuthTag: string | null = null;
    let source: 'MANUAL_UPLOAD' | 'NOTE_ONLY' = 'NOTE_ONLY';

    if (file?.buffer?.length) {
      const normalizedMimeType = this.normalizeSnapshotMimeType(file.mimetype);
      const extension = this.extensionForMimeType(normalizedMimeType, file.originalname);
      const encrypted = this.videoEncryptionService.encryptBuffer(file.buffer);
      const now = new Date();
      const folderName = `${now.toISOString().slice(0, 10)}_${randomUUID()}`;
      storedFileName = `snapshot.${extension}.enc`;
      storageRelativePath = join('dental-snapshots', folderName, storedFileName);
      const fullPath = this.resolveStoragePath(storageRelativePath);

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, encrypted.encryptedBuffer);

      originalFileName = file.originalname || `snapshot.${extension}`;
      mimeType = normalizedMimeType;
      size = file.buffer.length;
      sha256Hash = createHash('sha256').update(file.buffer).digest('hex');
      encryptionAlgorithm = encrypted.algorithm;
      encryptionIv = encrypted.ivBase64;
      encryptionAuthTag = encrypted.authTagBase64;
      source = 'MANUAL_UPLOAD';
    }

    const snapshot = this.snapshotRepository.create({
      patientId: appointment.patient.id,
      appointmentId: appointment.id,
      doctorId: appointment.doctorId || null,
      cabinetId: appointment.cabinetId || null,
      cabinetDeviceId: null,
      pairKey: null,
      targetType: targetPatch.targetType,
      targetId: targetPatch.targetId,
      toothNumber: targetPatch.toothNumber,
      jaw: targetPatch.jaw,
      title,
      description,
      originalFileName,
      storedFileName,
      storageRelativePath,
      mimeType,
      size,
      sha256Hash,
      encryptionAlgorithm,
      encryptionIv,
      encryptionAuthTag,
      source,
      capturedAt: this.parseDate(dto.capturedAt || undefined) || new Date(),
    });

    const saved = await this.snapshotRepository.save(snapshot);
    return { ok: true, snapshot: await this.toSnapshotDto(saved) };
  }

  async updateSnapshot(snapshotId: string, actor: DentalChartActor, dto: UpdateDentalSnapshotDto) {
    const snapshot = await this.snapshotRepository.findOne({ where: { id: snapshotId } });
    if (!snapshot) {
      throw new NotFoundException('Dental snapshot was not found.');
    }

    await this.assertSnapshotAccess(snapshot, actor);
    const appointment = await this.assertMutableSnapshotAppointment(snapshot, actor, dto.currentAppointmentId || null);
    this.assertAppointmentNotLocked(appointment);

    const targetPatch = this.normalizeTargetPatch(dto);
    snapshot.targetType = targetPatch.targetType;
    snapshot.targetId = targetPatch.targetId;
    snapshot.toothNumber = targetPatch.toothNumber;
    snapshot.jaw = targetPatch.jaw;

    if ('title' in dto) {
      snapshot.title = this.cleanOptionalText(dto.title, 255);
    }

    if ('description' in dto) {
      snapshot.description = this.cleanOptionalText(dto.description, 4000);
    }

    const saved = await this.snapshotRepository.save(snapshot);
    return { ok: true, snapshot: await this.toSnapshotDto(saved) };
  }

  async deleteSnapshot(snapshotId: string, actor: DentalChartActor, currentAppointmentId?: string | null) {
    const snapshot = await this.snapshotRepository.findOne({ where: { id: snapshotId } });
    if (!snapshot) {
      throw new NotFoundException('Dental snapshot was not found.');
    }

    await this.assertSnapshotAccess(snapshot, actor);
    const appointment = await this.assertMutableSnapshotAppointment(snapshot, actor, currentAppointmentId || null);
    this.assertAppointmentNotLocked(appointment);

    if (snapshot.storageRelativePath) {
      try {
        await unlink(this.resolveStoragePath(snapshot.storageRelativePath));
      } catch {
        // ignore stale local file
      }
    }

    await this.snapshotRepository.remove(snapshot);
    return { ok: true };
  }

  async getSnapshotFile(snapshotId: string, actor: DentalChartActor) {
    const snapshot = await this.snapshotRepository.findOne({ where: { id: snapshotId } });
    if (!snapshot) {
      throw new NotFoundException('Dental snapshot was not found.');
    }

    await this.assertSnapshotAccess(snapshot, actor);

    if (!snapshot.storageRelativePath || !snapshot.mimeType) {
      throw new BadRequestException('Для цього запису немає прикріпленого зображення.');
    }

    if (snapshot.encryptionIv && snapshot.encryptionAuthTag) {
      const encryptedBuffer = await readFile(this.resolveStoragePath(snapshot.storageRelativePath));
      const plainBuffer = this.videoEncryptionService.decryptBuffer({
        encryptedBuffer,
        ivBase64: snapshot.encryptionIv,
        authTagBase64: snapshot.encryptionAuthTag,
      });

      return {
        stream: Readable.from([plainBuffer]),
        mimeType: snapshot.mimeType,
        fileName: snapshot.originalFileName || (snapshot.storedFileName || 'dental-snapshot').replace(/\.enc$/, ''),
      };
    }

    return {
      stream: createReadStream(this.resolveStoragePath(snapshot.storageRelativePath)),
      mimeType: snapshot.mimeType,
      fileName: snapshot.originalFileName || snapshot.storedFileName || 'dental-snapshot',
    };
  }

  private async assertAppointmentAccess(appointmentId: string, actor: DentalChartActor) {
    const appointment = await this.appointmentRepository.findOne({
      where: { id: appointmentId },
      relations: ['patient'],
    });

    if (!appointment) {
      throw new NotFoundException('Appointment was not found.');
    }

    if (this.isAdmin(actor)) {
      return appointment;
    }

    if (actor.role === UserRole.PATIENT && actor.patientId && appointment.patient?.id === actor.patientId) {
      return appointment;
    }

    if (actor.role === UserRole.DOCTOR) {
      const doctor = await this.resolveDoctorForActor(actor.id);
      if (doctor && appointment.doctorId === doctor.id) {
        return appointment;
      }
    }

    throw new ForbiddenException('You do not have access to this dental chart.');
  }

  private async assertSnapshotAccess(snapshot: DentalSnapshot, actor: DentalChartActor) {
    if (this.isAdmin(actor)) {
      return;
    }

    if (actor.role === UserRole.PATIENT && actor.patientId === snapshot.patientId) {
      return;
    }

    if (snapshot.appointmentId) {
      await this.assertAppointmentAccess(snapshot.appointmentId, actor);
      return;
    }

    if (actor.role === UserRole.DOCTOR) {
      const doctor = await this.resolveDoctorForActor(actor.id);
      if (doctor && snapshot.doctorId === doctor.id) {
        return;
      }
    }

    throw new ForbiddenException('You do not have access to this dental snapshot.');
  }

  private async assertMutableSnapshotAppointment(snapshot: DentalSnapshot, actor: DentalChartActor, currentAppointmentId?: string | null) {
    if (!snapshot.appointmentId) {
      throw new BadRequestException('Цей запис не привʼязаний до прийому і не може редагуватися з цієї сторінки.');
    }

    if (currentAppointmentId && snapshot.appointmentId !== currentAppointmentId) {
      throw new BadRequestException('Можна змінювати тільки записи, зроблені під час поточного прийому.');
    }

    return this.assertAppointmentAccess(snapshot.appointmentId, actor);
  }

  private assertAppointmentNotLocked(appointment: Appointment) {
    const status = String(appointment.status || '').toUpperCase();
    const visitStatus = String(appointment.visitFlowStatus || '').toUpperCase();

    if (status === 'COMPLETED' || visitStatus === 'COMPLETED') {
      throw new BadRequestException('Після завершення прийому редагування зубної карти заборонено.');
    }
  }

  private async buildChartResponse(patient: Patient, snapshots: DentalSnapshot[], activeAppointmentId?: string) {
    const snapshotDtos = await this.toSnapshotDtos(snapshots);

    const teeth = DENTAL_PERMANENT_TEETH.map((number) => {
      const toothSnapshots = snapshotDtos.filter(
        (snapshot) => snapshot.targetType === 'TOOTH' && snapshot.toothNumber === number,
      );

      return {
        number,
        targetId: `tooth-${number}`,
        jaw: number >= 30 ? 'LOWER' : 'UPPER',
        snapshotCount: toothSnapshots.length,
        snapshots: toothSnapshots,
      };
    });

    return {
      ok: true,
      patient: {
        id: patient.id,
        firstName: patient.firstName || null,
        lastName: patient.lastName || null,
        phone: patient.phone || null,
        email: patient.email || null,
      },
      activeAppointmentId: activeAppointmentId || null,
      teeth,
      mouthHistory: snapshotDtos.filter((snapshot) => snapshot.targetType === 'MOUTH'),
      upperJawHistory: snapshotDtos.filter(
        (snapshot) => snapshot.targetType === 'JAW' && snapshot.jaw === 'UPPER',
      ),
      lowerJawHistory: snapshotDtos.filter(
        (snapshot) => snapshot.targetType === 'JAW' && snapshot.jaw === 'LOWER',
      ),
      snapshots: snapshotDtos,
    };
  }

  private async toSnapshotDtos(snapshots: DentalSnapshot[]) {
    const doctorMap = await this.buildDoctorNameMap(snapshots);
    return snapshots.map((snapshot) => this.toSnapshotDtoSync(snapshot, doctorMap));
  }

  private async toSnapshotDto(snapshot: DentalSnapshot) {
    const doctorMap = await this.buildDoctorNameMap([snapshot]);
    return this.toSnapshotDtoSync(snapshot, doctorMap);
  }

  private toSnapshotDtoSync(snapshot: DentalSnapshot, doctorMap: Map<string, string>) {
    return {
      id: snapshot.id,
      appointmentId: snapshot.appointmentId,
      patientId: snapshot.patientId,
      doctorId: snapshot.doctorId,
      doctorName: snapshot.doctorId ? doctorMap.get(snapshot.doctorId) || null : null,
      cabinetId: snapshot.cabinetId,
      cabinetDeviceId: snapshot.cabinetDeviceId,
      pairKey: snapshot.pairKey,
      targetType: snapshot.targetType,
      targetId: snapshot.targetId,
      toothNumber: snapshot.toothNumber,
      jaw: snapshot.jaw,
      title: snapshot.title,
      description: snapshot.description,
      mimeType: snapshot.mimeType,
      hasFile: Boolean(snapshot.storageRelativePath && snapshot.mimeType),
      size: Number(snapshot.size || 0),
      source: snapshot.source,
      capturedAt: snapshot.capturedAt?.toISOString() || null,
      createdAt: snapshot.createdAt?.toISOString() || null,
      updatedAt: snapshot.updatedAt?.toISOString() || null,
    };
  }

  private async buildDoctorNameMap(snapshots: DentalSnapshot[]) {
    const refs = Array.from(
      new Set(snapshots.map((snapshot) => snapshot.doctorId).filter((id): id is string => Boolean(id))),
    );

    const map = new Map<string, string>();
    if (!refs.length) {
      return map;
    }

    const doctors = await this.doctorRepository.find({
      where: [{ id: In(refs) }, { user: { id: In(refs) } }],
      relations: ['user'],
    });

    doctors.forEach((doctor) => {
      const name = this.formatDoctorName(doctor);
      map.set(doctor.id, name);
      if (doctor.user?.id) {
        map.set(doctor.user.id, name);
      }
    });

    return map;
  }

  private async resolveDoctorForActor(userId: string) {
    return this.doctorRepository.findOne({
      where: [{ id: userId }, { user: { id: userId } }],
      relations: ['user'],
    });
  }

  private normalizeTargetPatch(dto: { targetType?: DentalSnapshotTargetType; toothNumber?: number | null; jaw?: DentalSnapshotJaw | null }) {
    const targetType = dto.targetType || 'MOUTH';

    if (targetType === 'TOOTH') {
      const toothNumber = Number(dto.toothNumber);
      if (!DENTAL_PERMANENT_TEETH.includes(toothNumber)) {
        throw new BadRequestException('Invalid tooth number for permanent 32-tooth chart.');
      }

      return {
        targetType,
        targetId: `tooth-${toothNumber}`,
        toothNumber,
        jaw: null as DentalSnapshotJaw | null,
      };
    }

    if (targetType === 'JAW') {
      const jaw = dto.jaw === 'LOWER' ? 'LOWER' : 'UPPER';
      return {
        targetType,
        targetId: jaw === 'UPPER' ? 'upper-jaw' : 'lower-jaw',
        toothNumber: null,
        jaw: jaw as DentalSnapshotJaw,
      };
    }

    return {
      targetType: 'MOUTH' as DentalSnapshotTargetType,
      targetId: 'mouth',
      toothNumber: null,
      jaw: 'WHOLE' as DentalSnapshotJaw,
    };
  }

  private decodeAgentSnapshotBuffer(buffer: Buffer, body: AgentSnapshotBody): Buffer {
    const transportIv = String(body.transportIv || '').trim();
    const transportAuthTag = String(body.transportAuthTag || '').trim();

    if (!transportIv || !transportAuthTag) {
      return buffer;
    }

    try {
      return decryptAgentTransportPayload({
        encryptedBuffer: buffer,
        secret: this.getTransportSecret(),
        ivBase64: transportIv,
        authTagBase64: transportAuthTag,
      });
    } catch {
      throw new ForbiddenException('Не вдалося розшифрувати знімок від capture agent. Перепідключіть агент, щоб оновити transportKey.');
    }
  }

  private getTransportSecret() {
    return (
      this.configService.get<string>('CAPTURE_AGENT_TRANSPORT_KEY') ||
      this.configService.get<string>('CAPTURE_AGENT_ENROLLMENT_TOKEN') ||
      'oradent-capture-transport'
    );
  }

  private normalizeSnapshotMimeType(mimeType?: string | null) {
    if (mimeType === 'image/png') {
      return 'image/png';
    }

    if (mimeType === 'image/webp') {
      return 'image/webp';
    }

    return 'image/jpeg';
  }

  private extensionForMimeType(mimeType: string, originalName?: string | null) {
    const extension = extname(originalName || '').replace('.', '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
      return extension === 'jpeg' ? 'jpg' : extension;
    }

    if (mimeType === 'image/png') {
      return 'png';
    }

    if (mimeType === 'image/webp') {
      return 'webp';
    }

    return 'jpg';
  }

  private parseDate(value?: string) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private cleanOptionalText(value: unknown, maxLength: number) {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.slice(0, maxLength);
  }

  private async verifyActorPassword(userId: string, password: string) {
    const normalizedPassword = String(password || '');
    if (!normalizedPassword.trim()) {
      throw new ForbiddenException('Вкажіть пароль від акаунта');
    }

    const user = await this.userService.findById(userId);
    if (!user?.passwordHash) {
      throw new ForbiddenException('Для цього акаунта пароль не встановлено');
    }

    const isValid = await argon2.verify(user.passwordHash, normalizedPassword);
    if (!isValid) {
      throw new ForbiddenException('Невірний пароль');
    }
  }

  private isAdmin(actor: DentalChartActor) {
    return actor.role === UserRole.ADMIN || actor.role === UserRole.SUPER_ADMIN;
  }

  private formatDoctorName(doctor: Doctor) {
    const doctorName = [doctor.firstName, doctor.lastName].filter(Boolean).join(' ').trim();
    if (doctorName) {
      return doctorName;
    }

    if (doctor.user?.email) {
      return doctor.user.email;
    }

    return `Doctor ${doctor.id}`;
  }

  private resolveStoragePath(relativePath: string) {
    const storageRoot =
      this.configService.get<string>('DENTAL_SNAPSHOT_STORAGE_ROOT') ||
      this.configService.get<string>('VIDEO_STORAGE_ROOT') ||
      join(process.cwd(), 'storage');

    const safeRelative = normalize(relativePath).replace(/^([.][.][\\/])+/, '');
    const fullPath = join(storageRoot, safeRelative);
    const rootWithSep = storageRoot.endsWith(sep) ? storageRoot : `${storageRoot}${sep}`;

    if (!fullPath.startsWith(rootWithSep)) {
      throw new BadRequestException('Invalid dental snapshot path.');
    }

    return fullPath;
  }
}
