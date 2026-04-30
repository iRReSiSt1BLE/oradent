import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import WebSocket from 'ws';
import { AppointmentRecordingEvent } from './entities/appointment-recording-event.entity';

export type PreviewRequestPayload = {
  requestId: string;
  pairKey: string;
  width?: number;
  quality?: number;
  fps?: number;
  mimeType?: string;
};

export type PreviewResponsePayload = {
  requestId?: string;
  pairKey?: string;
  imageDataUrl?: string;
  mimeType?: string;
  capturedAt?: string;
  error?: string;
};

type PendingPreviewRequest = {
  agentId: string;
  resolve: (payload: PreviewResponsePayload) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const BACKEND_COMMAND_STATES = new Set(['start_requested', 'stop_requested']);
const RECORDING_ACTIVE_STATES = new Set(['start_requested', 'starting', 'media_opening', 'media_ready', 'upload_entry_ready', 'recording']);
const RECORDING_STOPPING_STATES = new Set(['stop_requested', 'stopping', 'finalizing']);
const RECORDING_TERMINAL_STATES = new Set(['uploaded', 'queued', 'failed', 'discarded']);
const START_COMMAND_BLOCKING_STATES = new Set([
  ...RECORDING_ACTIVE_STATES,
  ...RECORDING_STOPPING_STATES,
]);
const STOP_COMMAND_BLOCKING_STATES = new Set([
  ...RECORDING_STOPPING_STATES,
  ...RECORDING_TERMINAL_STATES,
]);

function normalizeRecordingStateName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function recordingStateKey(appointmentId: string, cabinetDeviceId: string): string {
  return `${appointmentId}::${cabinetDeviceId}`;
}

function eventSortTimestamp(value: AgentRecordingStateEvent): number {
  const receivedAt = value.receivedAt ? new Date(value.receivedAt).getTime() : 0;
  if (Number.isFinite(receivedAt) && receivedAt > 0) return receivedAt;

  const reportedAt = value.reportedAt ? new Date(value.reportedAt).getTime() : 0;
  return Number.isFinite(reportedAt) ? reportedAt : 0;
}

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function sortRecordingEvents(a: AgentRecordingStateEvent, b: AgentRecordingStateEvent) {
  const aTime = eventSortTimestamp(a);
  const bTime = eventSortTimestamp(b);
  if (aTime !== bTime) return aTime - bTime;
  return Number(a.sequence || 0) - Number(b.sequence || 0);
}


export type AgentRecordingStatePayload = {
  state?: string;
  appointmentId?: string;
  cabinetDeviceId?: string;
  pairKey?: string;
  entryId?: string;
  totalBytes?: number;
  sha256Hash?: string;
  uploaded?: boolean;
  command?: 'start' | 'stop' | string;
  sent?: boolean;
  message?: string;
  reportedAt?: string;
};

export type AgentRecordingStateEvent = AgentRecordingStatePayload & {
  agentId: string;
  eventId: string;
  sequence: number;
  receivedAt: string;
};

@Injectable()
export class CaptureAgentRealtimeService {
  private readonly logger = new Logger(CaptureAgentRealtimeService.name);

  constructor(
    @InjectRepository(AppointmentRecordingEvent)
    private readonly recordingEventRepository: Repository<AppointmentRecordingEvent>,
  ) {}

  private readonly agentSockets = new Map<string, WebSocket>();
  private readonly socketAgents = new WeakMap<WebSocket, string>();
  private readonly agentKeysById = new Map<string, string>();
  private readonly agentIdsByKey = new Map<string, string>();
  private readonly pendingPreviewRequests = new Map<string, PendingPreviewRequest>();
  private readonly recordingStates = new Map<string, AgentRecordingStateEvent>();
  private readonly recordingStateTimeline = new Map<string, AgentRecordingStateEvent[]>();
  private readonly recordingStateSequenceByAppointment = new Map<string, number>();
  private recordingStateSequence = 0;

  register(agentId: string, agentKey: string, client: WebSocket) {
    const previous = this.agentSockets.get(agentId);
    if (previous && previous !== client) {
      try {
        previous.close();
      } catch {
        // noop
      }
    }

    this.agentSockets.set(agentId, client);
    this.socketAgents.set(client, agentId);
    const normalizedAgentKey = (agentKey || '').trim();
    if (normalizedAgentKey) {
      this.agentKeysById.set(agentId, normalizedAgentKey);
      this.agentIdsByKey.set(normalizedAgentKey, agentId);
    }
  }

  unregister(client: WebSocket) {
    const agentId = this.socketAgents.get(client);
    if (!agentId) {
      return null;
    }

    const activeClient = this.agentSockets.get(agentId);
    if (activeClient === client) {
      this.agentSockets.delete(agentId);
    }

    const agentKey = this.agentKeysById.get(agentId);
    if (agentKey) {
      this.agentKeysById.delete(agentId);
      this.agentIdsByKey.delete(agentKey);
    }

    for (const [requestId, pending] of [...this.pendingPreviewRequests.entries()]) {
      if (pending.agentId !== agentId) {
        continue;
      }

      clearTimeout(pending.timer);
      pending.reject(new Error('Зʼєднання з capture agent втрачено.'));
      this.pendingPreviewRequests.delete(requestId);
    }

    return agentId;
  }

  send(agentId: string, payload: Record<string, unknown>) {
    const client = this.agentSockets.get(agentId);
    if (!client || client.readyState !== WebSocket.OPEN) {
      return false;
    }

    client.send(JSON.stringify(payload));
    return true;
  }

  getAgentIdByKey(agentKey: string | null | undefined) {
    const normalizedAgentKey = (agentKey || '').trim();
    if (!normalizedAgentKey) {
      return null;
    }

    return this.agentIdsByKey.get(normalizedAgentKey) || null;
  }

  getAgentKeyById(agentId: string | null | undefined) {
    const normalizedAgentId = (agentId || '').trim();
    if (!normalizedAgentId) {
      return null;
    }

    return this.agentKeysById.get(normalizedAgentId) || null;
  }

  sendToAgentKey(agentKey: string, payload: Record<string, unknown>) {
    const agentId = this.getAgentIdByKey(agentKey);
    if (!agentId) {
      return false;
    }

    return this.send(agentId, payload);
  }

  startContinuousPreview(
    agentKey: string,
    pairKey: string,
    options?: { width?: number; quality?: number; fps?: number; mimeType?: string },
  ) {
    const agentId = this.getAgentIdByKey(agentKey);
    if (!agentId) {
      return false;
    }

    return this.send(agentId, {
      type: 'agent.preview.start',
      payload: {
        pairKey,
        width: options?.width,
        quality: options?.quality,
        fps: options?.fps,
        mimeType: options?.mimeType,
      },
    });
  }

  stopContinuousPreview(agentKey: string, pairKey?: string) {
    const agentId = this.getAgentIdByKey(agentKey);
    if (!agentId) {
      return false;
    }

    return this.send(agentId, {
      type: 'agent.preview.stop',
      payload: { pairKey },
    });
  }

  async requestPreview(
    agentId: string,
    pairKey: string,
    options?: { width?: number; quality?: number; timeoutMs?: number },
  ) {
    const requestId = randomUUID();
    const timeoutMs = Math.max(1000, Number(options?.timeoutMs || 6000));

    const sent = this.send(agentId, {
      type: 'agent.preview.request',
      payload: {
        requestId,
        pairKey,
        width: options?.width,
        quality: options?.quality,
      },
    });

    if (!sent) {
      throw new Error('Capture agent зараз офлайн або недоступний для preview.');
    }

    return new Promise<PreviewResponsePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPreviewRequests.delete(requestId);
        reject(new Error('Capture agent не повернув preview вчасно.'));
      }, timeoutMs);

      this.pendingPreviewRequests.set(requestId, {
        agentId,
        resolve,
        reject,
        timer,
      });
    });
  }

  resolvePreviewResponse(agentId: string, payload: PreviewResponsePayload) {
    const requestId = String(payload.requestId || '').trim();
    if (!requestId) {
      return false;
    }

    const pending = this.pendingPreviewRequests.get(requestId);
    if (!pending || pending.agentId !== agentId) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingPreviewRequests.delete(requestId);

    if (payload.error) {
      pending.reject(new Error(payload.error));
      return true;
    }

    pending.resolve(payload);
    return true;
  }


  async updateRecordingState(agentId: string, payload: AgentRecordingStatePayload) {
    const appointmentId = String(payload.appointmentId || '').trim();
    const cabinetDeviceId = String(payload.cabinetDeviceId || '').trim();
    if (!appointmentId || !cabinetDeviceId) {
      return false;
    }

    const now = new Date().toISOString();
    const stateName = normalizeRecordingStateName(payload.state);
    const key = recordingStateKey(appointmentId, cabinetDeviceId);
    const currentTimeline = this.recordingStateTimeline.get(appointmentId) || [];

    // Backend command-events are provisional diagnostics. Do not let repeated
    // start/stop commands regress the effective state after the agent already
    // reported a stronger state such as recording/finalizing/uploaded.
    const isBackendCommand = BACKEND_COMMAND_STATES.has(stateName);
    const effectiveBefore = this.getEffectiveCurrentRecordingStateForDevice(appointmentId, cabinetDeviceId);
    const effectiveBeforeState = normalizeRecordingStateName(effectiveBefore?.state);

    if (isBackendCommand) {
      const isDuplicateStart =
        stateName === 'start_requested' &&
        START_COMMAND_BLOCKING_STATES.has(effectiveBeforeState);
      const isDuplicateStop =
        stateName === 'stop_requested' &&
        STOP_COMMAND_BLOCKING_STATES.has(effectiveBeforeState);

      if (isDuplicateStart || isDuplicateStop) {
        return false;
      }
    }

    const sequence = await this.reserveRecordingSequence(appointmentId);
    const event: AgentRecordingStateEvent = {
      ...payload,
      state: stateName || payload.state,
      appointmentId,
      cabinetDeviceId,
      agentId,
      eventId: randomUUID(),
      sequence,
      reportedAt: String(payload.reportedAt || now),
      receivedAt: now,
    };

    currentTimeline.push(event);

    // Keep the in-memory diagnostic timeline bounded. Evidence data remains in video storage/DB.
    if (currentTimeline.length > 200) {
      currentTimeline.splice(0, currentTimeline.length - 200);
    }

    this.recordingStateTimeline.set(appointmentId, currentTimeline);

    const effective = this.getEffectiveCurrentRecordingStateForDevice(appointmentId, cabinetDeviceId) || event;
    this.recordingStates.set(key, effective);
    await this.persistRecordingEvent(event);
    return true;
  }

  private async reserveRecordingSequence(appointmentId: string): Promise<number> {
    const normalizedAppointmentId = String(appointmentId || '').trim();
    if (!normalizedAppointmentId) {
      this.recordingStateSequence += 1;
      return this.recordingStateSequence;
    }

    const memoryMax = Math.max(
      0,
      ...(this.recordingStateTimeline.get(normalizedAppointmentId) || []).map((item) => Number(item.sequence || 0)),
    );
    const cachedMax = Number(this.recordingStateSequenceByAppointment.get(normalizedAppointmentId) || 0);

    let persistedMax = 0;
    try {
      const raw = await this.recordingEventRepository
        .createQueryBuilder('event')
        .select('MAX(event.sequence)', 'max')
        .where('event.appointmentId = :appointmentId', { appointmentId: normalizedAppointmentId })
        .getRawOne<{ max?: string | number | null }>();
      persistedMax = Number(raw?.max || 0);
      if (!Number.isFinite(persistedMax)) persistedMax = 0;
    } catch (error) {
      this.logger.warn(`Failed to read appointment recording sequence max for ${normalizedAppointmentId}: ${(error as Error)?.message || error}`);
    }

    const next = Math.max(memoryMax, cachedMax, persistedMax, this.recordingStateSequence) + 1;
    this.recordingStateSequence = Math.max(this.recordingStateSequence, next);
    this.recordingStateSequenceByAppointment.set(normalizedAppointmentId, next);
    return next;
  }

  private async persistRecordingEvent(event: AgentRecordingStateEvent) {
    try {
      await this.recordingEventRepository.save(this.recordingEventRepository.create({
        appointmentId: event.appointmentId || '',
        cabinetDeviceId: event.cabinetDeviceId || '',
        agentId: event.agentId || null,
        state: normalizeRecordingStateName(event.state) || String(event.state || 'unknown'),
        command: event.command ? String(event.command) : null,
        pairKey: event.pairKey || null,
        entryId: event.entryId || null,
        totalBytes: typeof event.totalBytes === 'number' && Number.isFinite(event.totalBytes)
          ? String(Math.max(0, Math.trunc(event.totalBytes)))
          : null,
        sha256Hash: event.sha256Hash || null,
        uploaded: Boolean(event.uploaded),
        eventId: event.eventId,
        sequence: Number(event.sequence || 0),
        reportedAt: parseDateOrNull(event.reportedAt),
        receivedAt: parseDateOrNull(event.receivedAt) || new Date(),
        payloadJson: JSON.stringify(event),
      }));
    } catch (error) {
      this.logger.warn(`Failed to persist appointment recording event ${event.eventId}: ${(error as Error)?.message || error}`);
    }
  }

  private mapPersistedRecordingEvent(entity: AppointmentRecordingEvent): AgentRecordingStateEvent {
    let parsed: Partial<AgentRecordingStateEvent> = {};
    if (entity.payloadJson) {
      try {
        parsed = JSON.parse(entity.payloadJson);
      } catch {
        parsed = {};
      }
    }

    const totalBytes = entity.totalBytes != null ? Number(entity.totalBytes) : undefined;

    return {
      ...parsed,
      state: entity.state,
      appointmentId: entity.appointmentId,
      cabinetDeviceId: entity.cabinetDeviceId,
      agentId: entity.agentId || parsed.agentId || '',
      eventId: entity.eventId,
      sequence: Number(entity.sequence || parsed.sequence || 0),
      command: entity.command || parsed.command,
      pairKey: entity.pairKey || parsed.pairKey,
      entryId: entity.entryId || parsed.entryId,
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : parsed.totalBytes,
      sha256Hash: entity.sha256Hash || parsed.sha256Hash,
      uploaded: entity.uploaded || Boolean(parsed.uploaded),
      reportedAt: entity.reportedAt ? entity.reportedAt.toISOString() : parsed.reportedAt,
      receivedAt: entity.receivedAt ? entity.receivedAt.toISOString() : parsed.receivedAt || entity.createdAt?.toISOString(),
    } as AgentRecordingStateEvent;
  }

  private getEffectiveRecordingStateFromList(
    appointmentId: string,
    cabinetDeviceId: string,
    events: AgentRecordingStateEvent[],
  ) {
    const states = events
      .filter((item) => item.appointmentId === appointmentId && item.cabinetDeviceId === cabinetDeviceId)
      .slice()
      .sort(sortRecordingEvents);

    if (states.length === 0) return null;

    const latest = states[states.length - 1];
    const latestState = normalizeRecordingStateName(latest.state);
    if (!BACKEND_COMMAND_STATES.has(latestState)) return latest;

    const previousAgentState = [...states]
      .reverse()
      .find((item) => !BACKEND_COMMAND_STATES.has(normalizeRecordingStateName(item.state)));

    if (!previousAgentState) return latest;

    const previousState = normalizeRecordingStateName(previousAgentState.state);

    if (latestState === 'start_requested') {
      if (
        RECORDING_ACTIVE_STATES.has(previousState) ||
        RECORDING_STOPPING_STATES.has(previousState) ||
        RECORDING_TERMINAL_STATES.has(previousState)
      ) {
        return previousAgentState;
      }
      return latest;
    }

    if (latestState === 'stop_requested') {
      if (RECORDING_STOPPING_STATES.has(previousState) || RECORDING_TERMINAL_STATES.has(previousState)) {
        return previousAgentState;
      }
      return latest;
    }

    return latest;
  }

  async getRecordingStatesByAppointmentPersistent(appointmentId: string) {
    const normalizedAppointmentId = String(appointmentId || '').trim();
    const memoryEvents = this.getRecordingStatesByAppointment(normalizedAppointmentId);
    const persisted = (await this.recordingEventRepository.find({
      where: { appointmentId: normalizedAppointmentId },
      order: { receivedAt: 'DESC', createdAt: 'DESC' },
      take: 500,
    })).reverse();

    const eventsById = new Map<string, AgentRecordingStateEvent>();
    for (const event of persisted.map((item) => this.mapPersistedRecordingEvent(item))) {
      eventsById.set(event.eventId, event);
    }
    for (const event of memoryEvents) {
      eventsById.set(event.eventId, event);
    }

    return [...eventsById.values()].sort(sortRecordingEvents);
  }

  async getCurrentRecordingStatesByAppointmentPersistent(appointmentId: string) {
    const normalizedAppointmentId = String(appointmentId || '').trim();
    const events = await this.getRecordingStatesByAppointmentPersistent(normalizedAppointmentId);
    const keys = new Set(events.map((item) => recordingStateKey(item.appointmentId || '', item.cabinetDeviceId || '')));
    const effectiveStates: AgentRecordingStateEvent[] = [];

    for (const key of keys) {
      const [stateAppointmentId, cabinetDeviceId] = key.split('::');
      if (stateAppointmentId !== normalizedAppointmentId || !cabinetDeviceId) continue;
      const effective = this.getEffectiveRecordingStateFromList(stateAppointmentId, cabinetDeviceId, events);
      if (effective) effectiveStates.push(effective);
    }

    return effectiveStates.sort((a, b) => sortRecordingEvents(b, a));
  }

  async getLatestRecordingStateByAppointmentPersistent(appointmentId: string) {
    const currentStates = await this.getCurrentRecordingStatesByAppointmentPersistent(appointmentId);
    if (currentStates.length > 0) return currentStates[0];

    const states = await this.getRecordingStatesByAppointmentPersistent(appointmentId);
    return states.length > 0 ? states[states.length - 1] : null;
  }

  getRecordingStatesByAppointment(appointmentId: string) {
    const normalizedAppointmentId = String(appointmentId || '').trim();
    return (this.recordingStateTimeline.get(normalizedAppointmentId) || [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence);
  }

  getCurrentRecordingStatesByAppointment(appointmentId: string) {
    const normalizedAppointmentId = String(appointmentId || '').trim();
    const states = this.getRecordingStatesByAppointment(normalizedAppointmentId);
    const keys = new Set(states.map((item) => recordingStateKey(item.appointmentId || '', item.cabinetDeviceId || '')));
    const effectiveStates: AgentRecordingStateEvent[] = [];

    for (const key of keys) {
      const [stateAppointmentId, cabinetDeviceId] = key.split('::');
      if (stateAppointmentId !== normalizedAppointmentId || !cabinetDeviceId) {
        continue;
      }

      const effective = this.getEffectiveCurrentRecordingStateForDevice(stateAppointmentId, cabinetDeviceId);
      if (effective) {
        effectiveStates.push(effective);
      }
    }

    return effectiveStates.sort((a, b) => b.sequence - a.sequence);
  }

  getLatestRecordingStateByAppointment(appointmentId: string) {
    const currentStates = this.getCurrentRecordingStatesByAppointment(appointmentId);
    if (currentStates.length > 0) {
      return currentStates[0];
    }

    const states = this.getRecordingStatesByAppointment(appointmentId);
    return states.length > 0 ? states[states.length - 1] : null;
  }

  getEffectiveCurrentRecordingStateForDevice(appointmentId: string, cabinetDeviceId: string) {
    const normalizedAppointmentId = String(appointmentId || '').trim();
    const normalizedCabinetDeviceId = String(cabinetDeviceId || '').trim();
    if (!normalizedAppointmentId || !normalizedCabinetDeviceId) {
      return null;
    }

    const states = this.getRecordingStatesByAppointment(normalizedAppointmentId)
      .filter((item) => item.cabinetDeviceId === normalizedCabinetDeviceId);

    if (states.length === 0) {
      return null;
    }

    const latest = states[states.length - 1];
    const latestState = normalizeRecordingStateName(latest.state);
    if (!BACKEND_COMMAND_STATES.has(latestState)) {
      return latest;
    }

    const previousAgentState = [...states]
      .reverse()
      .find((item) => !BACKEND_COMMAND_STATES.has(normalizeRecordingStateName(item.state)));

    if (!previousAgentState) {
      return latest;
    }

    const previousState = normalizeRecordingStateName(previousAgentState.state);

    if (latestState === 'start_requested') {
      if (
        RECORDING_ACTIVE_STATES.has(previousState) ||
        RECORDING_STOPPING_STATES.has(previousState) ||
        RECORDING_TERMINAL_STATES.has(previousState)
      ) {
        return previousAgentState;
      }
      return latest;
    }

    if (latestState === 'stop_requested') {
      if (RECORDING_STOPPING_STATES.has(previousState) || RECORDING_TERMINAL_STATES.has(previousState)) {
        return previousAgentState;
      }
      return latest;
    }

    return latest;
  }

  async canSendRecordingCommandPersistent(appointmentId: string, cabinetDeviceId: string, command: 'start' | 'stop') {
    const currentState =
      this.getEffectiveCurrentRecordingStateForDevice(appointmentId, cabinetDeviceId) ||
      await this.getEffectiveCurrentRecordingStateForDevicePersistent(appointmentId, cabinetDeviceId);
    return this.evaluateRecordingCommandGate(currentState, command);
  }

  private async getEffectiveCurrentRecordingStateForDevicePersistent(appointmentId: string, cabinetDeviceId: string) {
    const normalizedAppointmentId = String(appointmentId || '').trim();
    const normalizedCabinetDeviceId = String(cabinetDeviceId || '').trim();
    if (!normalizedAppointmentId || !normalizedCabinetDeviceId) return null;

    const events = await this.getRecordingStatesByAppointmentPersistent(normalizedAppointmentId);
    return this.getEffectiveRecordingStateFromList(normalizedAppointmentId, normalizedCabinetDeviceId, events);
  }

  private evaluateRecordingCommandGate(currentState: AgentRecordingStateEvent | null, command: 'start' | 'stop') {
    const stateName = normalizeRecordingStateName(currentState?.state);

    if (command === 'start') {
      if (START_COMMAND_BLOCKING_STATES.has(stateName)) {
        return {
          allowed: false,
          reason: `Запис уже активний або завершується: ${stateName || 'unknown'}.`,
          currentState,
        };
      }

      return { allowed: true, currentState };
    }

    if (STOP_COMMAND_BLOCKING_STATES.has(stateName)) {
      return {
        allowed: false,
        reason: `Запис уже зупиняється або завершений: ${stateName || 'unknown'}.`,
        currentState,
      };
    }

    if (!currentState || !stateName) {
      return {
        allowed: false,
        reason: 'Немає активного запису для зупинки.',
        currentState,
      };
    }

    return { allowed: true, currentState };
  }

  canSendRecordingCommand(appointmentId: string, cabinetDeviceId: string, command: 'start' | 'stop') {
    const currentState = this.getEffectiveCurrentRecordingStateForDevice(appointmentId, cabinetDeviceId);
    const stateName = normalizeRecordingStateName(currentState?.state);

    if (command === 'start') {
      if (START_COMMAND_BLOCKING_STATES.has(stateName)) {
        return {
          allowed: false,
          reason: `Запис уже активний або завершується: ${stateName || 'unknown'}.`,
          currentState,
        };
      }

      return { allowed: true, currentState };
    }

    if (STOP_COMMAND_BLOCKING_STATES.has(stateName)) {
      return {
        allowed: false,
        reason: `Запис уже зупиняється або завершений: ${stateName || 'unknown'}.`,
        currentState,
      };
    }

    if (!currentState || !stateName) {
      return {
        allowed: false,
        reason: 'Немає активного запису для зупинки.',
        currentState,
      };
    }

    return { allowed: true, currentState };
  }
}
