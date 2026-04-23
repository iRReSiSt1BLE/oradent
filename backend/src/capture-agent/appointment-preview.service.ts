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
import { CaptureAgentService } from './capture-agent.service';
import { CaptureAgentRealtimeService } from './capture-agent-realtime.service';
import { AppointmentPreviewFrameStore } from './appointment-preview-frame.store';

@Injectable()
export class AppointmentPreviewService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(Cabinet)
    private readonly cabinetRepository: Repository<Cabinet>,
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
    if (role === 'ADMIN' || role === 'SUPERADMIN') {
      return appointment;
    }

    if (role === 'DOCTOR' && appointment.doctorId === user?.id) {
      return appointment;
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

    const pair = (agent.pairs || []).find((item: any) => {
      if (String(item.videoDeviceId || '') !== String(device.cameraDeviceId || '')) {
        return false;
      }

      if (!device.microphoneDeviceId) {
        return true;
      }

      return String(item.audioDeviceId || '') === String(device.microphoneDeviceId || '');
    });

    if (!pair?.pairKey) {
      throw new BadRequestException('На агенті не знайдено пару для цього джерела запису');
    }

    return { appointment, device, agent, pair };
  }

  async startPreview(user: any, appointmentId: string, cabinetDeviceId: string) {
    const target = await this.resolveTarget(user, appointmentId, cabinetDeviceId);
    const sent = this.captureAgentRealtimeService.startContinuousPreview(target.agent.agentKey, target.pair.pairKey, {
      width: 960,
      quality: 0.72,
      fps: 8,
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
