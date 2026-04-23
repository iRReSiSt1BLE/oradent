import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { AdminService } from '../admin/admin.service';
import { CaptureAgent } from '../capture-agent/entities/capture-agent.entity';
import { CaptureAgentRealtimeService } from '../capture-agent/capture-agent-realtime.service';
import { CaptureDevicePair } from '../capture-agent/entities/capture-device-pair.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { Doctor } from '../doctor/entities/doctor.entity';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';
import { UserService } from '../user/user.service';
import { CreateCabinetSetupDto } from './dto/create-cabinet-setup.dto';
import { CreateCabinetDto } from './dto/create-cabinet.dto';
import { UpdateCabinetDto } from './dto/update-cabinet.dto';
import { RequestCabinetPreviewDto } from './dto/request-cabinet-preview.dto';
import {
  CabinetDevice,
  CabinetDeviceStartMode,
} from './entities/cabinet-device.entity';
import { CabinetDoctor } from './entities/cabinet-doctor.entity';
import { CabinetSetupSession } from './entities/cabinet-setup-session.entity';
import { Cabinet } from './entities/cabinet.entity';

@Injectable()
export class CabinetService {
  constructor(
    @InjectRepository(Cabinet)
    private readonly cabinetRepository: Repository<Cabinet>,
    @InjectRepository(CabinetDevice)
    private readonly cabinetDeviceRepository: Repository<CabinetDevice>,
    @InjectRepository(CabinetDoctor)
    private readonly cabinetDoctorRepository: Repository<CabinetDoctor>,
    @InjectRepository(Doctor)
    private readonly doctorRepository: Repository<Doctor>,
    @InjectRepository(ClinicServiceEntity)
    private readonly clinicServiceRepository: Repository<ClinicServiceEntity>,
    @InjectRepository(CaptureAgent)
    private readonly captureAgentRepository: Repository<CaptureAgent>,
    @InjectRepository(CaptureDevicePair)
    private readonly captureDevicePairRepository: Repository<CaptureDevicePair>,
    @InjectRepository(CabinetSetupSession)
    private readonly cabinetSetupSessionRepository: Repository<CabinetSetupSession>,
    private readonly userService: UserService,
    private readonly adminService: AdminService,
    private readonly captureAgentRealtimeService: CaptureAgentRealtimeService,
  ) {}

  private normalizeName(value: string): string {
    return String(value || '').trim();
  }

  private normalizeDescription(value?: string): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private normalizeAgentKey(value?: string): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private async ensureManagerAccess(currentUserId: string) {
    const user = await this.userService.findById(currentUserId);
    if (!user) {
      throw new ForbiddenException('Користувача не знайдено');
    }

    if (![UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(user.role)) {
      throw new ForbiddenException('Недостатньо прав доступу');
    }

    const admin = await this.adminService.findByUserId(currentUserId);
    if (!admin || !admin.isActive) {
      throw new ForbiddenException('Адміністратора деактивовано');
    }
  }

  private async ensureCabinetNameUnique(name: string, exceptId?: string) {
    const qb = this.cabinetRepository
      .createQueryBuilder('cabinet')
      .where('LOWER(cabinet.name) = LOWER(:name)', { name });

    if (exceptId) {
      qb.andWhere('cabinet.id != :exceptId', { exceptId });
    }

    const existing = await qb.getOne();
    if (existing) {
      throw new BadRequestException('Кабінет з такою назвою вже існує');
    }
  }

  private async ensureAgentKeyExists(agentKey: string | null) {
    if (!agentKey) {
      return null;
    }

    const agent = await this.captureAgentRepository.findOne({
      where: { agentKey },
      relations: { pairs: true, devices: true, cabinet: true },
    });

    if (!agent) {
      throw new BadRequestException('Agent key не знайдено');
    }

    return agent;
  }

  private async generateConnectionCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = `CAB-${randomBytes(3).toString('hex').toUpperCase()}`;
      const [cabinetExists, setupExists] = await Promise.all([
        this.cabinetRepository.findOne({
          where: { connectionCode: code },
          select: ['id'],
        }),
        this.cabinetSetupSessionRepository.findOne({
          where: { connectionCode: code },
          select: ['id'],
        }),
      ]);
      if (!cabinetExists && !setupExists) {
        return code;
      }
    }

