import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Like, MoreThan, Repository } from 'typeorm';
import { CabinetSetupSession } from '../cabinet/entities/cabinet-setup-session.entity';
import { Cabinet } from '../cabinet/entities/cabinet.entity';
import { CabinetSetupRealtimeService } from '../cabinet/cabinet-setup-realtime.service';
import { EnrollCaptureAgentDto } from './dto/enroll-capture-agent.dto';
import {
  CaptureAgent,
  CaptureAgentStatus,
} from './entities/capture-agent.entity';
import { CaptureDevice } from './entities/capture-device.entity';
import { CaptureDevicePair } from './entities/capture-device-pair.entity';

export type DeviceInput = {
  kind?: string;
  deviceId?: string;
  label?: string | null;
};

export type DevicePairInput = {
  pairKey?: string;
  displayName?: string | null;
  videoDeviceId?: string;
  videoLabel?: string | null;
  audioDeviceId?: string;
  audioLabel?: string | null;
  sortOrder?: number;
};

export type HelloPayload = {
  agentName?: string;
  cabinetCode?: string;
  appVersion?: string;
  devices?: DeviceInput[];
  devicePairs?: DevicePairInput[];
};

@Injectable()
export class CaptureAgentService {
  private readonly logger = new Logger(CaptureAgentService.name);

  constructor(
    @InjectRepository(CaptureAgent)
    private readonly captureAgentRepository: Repository<CaptureAgent>,
    @InjectRepository(CaptureDevice)
    private readonly captureDeviceRepository: Repository<CaptureDevice>,
    @InjectRepository(CaptureDevicePair)
    private readonly captureDevicePairRepository: Repository<CaptureDevicePair>,
    @InjectRepository(Cabinet)
    private readonly cabinetRepository: Repository<Cabinet>,
    @InjectRepository(CabinetSetupSession)
    private readonly cabinetSetupSessionRepository: Repository<CabinetSetupSession>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cabinetSetupRealtimeService: CabinetSetupRealtimeService,
  ) {}

  async enroll(dto: EnrollCaptureAgentDto, ip: string | null) {
    const expectedToken = this.configService.get<string>(
      'CAPTURE_AGENT_ENROLLMENT_TOKEN',
      'one-time-enrollment-token',
    );

    const normalizedAgentKey = (dto.agentKey || '').trim() || randomUUID();
    const cabinetLookupValue = dto.cabinetCode || dto.cabinetId;
    const cabinet = await this.resolveCabinet(cabinetLookupValue);
    const setupSession = cabinet
      ? null
      : await this.resolveSetupSession(cabinetLookupValue);

    if (cabinetLookupValue && !cabinet && !setupSession) {
      throw new UnauthorizedException('Cabinet code не знайдено або він протермінований.');
    }

    if (!setupSession && dto.enrollmentToken !== expectedToken) {
      throw new UnauthorizedException('Невірний enrollment token');
    }

    this.ensureCabinetAgentKeyMatches(cabinet, normalizedAgentKey);
    this.ensureSetupSessionAgentKeyMatches(setupSession, normalizedAgentKey);

    let agent = await this.captureAgentRepository.findOne({
      where: { agentKey: normalizedAgentKey },
      relations: { devices: true, pairs: true, cabinet: true },
    });

    if (!agent) {
      agent = this.captureAgentRepository.create({ agentKey: normalizedAgentKey });
    }

    agent.name = dto.agentName?.trim() || `Agent ${normalizedAgentKey.slice(0, 8)}`;
    agent.cabinetId = cabinet?.id ?? null;
    agent.cabinet = cabinet ?? null;
    agent.status = CaptureAgentStatus.OFFLINE;
    agent.appVersion = dto.appVersion?.trim() || null;
    agent.lastIp = ip;
    agent.lastSeenAt = new Date();
    agent.tokenIssuedAt = new Date();
    agent.lastError = null;

    agent = await this.captureAgentRepository.save(agent);

    if (setupSession) {
      setupSession.agentKey = agent.agentKey;
      setupSession.agentName = agent.name;
      await this.cabinetSetupSessionRepository.save(setupSession);
      this.cabinetSetupRealtimeService.notifySetupSessionUpdated(setupSession.id);
    }

    await this.syncCabinetBinding(normalizedAgentKey, cabinet);
    await this.syncSnapshot(agent.id, dto.devices ?? [], dto.devicePairs ?? []);
    await this.cabinetSetupRealtimeService.notifyByAgentKey(agent.agentKey);

    const accessToken = await this.signAgentToken(agent);

    return {
      ok: true,
      agentId: agent.id,
      agentKey: agent.agentKey,
      agentName: agent.name,
      cabinetId: agent.cabinetId,
      cabinetCode: cabinet?.connectionCode ?? setupSession?.connectionCode ?? null,
      accessToken,
      wsPath: '/capture-agent/ws',
      heartbeatSeconds: Number(
        this.configService.get<string>('CAPTURE_AGENT_HEARTBEAT_SECONDS', '15'),
      ),
    };
  }

