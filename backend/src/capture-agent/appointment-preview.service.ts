import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment } from '../appointment/entities/appointment.entity';
import { Cabinet } from '../cabinet/entities/cabinet.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { CaptureAgentService } from './capture-agent.service';
import { CaptureAgentRealtimeService } from './capture-agent-realtime.service';
import { AppointmentPreviewFrameStore } from './appointment-preview-frame.store';
import { CaptureAgent, CaptureAgentStatus } from './entities/capture-agent.entity';

@Injectable()
export class AppointmentPreviewService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(Cabinet)
    private readonly cabinetRepository: Repository<Cabinet>,
    @InjectRepository(Doctor)
    private readonly doctorRepository: Repository<Doctor>,
    @InjectRepository(CaptureAgent)
    private readonly captureAgentRepository: Repository<CaptureAgent>,
    private readonly captureAgentService: CaptureAgentService,
    private readonly captureAgentRealtimeService: CaptureAgentRealtimeService,
    private readonly previewFrameStore: AppointmentPreviewFrameStore,
  ) {}

  private async requireAppointmentAccess(user: any, appointmentId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({ where: { id: appointmentId } });
    if (!appointment) {
      throw new NotFoundException('Прийом не знайдено');
    }

    const role = String(user?.role || '').trim().toUpperCase();
    if (role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'SUPERADMIN') {
      return appointment;
    }

    if (role === 'DOCTOR') {
      if (appointment.doctorId === user?.id) {
        return appointment;
      }

      const doctor = await this.doctorRepository.findOne({
        where: [{ id: user?.id }, { user: { id: user?.id } }],
        relations: ['user'],
      });

      if (doctor && appointment.doctorId === doctor.id) {
        return appointment;
      }
    }

    throw new ForbiddenException('Немає доступу до preview цього прийому');
  }

  private async resolveTarget(user: any, appointmentId: string, cabinetDeviceId: string) {
    const appointment = await this.requireAppointmentAccess(user, appointmentId);
    if (!appointment.cabinetId) {
      throw new BadRequestException('Для цього прийому не вказано кабінет');
    }

    const cabinet = await this.cabinetRepository.findOne({
      where: { id: appointment.cabinetId },
      relations: ['devices'],
    });

    if (!cabinet) {
      throw new NotFoundException('Кабінет не знайдено');
    }

    const device = (cabinet.devices || []).find((item: any) => item.id === cabinetDeviceId && item.isActive);
    if (!device) {
      throw new NotFoundException('Джерело запису не знайдено');
    }

    if (!device.cameraDeviceId) {
      throw new BadRequestException('Для цього джерела не налаштовано камеру');
    }

    const agent = await this.captureAgentService.getOnlineAgentByCabinetId(appointment.cabinetId);
    if (!agent?.agentKey) {
      throw new BadRequestException('Capture agent для цього кабінету зараз офлайн');
    }

    const pair = this.findAgentPair(agent as CaptureAgent, {
      cameraDeviceId: device.cameraDeviceId,
      microphoneDeviceId: device.microphoneDeviceId,
    });

    if (!pair?.pairKey) {
      throw new BadRequestException('На агенті не знайдено пару для цього джерела запису');
    }

    return { appointment, device, agent, pair };
  }

  private normalizePairKey(value?: string | null) {
    return String(value || '').trim();
  }

  private findAgentPair(
    agent: CaptureAgent,
    options: { pairKey?: string | null; cameraDeviceId?: string | null; microphoneDeviceId?: string | null },
  ) {
    const pairs = agent.pairs || [];
    const normalizedPairKey = this.normalizePairKey(options.pairKey);
    const cameraDeviceId = String(options.cameraDeviceId || '').trim();
    const microphoneDeviceId = String(options.microphoneDeviceId || '').trim();

    if (normalizedPairKey) {
      const byKey = pairs.find((pair: any) => String(pair.pairKey || '') === normalizedPairKey);
      if (byKey) return byKey;
    }

    if (cameraDeviceId || microphoneDeviceId) {
      const byDevices = pairs.find((pair: any) => {
        const videoMatches = cameraDeviceId ? String(pair.videoDeviceId || '') === cameraDeviceId : true;
        const audioMatches = microphoneDeviceId ? String(pair.audioDeviceId || '') === microphoneDeviceId : true;
        return videoMatches && audioMatches;
      });
      if (byDevices) return byDevices;
    }

    return null;
  }

  private async getOnlineAgentEntityByCabinetId(cabinetId: string, preferredAgentKey?: string | null) {
    const normalizedCabinetId = String(cabinetId || '').trim();
    if (!normalizedCabinetId) return null;

    const where = preferredAgentKey
      ? [{ agentKey: preferredAgentKey }, { cabinetId: normalizedCabinetId }]
      : [{ cabinetId: normalizedCabinetId }];

    const agents = await this.captureAgentRepository.find({
      where: where as any,
      relations: { pairs: true, devices: true, cabinet: true },
      order: { updatedAt: 'DESC' },
    });

    return agents.find((agent) => agent.status === CaptureAgentStatus.ONLINE && (agent.cabinetId === normalizedCabinetId || agent.agentKey === preferredAgentKey)) || null;
  }

  async resolveWebRtcAppointmentPreviewTarget(user: any, appointmentId: string, cabinetDeviceId: string) {
    const target = await this.resolveTarget(user, appointmentId, cabinetDeviceId);
    const agentId = this.captureAgentRealtimeService.getAgentIdByKey(target.agent.agentKey);
    if (!agentId) {
      throw new BadRequestException('Capture agent зараз офлайн або недоступний для WebRTC preview.');
    }

    return {
      agentId,
      agentKey: target.agent.agentKey,
      pairKey: target.pair.pairKey,
      appointment: target.appointment,
      device: target.device,
    };
  }

  async resolveWebRtcCabinetPreviewTarget(user: any, cabinetId: string, pairKey: string) {
    const role = String(user?.role || '').trim().toUpperCase();
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN' && role !== 'SUPERADMIN') {
      throw new ForbiddenException('Немає доступу до preview кабінету.');
    }

    const cabinet = await this.cabinetRepository.findOne({
      where: { id: String(cabinetId || '').trim() },
      relations: ['devices'],
    });

    if (!cabinet) {
      throw new NotFoundException('Кабінет не знайдено');
    }

    const agent = await this.getOnlineAgentEntityByCabinetId(cabinet.id, cabinet.agentKey);
    if (!agent?.agentKey) {
      throw new BadRequestException('Capture agent для цього кабінету зараз офлайн');
    }

    const pair = this.findAgentPair(agent, { pairKey });
    if (!pair?.pairKey) {
      throw new BadRequestException('На агенті не знайдено пару для цього preview.');
    }

    const agentId = this.captureAgentRealtimeService.getAgentIdByKey(agent.agentKey);
    if (!agentId) {
      throw new BadRequestException('Capture agent зараз офлайн або недоступний для WebRTC preview.');
    }

    return {
      agentId,
      agentKey: agent.agentKey,
      pairKey: pair.pairKey,
      cabinet,
    };
  }

  async startPreview(user: any, appointmentId: string, cabinetDeviceId: string, options?: { fps?: number; width?: number; quality?: number }) {
    const target = await this.resolveTarget(user, appointmentId, cabinetDeviceId);
    const sent = this.captureAgentRealtimeService.startContinuousPreview(target.agent.agentKey, target.pair.pairKey, {
      width: Math.max(480, Math.min(1280, Number(options?.width || 960))),
      quality: Math.max(0.45, Math.min(0.92, Number(options?.quality || 0.82))),
      fps: Math.max(6, Math.min(20, Number(options?.fps || 12))),
      mimeType: 'image/webp',
    });

    if (!sent) {
      throw new BadRequestException('Не вдалося запустити live-preview на capture agent');
    }

    return {
      ok: true,
      pairKey: target.pair.pairKey,
      message: 'Live-preview запущено.',
    };
  }

  async stopPreview(user: any, appointmentId: string, cabinetDeviceId: string) {
    const target = await this.resolveTarget(user, appointmentId, cabinetDeviceId);
    this.captureAgentRealtimeService.stopContinuousPreview(target.agent.agentKey, target.pair.pairKey);
    this.previewFrameStore.clearFrame(target.agent.agentKey, target.pair.pairKey);

    return {
      ok: true,
      message: 'Live-preview зупинено.',
    };
  }

  async getLatestFrame(user: any, appointmentId: string, cabinetDeviceId: string) {
    const target = await this.resolveTarget(user, appointmentId, cabinetDeviceId);
    const preview = this.previewFrameStore.getFrame(target.agent.agentKey, target.pair.pairKey);

    return {
      ok: true,
      preview,
    };
  }
}