    throw new BadRequestException('Не вдалося згенерувати унікальний код кабінету');
  }

  private async resolveServices(serviceIds?: string[]) {
    const uniqueIds = [...new Set((serviceIds || []).map((item) => item.trim()).filter(Boolean))];
    if (!uniqueIds.length) {
      return [];
    }

    const services = await this.clinicServiceRepository.find({
      where: { id: In(uniqueIds), isActive: true },
      relations: ['category', 'specialties'],
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    if (services.length !== uniqueIds.length) {
      const foundIds = new Set(services.map((item) => item.id));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Не знайдено послуг: ${missing.join(', ')}`);
    }

    return services;
  }

  private async resolveDoctors(doctorIds?: string[]) {
    const normalizedDoctorIds = [...new Set((doctorIds || []).map((item) => item.trim()).filter(Boolean))];
    if (!normalizedDoctorIds.length) {
      return [] as Doctor[];
    }

    const doctors = await this.doctorRepository.find({
      where: { id: In(normalizedDoctorIds), isActive: true },
      relations: ['user'],
      order: { lastName: 'ASC', firstName: 'ASC' },
    });

    if (doctors.length !== normalizedDoctorIds.length) {
      const foundIds = new Set(doctors.map((item) => item.id));
      const missing = normalizedDoctorIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Не знайдено лікарів: ${missing.join(', ')}`);
    }

    return doctors;
  }

  private normalizeDevices(
    devices?: Array<{
      name: string;
      cameraDeviceId?: string;
      cameraLabel?: string | null;
      microphoneDeviceId?: string | null;
      microphoneLabel?: string | null;
      startMode: CabinetDeviceStartMode;
      isActive?: boolean;
    }>,
  ) {
    return (devices || [])
      .map((device, index) => ({
        name: this.normalizeName(device.name),
        cameraDeviceId: (device.cameraDeviceId || '').trim() || null,
        cameraLabel: device.cameraLabel?.trim() || null,
        microphoneDeviceId: device.microphoneDeviceId?.trim() || null,
        microphoneLabel: device.microphoneLabel?.trim() || null,
        startMode: device.startMode,
        isActive: device.isActive !== false,
        sortOrder: index,
      }))
      .filter(
        (device) =>
          device.name.length > 0 &&
          (device.cameraDeviceId || device.microphoneDeviceId),
      );
  }

  private async getCabinetOrThrow(cabinetId: string) {
    const cabinet = await this.cabinetRepository.findOne({
      where: { id: cabinetId },
      relations: [
        'services',
        'services.category',
        'services.specialties',
        'devices',
        'doctorAssignments',
        'doctorAssignments.doctor',
        'doctorAssignments.doctor.user',
      ],
    });

    if (!cabinet) {
      throw new BadRequestException('Кабінет не знайдено');
    }

    return cabinet;
  }

  private async getSetupSessionOrThrow(setupSessionId: string) {
    const setupSession = await this.cabinetSetupSessionRepository.findOne({
      where: { id: setupSessionId },
    });

    if (!setupSession) {
      throw new BadRequestException('Сесію підключення кабінету не знайдено');
    }

    if (setupSession.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Сесія підключення кабінету протермінована');
    }

    return setupSession;
  }

  private ensureSetupSessionAccess(
    setupSession: CabinetSetupSession,
    currentUserId: string,
  ) {
    if (setupSession.createdByUserId !== currentUserId) {
      throw new ForbiddenException('Немає доступу до цієї setup-сесії кабінету');
    }
  }

  private getPairIdentity(
    pair: Pick<CaptureDevicePair, 'videoDeviceId' | 'audioDeviceId'>,
  ) {
    return `${pair.videoDeviceId}::${pair.audioDeviceId}`;
  }

  private async validateSelectedDevicesForAgent(
    devicesInput: Array<{
      name: string;
      cameraDeviceId: string | null;
      microphoneDeviceId: string | null;
    }>,
    linkedAgent: CaptureAgent | null,
  ) {
    if (!devicesInput.length) {
      return;
    }

    if (!linkedAgent) {
      throw new BadRequestException(
        'Не можна зберегти пари запису без підключеного capture agent.',
      );
    }

    const availablePairs = new Set(
      (linkedAgent.pairs || [])
        .filter((pair) => pair.isAvailable)
        .map((pair) => this.getPairIdentity(pair)),
    );

    for (const device of devicesInput) {
      if (!device.cameraDeviceId || !device.microphoneDeviceId) {
        throw new BadRequestException(
          'Кожне джерело запису має містити і камеру, і мікрофон від агента.',
        );
      }

      const identity = `${device.cameraDeviceId}::${device.microphoneDeviceId}`;
      if (!availablePairs.has(identity)) {
        throw new BadRequestException(
          `Пара ${device.name} відсутня у списку пар, які надіслав агент.`,
        );
      }
    }
  }

  private mapService(service: ClinicServiceEntity, doctorIds: string[] = []) {
    return {
      id: service.id,
      name: service.name,
      isActive: service.isActive,
      categoryId: service.categoryId,
      durationMinutes: Number(service.durationMinutes || 0),
      priceUah: Number(service.priceUah || 0),
      specialtyIds: Array.isArray(service.specialties)
        ? service.specialties.map((item) => item.id)
        : [],
      specialties: Array.isArray(service.specialties)
        ? service.specialties.map((item) => ({
            id: item.id,
            name: item.name,
            order: item.order,
            isActive: item.isActive,
          }))
        : [],
      doctorIds,
    };
  }

  private mapDoctor(doctor: Doctor) {
    return {
      id: doctor.id,
      userId: doctor.user?.id || null,
      lastName: doctor.lastName,
      firstName: doctor.firstName,
      middleName: doctor.middleName,
      specialty: doctor.specialty,
      specialties: Array.isArray(doctor.specialties) ? doctor.specialties : [],
      isActive: doctor.isActive,
    };
  }

  private doctorMatchesServiceBySpecialty(
    doctor: Doctor,
    service: ClinicServiceEntity,
  ): boolean {
    const doctorSpecialties = Array.isArray(doctor.specialties)
      ? doctor.specialties
          .map((value) => String(value).trim().toLowerCase())
          .filter(Boolean)
      : [];

    const serviceSpecialties = Array.isArray(service.specialties)
      ? service.specialties
          .map((specialty) => String(specialty.name).trim().toLowerCase())
          .filter(Boolean)
      : [];

    if (!serviceSpecialties.length) {
      return true;
    }

    return serviceSpecialties.some((name) => doctorSpecialties.includes(name));
  }

  private mapLinkedAgent(agent: CaptureAgent | null) {
    if (!agent) {
      return null;
    }

    const pairs = [...(agent.pairs || [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );

    return {
      id: agent.id,
      agentKey: agent.agentKey,
      name: agent.name,
      status: agent.status,
      lastSeenAt: agent.lastSeenAt,
      wsConnectedAt: agent.wsConnectedAt,
      appVersion: agent.appVersion,
      pairs: pairs.map((pair) => ({
        id: pair.id,
        pairKey: pair.pairKey,
        displayName: pair.displayName,
        videoDeviceId: pair.videoDeviceId,
        videoLabel: pair.videoLabel,
        audioDeviceId: pair.audioDeviceId,
        audioLabel: pair.audioLabel,
        isAvailable: pair.isAvailable,
        sortOrder: pair.sortOrder,
      })),
    };
  }

  private async getLinkedAgentByAgentKey(agentKey?: string | null) {
    const normalizedAgentKey = this.normalizeAgentKey(agentKey || undefined);
    if (!normalizedAgentKey) {
      return null;
    }

    return this.captureAgentRepository.findOne({
      where: { agentKey: normalizedAgentKey },
      relations: { pairs: true, devices: true, cabinet: true },
    });
  }

  private pickLinkedAgent(
    cabinet: Cabinet,
    captureAgents: CaptureAgent[],
  ): CaptureAgent | null {
    if (cabinet.agentKey) {
      return (
        captureAgents.find((agent) => agent.agentKey === cabinet.agentKey) || null
      );
    }

    return (
      captureAgents.find((agent) => agent.cabinetId === cabinet.id) || null
    );
  }

  private mapCabinet(cabinet: Cabinet, linkedAgent: CaptureAgent | null) {
    const devices = [...(cabinet.devices || [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    const doctorAssignments = [...(cabinet.doctorAssignments || [])].sort(
      (a, b) =>
        a.doctor.lastName.localeCompare(b.doctor.lastName) ||
        a.doctor.firstName.localeCompare(b.doctor.firstName),
    );
    const services = [...(cabinet.services || [])].sort(
      (a, b) =>
        Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
        a.name.localeCompare(b.name),
    );

    return {
      id: cabinet.id,
      name: cabinet.name,
      description: cabinet.description,
      isActive: cabinet.isActive,
      connectionCode: cabinet.connectionCode,
      agentKey: cabinet.agentKey,
      linkedAgent: this.mapLinkedAgent(linkedAgent),
      serviceIds: services.map((item) => item.id),
      services: services.map((item) => this.mapService(item)),
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        cameraDeviceId: device.cameraDeviceId,
        cameraLabel: device.cameraLabel,
        microphoneDeviceId: device.microphoneDeviceId,
        microphoneLabel: device.microphoneLabel,
        startMode: device.startMode,
        isActive: device.isActive,
        sortOrder: device.sortOrder,
      })),
      doctorIds: doctorAssignments.map((assignment) => assignment.doctorId),
      doctorAssignments: doctorAssignments.map((assignment) => ({
        id: assignment.id,
        doctorId: assignment.doctorId,
        doctor: this.mapDoctor(assignment.doctor),
      })),
      createdAt: cabinet.createdAt,
      updatedAt: cabinet.updatedAt,
    };
  }

  private async mapSetupSession(setupSession: CabinetSetupSession) {
    const linkedAgent = await this.getLinkedAgentByAgentKey(setupSession.agentKey);

    return {
      id: setupSession.id,
      connectionCode: setupSession.connectionCode,
      agentKey: setupSession.agentKey,
      agentName: setupSession.agentName,
      expiresAt: setupSession.expiresAt,
      createdAt: setupSession.createdAt,
      updatedAt: setupSession.updatedAt,
      linkedAgent: this.mapLinkedAgent(linkedAgent),
    };
  }

  private async syncChildren(
    cabinet: Cabinet,
    devicesInput: Array<{
      name: string;
      cameraDeviceId: string | null;
      cameraLabel: string | null;
      microphoneDeviceId: string | null;
      microphoneLabel: string | null;
      startMode: CabinetDeviceStartMode;
      isActive: boolean;
      sortOrder: number;
    }>,
    doctorsInput: Doctor[],
  ) {
    await this.cabinetDeviceRepository.delete({ cabinetId: cabinet.id });
    await this.cabinetDoctorRepository.delete({ cabinetId: cabinet.id });

    if (devicesInput.length) {
      const deviceEntities = devicesInput.map((device) =>
        this.cabinetDeviceRepository.create({
          cabinetId: cabinet.id,
          name: device.name,
          cameraDeviceId: device.cameraDeviceId,
          cameraLabel: device.cameraLabel,
          microphoneDeviceId: device.microphoneDeviceId,
          microphoneLabel: device.microphoneLabel,
          startMode: device.startMode,
          isActive: device.isActive,
          sortOrder: device.sortOrder,
        }),
      );
      await this.cabinetDeviceRepository.save(deviceEntities);
    }

    if (doctorsInput.length) {
      const assignmentEntities = doctorsInput.map((doctor) =>
        this.cabinetDoctorRepository.create({
          cabinetId: cabinet.id,
          doctorId: doctor.id,
        }),
      );
      await this.cabinetDoctorRepository.save(assignmentEntities);
    }
  }

  private async bindAgentToCabinet(agentKey: string | null, cabinet: Cabinet) {
    const normalizedAgentKey = this.normalizeAgentKey(agentKey || undefined);
    if (!normalizedAgentKey) {
      return null;
    }

    const agent = await this.captureAgentRepository.findOne({
      where: { agentKey: normalizedAgentKey },
      relations: { pairs: true, devices: true, cabinet: true },
    });

    if (!agent) {
      return null;
    }

    agent.cabinetId = cabinet.id;
    agent.cabinet = cabinet;
    await this.captureAgentRepository.save(agent);
    return agent;
  }

  async initSetupSession(
    currentUserId: string,
    _dto: CreateCabinetSetupDto,
  ) {
    await this.ensureManagerAccess(currentUserId);

    const connectionCode = await this.generateConnectionCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const setupSession = await this.cabinetSetupSessionRepository.save(
      this.cabinetSetupSessionRepository.create({
        connectionCode,
        agentKey: null,
        agentName: null,
        createdByUserId: currentUserId,
        expiresAt,
      }),
    );

    return {
      setupSession: await this.mapSetupSession(setupSession),
    };
  }

  async getSetupSession(currentUserId: string, setupSessionId: string) {
    await this.ensureManagerAccess(currentUserId);
    const setupSession = await this.getSetupSessionOrThrow(setupSessionId);
    this.ensureSetupSessionAccess(setupSession, currentUserId);

    return {
      setupSession: await this.mapSetupSession(setupSession),
    };
  }


  async requestPreview(currentUserId: string, dto: RequestCabinetPreviewDto) {
    await this.ensureManagerAccess(currentUserId);

    const normalizedPairKey = String(dto.pairKey || '').trim();
    if (!normalizedPairKey) {
      throw new BadRequestException('Не вказано pairKey для preview.');
    }

    let linkedAgent: CaptureAgent | null = null;

    if (dto.setupSessionId) {
      const setupSession = await this.getSetupSessionOrThrow(dto.setupSessionId);
      this.ensureSetupSessionAccess(setupSession, currentUserId);
      linkedAgent = await this.getLinkedAgentByAgentKey(setupSession.agentKey);
    } else if (dto.cabinetId) {
      const cabinet = await this.getCabinetOrThrow(dto.cabinetId);
      linkedAgent = cabinet.agentKey
        ? await this.ensureAgentKeyExists(cabinet.agentKey)
        : cabinet.connectionCode
          ? await this.captureAgentRepository.findOne({
              where: { cabinetId: cabinet.id },
              relations: { pairs: true, devices: true, cabinet: true },
            })
          : null;
    } else {
      throw new BadRequestException('Потрібно передати setupSessionId або cabinetId.');
    }

    if (!linkedAgent) {
      throw new BadRequestException('Capture agent для preview не підключено.');
    }

    const pair = (linkedAgent.pairs || []).find(
      (item) => item.pairKey === normalizedPairKey,
    );

    if (!pair) {
      throw new BadRequestException('Обрану пару не знайдено серед пар агента.');
    }

    if (!pair.isAvailable) {
      throw new BadRequestException('Обрана пара агента зараз недоступна.');
    }

    const preview = await this.captureAgentRealtimeService.requestPreview(
      linkedAgent.id,
      normalizedPairKey,
      { width: 960, quality: 0.82, timeoutMs: 7000 },
    );

    if (!preview.imageDataUrl) {
      throw new BadRequestException('Capture agent не повернув preview-кадр.');
    }

    return {
      preview: {
        pairKey: normalizedPairKey,
        imageDataUrl: preview.imageDataUrl,
        mimeType: preview.mimeType || 'image/jpeg',
        capturedAt: preview.capturedAt || new Date().toISOString(),
      },
    };
  }

  async removeSetupSession(currentUserId: string, setupSessionId: string) {
    await this.ensureManagerAccess(currentUserId);
    const setupSession = await this.getSetupSessionOrThrow(setupSessionId);
    this.ensureSetupSessionAccess(setupSession, currentUserId);

    await this.cabinetSetupSessionRepository.delete({ id: setupSession.id });

    return {
      ok: true,
      id: setupSession.id,
    };
  }

  async getAllForAdmin(currentUserId: string) {
    await this.ensureManagerAccess(currentUserId);

    const [cabinets, captureAgents] = await Promise.all([
      this.cabinetRepository.find({
        relations: [
          'services',
          'services.category',
          'services.specialties',
          'devices',
          'doctorAssignments',
          'doctorAssignments.doctor',
          'doctorAssignments.doctor.user',
        ],
        order: { name: 'ASC', createdAt: 'DESC' },
      }),
      this.captureAgentRepository.find({
        relations: { pairs: true, devices: true, cabinet: true },
        order: { updatedAt: 'DESC' },
      }),
    ]);

    return {
      cabinets: cabinets.map((item) =>
        this.mapCabinet(item, this.pickLinkedAgent(item, captureAgents)),
      ),
    };
  }

  async getDoctorsForAssignment(currentUserId: string) {
    await this.ensureManagerAccess(currentUserId);

    const doctors = await this.doctorRepository.find({
      where: { isActive: true },
      relations: ['user'],
      order: { lastName: 'ASC', firstName: 'ASC' },
    });

    return {
      doctors: doctors.map((item) => this.mapDoctor(item)),
    };
  }

  async getServicesForAssignment(currentUserId: string) {
    await this.ensureManagerAccess(currentUserId);

    const [services, doctors] = await Promise.all([
      this.clinicServiceRepository.find({
        where: { isActive: true },
        relations: ['category', 'specialties'],
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.doctorRepository.find({
        where: { isActive: true },
        relations: ['user'],
        order: { lastName: 'ASC', firstName: 'ASC' },
      }),
    ]);

    return {
      services: services.map((item) => {
        const doctorIds = doctors
          .filter((doctor) => this.doctorMatchesServiceBySpecialty(doctor, item))
          .map((doctor) => doctor.id);

        return this.mapService(item, doctorIds);
      }),
    };
  }

  async create(currentUserId: string, dto: CreateCabinetDto) {
    await this.ensureManagerAccess(currentUserId);

    const name = this.normalizeName(dto.name || '');
    if (!name) {
      throw new BadRequestException('Вкажіть назву кабінету');
    }

    const requestedAgentKey = this.normalizeAgentKey(dto.agentKey);
    const setupSession = dto.setupSessionId
      ? await this.getSetupSessionOrThrow(dto.setupSessionId)
      : null;

    if (setupSession) {
      this.ensureSetupSessionAccess(setupSession, currentUserId);
    }

    if (
      setupSession?.agentKey &&
      requestedAgentKey &&
      requestedAgentKey !== setupSession.agentKey
    ) {
      throw new BadRequestException('Agent key у сесії підключення не збігається з вибраним агентом');
    }

    const finalAgentKey = setupSession?.agentKey || requestedAgentKey;
    const linkedAgent = await this.ensureAgentKeyExists(finalAgentKey);

    if (setupSession && !linkedAgent) {
      throw new BadRequestException(
        'Підключи локальний capture agent до setup-сесії перед фінальним збереженням кабінету.',
      );
    }

    const devicesInput = this.normalizeDevices(dto.devices);
    await this.validateSelectedDevicesForAgent(devicesInput, linkedAgent);

    const [services, doctors] = await Promise.all([
      this.resolveServices(dto.serviceIds),
      this.resolveDoctors(dto.doctorIds),
    ]);

    const connectionCode = setupSession?.connectionCode || (await this.generateConnectionCode());

    await this.ensureCabinetNameUnique(name);

    let cabinet = this.cabinetRepository.create({
      name,
      description: this.normalizeDescription(dto.description),
      isActive: dto.isActive !== false,
      services,
      connectionCode,
      agentKey: finalAgentKey,
    });

    cabinet = await this.cabinetRepository.save(cabinet);
    await this.syncChildren(cabinet, devicesInput, doctors);

    if (setupSession) {
      await this.cabinetSetupSessionRepository.delete({ id: setupSession.id });
    }

    const boundAgent = await this.bindAgentToCabinet(finalAgentKey, cabinet);
    const saved = await this.getCabinetOrThrow(cabinet.id);

    return { cabinet: this.mapCabinet(saved, boundAgent ?? linkedAgent) };
  }

  async update(currentUserId: string, cabinetId: string, dto: UpdateCabinetDto) {
    await this.ensureManagerAccess(currentUserId);

    const cabinet = await this.getCabinetOrThrow(cabinetId);
    const nextName =
      dto.name !== undefined ? this.normalizeName(dto.name) : cabinet.name;
    if (!nextName) {
      throw new BadRequestException('Вкажіть назву кабінету');
    }

    const nextAgentKey =
      dto.agentKey !== undefined
        ? this.normalizeAgentKey(dto.agentKey)
        : cabinet.agentKey;
    const linkedAgent = await this.ensureAgentKeyExists(nextAgentKey);

    const devicesInput =
      dto.devices !== undefined
        ? this.normalizeDevices(dto.devices)
        : this.normalizeDevices(cabinet.devices as any);
    await this.validateSelectedDevicesForAgent(devicesInput, linkedAgent);
    const [services, doctors] = await Promise.all([
      dto.serviceIds !== undefined
        ? this.resolveServices(dto.serviceIds)
        : Promise.resolve(cabinet.services || []),
      dto.doctorIds !== undefined
        ? this.resolveDoctors(dto.doctorIds)
        : Promise.resolve(
            (cabinet.doctorAssignments || []).map((item) => item.doctor),
          ),
    ]);

    await this.ensureCabinetNameUnique(nextName, cabinetId);

    cabinet.name = nextName;
    cabinet.description =
      dto.description !== undefined
        ? this.normalizeDescription(dto.description)
        : cabinet.description;
    cabinet.isActive =
      dto.isActive !== undefined ? dto.isActive : cabinet.isActive;
    cabinet.agentKey = nextAgentKey;
    cabinet.services = services;

    await this.cabinetRepository.save(cabinet);
    await this.syncChildren(cabinet, devicesInput, doctors);

    if (nextAgentKey) {
      await this.bindAgentToCabinet(nextAgentKey, cabinet);
    }

    const saved = await this.getCabinetOrThrow(cabinet.id);
    return { cabinet: this.mapCabinet(saved, linkedAgent) };
  }

  async toggleActive(currentUserId: string, cabinetId: string) {
    await this.ensureManagerAccess(currentUserId);

    const cabinet = await this.getCabinetOrThrow(cabinetId);
    cabinet.isActive = !cabinet.isActive;
    await this.cabinetRepository.save(cabinet);

    const linkedAgent = cabinet.agentKey
      ? await this.captureAgentRepository.findOne({
          where: { agentKey: cabinet.agentKey },
          relations: { pairs: true, devices: true, cabinet: true },
        })
      : null;

    return {
      cabinet: this.mapCabinet(await this.getCabinetOrThrow(cabinet.id), linkedAgent),
    };
  }

  async remove(currentUserId: string, cabinetId: string) {
    await this.ensureManagerAccess(currentUserId);

    const cabinet = await this.getCabinetOrThrow(cabinetId);
    await this.cabinetRepository.remove(cabinet);

    return {
      ok: true,
      id: cabinetId,
    };
  }
}