  async listAgents() {
    const agents = await this.captureAgentRepository.find({
      relations: { devices: true, pairs: true, cabinet: true },
      order: { updatedAt: 'DESC' },
    });

    return agents.map((agent) => this.mapAgent(agent));
  }

  async getAgentByKey(agentKey: string) {
    const agent = await this.captureAgentRepository.findOne({
      where: { agentKey },
      relations: { devices: true, pairs: true, cabinet: true },
    });

    if (!agent) {
      throw new NotFoundException('Capture agent не знайдено');
    }

    return { agent: this.mapAgent(agent) };
  }

  async validateAgentToken(agentToken?: string) {
    if (!agentToken) {
      throw new UnauthorizedException('Відсутній x-agent-token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        scope?: string;
      }>(agentToken, {
        secret: this.getJwtSecret(),
      });

      if (payload.scope !== 'capture-agent') {
        throw new UnauthorizedException('Невірний scope токена');
      }

      const agent = await this.captureAgentRepository.findOne({
        where: { id: payload.sub },
        relations: { devices: true, pairs: true, cabinet: true },
      });

      if (!agent) {
        throw new UnauthorizedException('Агент не знайдений');
      }

      return agent;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Невірний або прострочений токен агента');
    }
  }

  async markConnected(agentId: string, ip: string | null) {
    const agent = await this.requireAgent(agentId);
    agent.status = CaptureAgentStatus.ONLINE;
    agent.wsConnectedAt = new Date();
    agent.lastSeenAt = new Date();
    agent.lastIp = ip;
    agent.lastError = null;
    await this.captureAgentRepository.save(agent);
    await this.cabinetSetupRealtimeService.notifyByAgentKey(agent.agentKey);
  }

  async markDisconnected(agentId: string) {
    const agent = await this.requireAgent(agentId);
    agent.status = CaptureAgentStatus.OFFLINE;
    await this.captureAgentRepository.save(agent);
    await this.cabinetSetupRealtimeService.notifyByAgentKey(agent.agentKey);
  }

  async touchHeartbeat(agentId: string) {
    const agent = await this.requireAgent(agentId);
    agent.lastSeenAt = new Date();
    if (agent.status !== CaptureAgentStatus.ONLINE) {
      agent.status = CaptureAgentStatus.ONLINE;
    }
    await this.captureAgentRepository.save(agent);
    await this.cabinetSetupRealtimeService.notifyByAgentKey(agent.agentKey);
  }

  async processHello(agentId: string, payload: HelloPayload) {
    const agent = await this.requireAgent(agentId);

    if (payload.agentName?.trim()) {
      agent.name = payload.agentName.trim();
    }
    if (typeof payload.appVersion === 'string') {
      agent.appVersion = payload.appVersion.trim() || null;
    }
    if (typeof payload.cabinetCode === 'string' && payload.cabinetCode.trim()) {
      const cabinet = await this.resolveCabinet(payload.cabinetCode);
      const setupSession = cabinet
        ? null
        : await this.resolveSetupSession(payload.cabinetCode);

      this.ensureCabinetAgentKeyMatches(cabinet, agent.agentKey);
      this.ensureSetupSessionAgentKeyMatches(setupSession, agent.agentKey);

      agent.cabinetId = cabinet?.id ?? null;
      agent.cabinet = cabinet ?? null;
      await this.syncCabinetBinding(agent.agentKey, cabinet);

      if (setupSession) {
        setupSession.agentKey = agent.agentKey;
        setupSession.agentName = agent.name;
        await this.cabinetSetupSessionRepository.save(setupSession);
        this.cabinetSetupRealtimeService.notifySetupSessionUpdated(setupSession.id);
      }
    }

    agent.lastSeenAt = new Date();
    agent.status = CaptureAgentStatus.ONLINE;
    agent.lastError = null;
    await this.captureAgentRepository.save(agent);

    if ((payload.devices?.length || 0) > 0 || (payload.devicePairs?.length || 0) > 0) {
      await this.syncSnapshot(agent.id, payload.devices ?? [], payload.devicePairs ?? []);
    }

    await this.cabinetSetupRealtimeService.notifyByAgentKey(agent.agentKey);
  }

  async syncSnapshot(
    agentId: string,
    devices: DeviceInput[],
    devicePairs: DevicePairInput[],
  ) {
    const agent = await this.requireAgent(agentId);
    await this.syncDevices(agentId, devices);
    await this.syncDevicePairs(agentId, devicePairs);
    await this.cabinetSetupRealtimeService.notifyByAgentKey(agent.agentKey);
  }

  async markError(agentId: string, errorMessage: string) {
    const agent = await this.requireAgent(agentId);
    agent.lastError = errorMessage;
    agent.lastSeenAt = new Date();
    await this.captureAgentRepository.save(agent);
    await this.cabinetSetupRealtimeService.notifyByAgentKey(agent.agentKey);
  }

  private mapAgent(agent: CaptureAgent) {
    return {
      id: agent.id,
      agentKey: agent.agentKey,
      name: agent.name,
      status: agent.status,
      cabinetId: agent.cabinetId,
      cabinetName: agent.cabinet?.name ?? null,
      cabinetCode: agent.cabinet?.connectionCode ?? null,
      lastSeenAt: agent.lastSeenAt,
      wsConnectedAt: agent.wsConnectedAt,
      appVersion: agent.appVersion,
      lastIp: agent.lastIp,
      lastError: agent.lastError,
      devices: (agent.devices ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((device) => ({
          id: device.id,
          kind: device.kind,
          deviceId: device.deviceId,
          label: device.label,
          isAvailable: device.isAvailable,
          sortOrder: device.sortOrder,
        })),
      devicePairs: (agent.pairs ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((pair) => ({
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

  private async syncDevices(agentId: string, devices: DeviceInput[]) {
    const normalizedDevices = devices
      .map((device, index) => ({
        kind: (device.kind || '').trim(),
        deviceId: (device.deviceId || '').trim(),
        label:
          typeof device.label === 'string' ? device.label.trim() || null : null,
        sortOrder: index,
      }))
      .filter((device) => device.kind && device.deviceId);

    const existingDevices = await this.captureDeviceRepository.find({
      where: { agentId },
      order: { sortOrder: 'ASC' },
    });

    for (const existing of existingDevices) {
      existing.isAvailable = false;
    }

    for (const device of normalizedDevices) {
      let existing = existingDevices.find(
        (item) => item.kind === device.kind && item.deviceId === device.deviceId,
      );

      if (!existing) {
        existing = this.captureDeviceRepository.create({
          agentId,
          kind: device.kind,
          deviceId: device.deviceId,
        });
        existingDevices.push(existing);
      }

      existing.label = device.label;
      existing.sortOrder = device.sortOrder;
      existing.isAvailable = true;
    }

    await this.captureDeviceRepository.save(existingDevices);
  }

  private async syncDevicePairs(agentId: string, devicePairs: DevicePairInput[]) {
    const normalizedPairs = devicePairs
      .map((pair, index) => ({
        pairKey: (pair.pairKey || '').trim() || `pair-${index + 1}`,
        displayName:
          typeof pair.displayName === 'string'
            ? pair.displayName.trim() || null
            : null,
        videoDeviceId: (pair.videoDeviceId || '').trim(),
        videoLabel:
          typeof pair.videoLabel === 'string' ? pair.videoLabel.trim() || null : null,
        audioDeviceId: (pair.audioDeviceId || '').trim(),
        audioLabel:
          typeof pair.audioLabel === 'string' ? pair.audioLabel.trim() || null : null,
        sortOrder:
          typeof pair.sortOrder === 'number' && Number.isFinite(pair.sortOrder)
            ? pair.sortOrder
            : index,
      }))
      .filter((pair) => pair.videoDeviceId && pair.audioDeviceId);

    const existingPairs = await this.captureDevicePairRepository.find({
      where: { agentId },
      order: { sortOrder: 'ASC' },
    });

    for (const existing of existingPairs) {
      existing.isAvailable = false;
    }

    for (const pair of normalizedPairs) {
      let existing = existingPairs.find((item) => item.pairKey === pair.pairKey);

      if (!existing) {
        existing = existingPairs.find(
          (item) =>
            item.videoDeviceId === pair.videoDeviceId &&
            item.audioDeviceId === pair.audioDeviceId,
        );
      }

      if (!existing) {
        existing = this.captureDevicePairRepository.create({
          agentId,
          pairKey: pair.pairKey,
          videoDeviceId: pair.videoDeviceId,
          audioDeviceId: pair.audioDeviceId,
        });
        existingPairs.push(existing);
      }

      existing.pairKey = pair.pairKey;
      existing.displayName = pair.displayName;
      existing.videoDeviceId = pair.videoDeviceId;
      existing.videoLabel = pair.videoLabel;
      existing.audioDeviceId = pair.audioDeviceId;
      existing.audioLabel = pair.audioLabel;
      existing.sortOrder = pair.sortOrder;
      existing.isAvailable = true;
    }

    await this.captureDevicePairRepository.save(existingPairs);
  }

  private async signAgentToken(
    agent: Pick<CaptureAgent, 'id' | 'agentKey' | 'cabinetId'>,
  ) {
    const expiresIn = Number(
      this.configService.get<string>('CAPTURE_AGENT_JWT_EXPIRES_IN', '2592000'),
    );

    return this.jwtService.signAsync(
      {
        sub: agent.id,
        scope: 'capture-agent',
        agentKey: agent.agentKey,
        cabinetId: agent.cabinetId,
      },
      {
        secret: this.getJwtSecret(),
        expiresIn,
      },
    );
  }

  private async syncCabinetBinding(
    agentKey: string,
    cabinet: Cabinet | null,
  ): Promise<void> {
    const boundCabinets = await this.cabinetRepository.find({
      where: { agentKey },
    });

    for (const item of boundCabinets) {
      if (!cabinet || item.id !== cabinet.id) {
        item.agentKey = null;
        await this.cabinetRepository.save(item);
      }
    }

    if (!cabinet) {
      return;
    }

    if (cabinet.agentKey !== agentKey) {
      cabinet.agentKey = agentKey;
      await this.cabinetRepository.save(cabinet);
    }
  }

  private getJwtSecret() {
    return this.configService.get<string>(
      'CAPTURE_AGENT_JWT_SECRET',
      'oradent_capture_agent_jwt_secret',
    );
  }

  private async requireAgent(agentId: string) {
    const agent = await this.captureAgentRepository.findOne({
      where: { id: agentId },
      relations: { devices: true, pairs: true, cabinet: true },
    });

    if (!agent) {
      throw new NotFoundException('Capture agent не знайдено');
    }

    return agent;
  }

  private ensureCabinetAgentKeyMatches(
    cabinet: Cabinet | null,
    agentKey: string,
  ): void {
    if (cabinet?.agentKey && cabinet.agentKey !== agentKey) {
      throw new UnauthorizedException(
        'Цей cabinet code вже привʼязаний до іншого Agent key.',
      );
    }
  }

  private ensureSetupSessionAgentKeyMatches(
    setupSession: CabinetSetupSession | null,
    agentKey: string,
  ): void {
    if (setupSession?.agentKey && setupSession.agentKey !== agentKey) {
      throw new UnauthorizedException(
        'Цей cabinet code вже використовується іншим агентом у модалці створення.',
      );
    }
  }

  private async resolveCabinet(rawCabinetValue?: string) {
    const value = (rawCabinetValue || '').trim();
    if (!value) {
      return null;
    }

    let cabinet = await this.cabinetRepository.findOne({
      where: [{ connectionCode: value }, { id: value }, { name: value }],
    });
    if (cabinet) {
      return cabinet;
    }

    const candidates = await this.cabinetRepository.find({
      where: [{ name: Like(`%${value}%`) }, { connectionCode: Like(`%${value}%`) }],
      take: 1,
    });

    if (candidates.length > 0) {
      return candidates[0];
    }

    this.logger.warn(`Cabinet not resolved for value: ${value}`);
    return null;
  }

  private async resolveSetupSession(rawCabinetValue?: string) {
    const value = (rawCabinetValue || '').trim();
    if (!value) {
      return null;
    }

    return this.cabinetSetupSessionRepository.findOne({
      where: {
        connectionCode: value,
        expiresAt: MoreThan(new Date()),
      },
    });
  }
}
