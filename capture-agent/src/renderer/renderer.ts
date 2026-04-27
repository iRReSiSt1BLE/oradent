import type { AgentConfig, AgentConfiguredPair } from '../state/default-config';
import type { EnrollResponse, PingResponse } from '../services/http-client';
import type { DevicePairSnapshot, DeviceSyncSnapshot, RawDeviceSnapshot, SocketCommandPayload, SocketStatusPayload } from '../services/socket-client';

declare global {
  interface Window {
    agentApi: {
      getConfig(): Promise<AgentConfig>;
      saveConfig(payload: Partial<AgentConfig>): Promise<AgentConfig>;
      pingBackend(): Promise<PingResponse>;
      enroll(snapshot: DeviceSyncSnapshot): Promise<{ ok: boolean; config: AgentConfig; enrolled: EnrollResponse }>;
      connectSocket(snapshot: DeviceSyncSnapshot): Promise<{ ok: boolean }>;
      disconnectSocket(): Promise<{ ok: boolean }>;
      copyText(value: string): Promise<{ ok: boolean }>;
      syncSnapshot(snapshot: DeviceSyncSnapshot): Promise<{ ok: boolean }>;
      sendPreviewResponse(payload: Record<string, unknown>): Promise<{ ok: boolean }>;
      sendPreviewSignal(payload: Record<string, unknown>): Promise<{ ok: boolean }>;
      sendPreviewFrame(payload: Record<string, unknown>): Promise<{ ok: boolean }>;
      queueRecordingUpload(payload: Record<string, unknown>): Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string }>;
      beginRecordingUpload(payload: Record<string, unknown>): Promise<{ ok: boolean; entryId: string }>;
      appendRecordingChunk(payload: Record<string, unknown>): Promise<{ ok: boolean; totalBytes: number }>;
      finalizeRecordingUpload(payload: Record<string, unknown>): Promise<{ ok: boolean; queued: boolean; uploaded: boolean; entryId: string }>;
      discardRecordingUpload(payload: Record<string, unknown>): Promise<{ ok: boolean }>;
      flushRecordingQueue(): Promise<{ ok: boolean; uploadedCount: number; pendingCount: number }>;
      onSocketStatus(callback: (payload: SocketStatusPayload) => void): () => void;
      onSocketCommand(callback: (payload: SocketCommandPayload) => void): () => void;
    };
  }
}

type PermissionStateValue = 'unknown' | 'prompt' | 'granted' | 'denied';
type SocketStateValue = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
type ToastVariant = 'success' | 'error' | 'info';

type AccessResult = {
  camera: boolean;
  microphone: boolean;
};

type PairView = {
  pairKey: string;
  displayName: string;
  videoDeviceId: string;
  videoLabel: string;
  audioDeviceId: string;
  audioLabel: string;
  snapshotHotkey: string;
};

type EncodedPreviewFrame = {
  imageDataUrl: string;
  mimeType: string;
  capturedAt: string;
};

type BinaryPreviewFrame = {
  imageBytes: Uint8Array;
  mimeType: string;
  capturedAt: string;
};

type ContinuousPreviewState = {
  pairKey: string;
  width: number;
  quality: number;
  fps: number;
  mimeType: string;
  timer: number | null;
  stream: MediaStream | null;
  ownsStream: boolean;
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  context: CanvasRenderingContext2D | null;
  sending: boolean;
  stopped: boolean;
};

type PreviewSignalPayload = {
  setupSessionId?: string;
  previewSessionId?: string;
  pairKey?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type WebRtcPreviewState = {
  sessionKey: string;
  setupSessionId?: string;
  previewSessionId?: string;
  pairKey: string;
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  ownsStream: boolean;
};

type AgentRecordingSession = {
  recordingKey: string;
  appointmentId: string;
  cabinetDeviceId: string;
  pair: PairView;
  stream: MediaStream;
  recorder: MediaRecorder;
  uploadEntryId: string;
  pendingWrite: Promise<void>;
  totalBytes: number;
  stopReason: string | null;
  maxDurationTimerId: number | null;
  startedAt: string;
  mimeType: string;
  originalFileName: string;
};

const PREVIEW_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    {
      urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    },
  ],
};

const RECORDING_TIMESLICE_MS = 1000;
const MAX_RECORDING_BYTES = 350 * 1024 * 1024;
const MAX_RECORDING_DURATION_MS = 45 * 60 * 1000;
const VIDEO_BITS_PER_SECOND = 1_000_000;
const AUDIO_BITS_PER_SECOND = 64_000;


function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Не знайдено DOM-елемент: ${id}`);
  }
  return element as T;
}

const grantAccessBtn = byId<HTMLButtonElement>('grantAccessBtn');
const refreshDevicesBtn = byId<HTMLButtonElement>('refreshDevicesBtn');
const connectAgentBtn = byId<HTMLButtonElement>('connectAgentBtn');
const disconnectSocketBtn = byId<HTMLButtonElement>('disconnectSocketBtn');
const stopPreviewBtn = byId<HTMLButtonElement>('stopPreviewBtn');
const startMicTestBtn = byId<HTMLButtonElement>('startMicTestBtn');
const playMicTestBtn = byId<HTMLButtonElement>('playMicTestBtn');
const addPairBtn = byId<HTMLButtonElement>('addPairBtn');
const autofillPairsBtn = byId<HTMLButtonElement>('autofillPairsBtn');
const captureHotkeyBtn = byId<HTMLButtonElement>('captureHotkeyBtn');
const manualSnapshotBtn = byId<HTMLButtonElement>('manualSnapshotBtn');
const resetHotkeyBtn = byId<HTMLButtonElement>('resetHotkeyBtn');

const backendUrlInput = byId<HTMLInputElement>('backendUrlInput');
const cabinetCodeInput = byId<HTMLInputElement>('cabinetCodeInput');
const pairNameInput = byId<HTMLInputElement>('pairNameInput');
const videoSelect = byId<HTMLSelectElement>('videoSelect');
const audioSelect = byId<HTMLSelectElement>('audioSelect');
const snapshotHotkeyInput = byId<HTMLInputElement>('snapshotHotkeyInput');

const previewVideo = byId<HTMLVideoElement>('previewVideo');
const previewPlaceholder = byId<HTMLDivElement>('previewPlaceholder');
const micPlaybackAudio = byId<HTMLAudioElement>('micPlaybackAudio');
const micPlaybackWrap = byId<HTMLDivElement>('micPlaybackWrap');
const micMeterFill = byId<HTMLDivElement>('micMeterFill');
const meterPercentText = byId<HTMLDivElement>('meterPercentText');
const micTestMeta = byId<HTMLSpanElement>('micTestMeta');
const pairsContainer = byId<HTMLDivElement>('pairsContainer');
const persistentNote = byId<HTMLDivElement>('persistentNote');
const pairsCountText = byId<HTMLSpanElement>('pairsCountText');
const snapshotStatusText = byId<HTMLDivElement>('snapshotStatusText');
const toastStack = byId<HTMLDivElement>('toastStack');

const globalStatusBadge = byId<HTMLSpanElement>('globalStatusBadge');
const backendStateBadge = byId<HTMLSpanElement>('backendStateBadge');
const registrationStateBadge = byId<HTMLSpanElement>('registrationStateBadge');
const socketStateBadge = byId<HTMLSpanElement>('socketStateBadge');
const cameraPermissionBadge = byId<HTMLSpanElement>('cameraPermissionBadge');
const microphonePermissionBadge = byId<HTMLSpanElement>('microphonePermissionBadge');
const recordDot = byId<HTMLSpanElement>('recordDot');
const recordButtonText = byId<HTMLSpanElement>('recordButtonText');

let config: AgentConfig | null = null;
let deviceInventory: MediaDeviceInfo[] = [];
let previewStream: MediaStream | null = null;
let micTestStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordedAudioUrl = '';
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let analyserSource: MediaStreamAudioSourceNode | null = null;
let analyserFrame = 0;
let backendState: 'idle' | 'busy' | 'ok' | 'error' = 'idle';
let socketState: SocketStateValue = 'idle';
let permissionState = {
  camera: 'unknown' as PermissionStateValue,
  microphone: 'unknown' as PermissionStateValue,
};
let continuousPreviewState: ContinuousPreviewState | null = null;
let webRtcPreviewState: WebRtcPreviewState | null = null;
const activeRecordingSessions = new Map<string, AgentRecordingSession>();
let awaitingSnapshotHotkey = false;
let awaitingSnapshotHotkeyPairKey: string | null = null;
let snapshotInFlight = false;

function toast(message: string, variant: ToastVariant = 'info'): void {
  const item = document.createElement('div');
  item.className = `toast toast--${variant}`;
  item.textContent = message;
  toastStack.appendChild(item);
  window.setTimeout(() => item.remove(), 3200);
}

function setBadge(
  element: HTMLElement,
  text: string,
  variant: 'idle' | 'ok' | 'warn' | 'error' | 'busy' | 'connected' | 'disconnected',
): void {
  element.textContent = text;
  element.className = `status-pill status-pill--${variant}`;
}

function setStatusLine(text: string): void {
  persistentNote.textContent = text;
}

function optionLabel(device: MediaDeviceInfo, index: number): string {
  const base = device.kind === 'videoinput' ? 'Камера' : 'Мікрофон';
  return (device.label || '').trim() || `${base} ${index + 1}`;
}

function getVideoInputs(): MediaDeviceInfo[] {
  return deviceInventory.filter((device) => device.kind === 'videoinput');
}

function getAudioInputs(): MediaDeviceInfo[] {
  return deviceInventory.filter((device) => device.kind === 'audioinput');
}

function makePairKey(): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(16).slice(2, 10);
  return `pair-${suffix}`;
}

function findDeviceLabel(kind: 'videoinput' | 'audioinput', deviceId: string): string {
  const list = kind === 'videoinput' ? getVideoInputs() : getAudioInputs();
  const index = list.findIndex((item) => item.deviceId === deviceId);
  const device = index >= 0 ? list[index] : null;
  return device ? optionLabel(device, index) : deviceId;
}

function makeDefaultPairName(videoDeviceId: string, audioDeviceId: string): string {
  return `${findDeviceLabel('videoinput', videoDeviceId)} + ${findDeviceLabel('audioinput', audioDeviceId)}`;
}

function resolveConfiguredPair(pair: AgentConfiguredPair): PairView | null {
  if (!pair.videoDeviceId || !pair.audioDeviceId) {
    return null;
  }

  const videoIndex = getVideoInputs().findIndex((item) => item.deviceId === pair.videoDeviceId);
  const audioIndex = getAudioInputs().findIndex((item) => item.deviceId === pair.audioDeviceId);
  const video = videoIndex >= 0 ? getVideoInputs()[videoIndex] : null;
  const audio = audioIndex >= 0 ? getAudioInputs()[audioIndex] : null;
  const videoLabel = video ? optionLabel(video, videoIndex) : findDeviceLabel('videoinput', pair.videoDeviceId);
  const audioLabel = audio ? optionLabel(audio, audioIndex) : findDeviceLabel('audioinput', pair.audioDeviceId);

  return {
    pairKey: pair.pairKey,
    displayName: pair.displayName || `${videoLabel} + ${audioLabel}`,
    videoDeviceId: pair.videoDeviceId,
    videoLabel,
    audioDeviceId: pair.audioDeviceId,
    audioLabel,
    snapshotHotkey: pair.snapshotHotkey || config?.snapshotHotkey || 'F8',
  };
}

function buildPairs(): PairView[] {
  return (config?.configuredPairs || [])
    .map((pair) => resolveConfiguredPair(pair))
    .filter((pair): pair is PairView => Boolean(pair));
}

function activePair(): PairView | null {
  const pairs = buildPairs();
  if (!pairs.length) {
    return null;
  }

  const selected = pairs.find((pair) => pair.pairKey === config?.activePairKey);
  return selected || pairs[0] || null;
}

async function persistConfig(payload: Partial<AgentConfig>): Promise<void> {
  config = await window.agentApi.saveConfig(payload);
  syncUiWithConfig();
}

async function updateConfiguredPairs(nextPairs: AgentConfiguredPair[]): Promise<void> {
  const defaultHotkey = config?.snapshotHotkey || 'F8';
  const resolvedPairs = nextPairs
    .filter((pair) => pair.pairKey && pair.videoDeviceId && pair.audioDeviceId)
    .map((pair) => ({
      ...pair,
      snapshotHotkey: pair.snapshotHotkey || defaultHotkey,
    }));
  const activeExists = resolvedPairs.some((pair) => pair.pairKey === config?.activePairKey);
  await persistConfig({
    configuredPairs: resolvedPairs,
    activePairKey: activeExists ? config?.activePairKey || '' : resolvedPairs[0]?.pairKey || '',
  });
  await syncSnapshotIfConnected();
}

function normalizedBackendUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function serializeHotkey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');

  let key = event.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

function hotkeyMatches(event: KeyboardEvent, hotkey: string): boolean {
  return serializeHotkey(event) === hotkey;
}

function setSnapshotStatus(text: string): void {
  snapshotStatusText.textContent = text;
}

function pickActiveRecordingSession(pairKey?: string | null): AgentRecordingSession | null {
  const sessions = Array.from(activeRecordingSessions.values());
  if (!sessions.length) return null;
  if (pairKey) {
    return sessions.find((session) => session.pair.pairKey === pairKey) || null;
  }
  return sessions[sessions.length - 1] || null;
}

function findRecordingSessionByHotkey(event: KeyboardEvent): AgentRecordingSession | null {
  const sessions = Array.from(activeRecordingSessions.values());
  return sessions.find((session) => session.pair.snapshotHotkey && hotkeyMatches(event, session.pair.snapshotHotkey)) || null;
}

async function uploadDentalSnapshotFromSession(session: AgentRecordingSession, frame: { blob: Blob; mimeType: string; capturedAt: string }): Promise<void> {
  if (!config?.agentToken) {
    throw new Error('Agent token is missing.');
  }

  const encrypted = await encryptBlobForTransport(frame.blob, config.transportKey || 'oradent-capture-transport');
  const formData = new FormData();
  const originalFileName = `dental-snapshot-${session.appointmentId}-${Date.now()}.jpg`;
  formData.append('image', encrypted.encryptedBlob, `${originalFileName}.enc`);
  formData.append('appointmentId', session.appointmentId);
  formData.append('cabinetDeviceId', session.cabinetDeviceId);
  formData.append('pairKey', session.pair.pairKey);
  formData.append('capturedAt', frame.capturedAt);
  formData.append('mimeType', frame.mimeType);
  formData.append('originalFileName', originalFileName);
  formData.append('sha256Hash', encrypted.sha256Hash);
  formData.append('transportIv', encrypted.transportIv);
  formData.append('transportAuthTag', encrypted.transportAuthTag);

  const response = await fetch(`${normalizedBackendUrl(config.backendUrl)}/dental-chart/agent-snapshot`, {
    method: 'POST',
    headers: {
      'x-agent-token': config.agentToken,
    },
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => 'Snapshot upload failed.');
    throw new Error(message || 'Snapshot upload failed.');
  }
}

async function captureDentalSnapshot(pairKey?: string | null): Promise<void> {
  const session = pickActiveRecordingSession(pairKey);
  if (!session) {
    setSnapshotStatus('Знімок можна зробити тільки під час активного запису прийому.');
    toast('Активного запису прийому немає', 'error');
    return;
  }

  if (snapshotInFlight) return;

  snapshotInFlight = true;
  updateControls();
  setSnapshotStatus('Створення знімка…');

  let video: HTMLVideoElement | null = null;
  try {
    video = await createVideoElementForStream(session.stream);
    const frame = await encodePreviewFrameBlob(video, { width: 1280, quality: 0.92, mimeType: 'image/jpeg' });
    await uploadDentalSnapshotFromSession(session, frame);
    setSnapshotStatus(`Знімок збережено: ${session.pair.videoLabel} · ${new Date(frame.capturedAt).toLocaleTimeString('uk-UA')}`);
    toast('Знімок відправлено у зубну карту', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не вдалося зробити знімок.';
    setSnapshotStatus(message);
    toast(message, 'error');
  } finally {
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    snapshotInFlight = false;
    updateControls();
  }
}

async function resetEnrollmentState(reason?: string): Promise<void> {
  await window.agentApi.disconnectSocket().catch(() => ({ ok: false }));
  updateSocketBadge('Не підключено', 'idle');
  await persistConfig({
    agentId: '',
    agentKey: '',
    agentToken: '',
  });
  if (reason) {
    setStatusLine(reason);
  }
}

function updatePermissionBadges(): void {
  const cameraLabel = permissionState.camera === 'granted'
    ? 'Камера: доступ є'
    : permissionState.camera === 'denied'
      ? 'Камера: доступ заборонено'
      : 'Камера: немає доступу';
  const microphoneLabel = permissionState.microphone === 'granted'
    ? 'Мікрофон: доступ є'
    : permissionState.microphone === 'denied'
      ? 'Мікрофон: доступ заборонено'
      : 'Мікрофон: немає доступу';

  setBadge(cameraPermissionBadge, cameraLabel, permissionState.camera === 'granted' ? 'ok' : permissionState.camera === 'denied' ? 'error' : 'idle');
  setBadge(microphonePermissionBadge, microphoneLabel, permissionState.microphone === 'granted' ? 'ok' : permissionState.microphone === 'denied' ? 'error' : 'idle');
}

function updateBackendBadge(text: string, variant: 'idle' | 'ok' | 'error' | 'busy'): void {
  backendState = variant === 'ok' ? 'ok' : variant === 'error' ? 'error' : variant === 'busy' ? 'busy' : 'idle';
  setBadge(backendStateBadge, text, variant);
  renderTopStatus();
}

function updateRegistrationBadge(): void {
  const registered = Boolean(config?.agentId && config?.agentToken && config?.agentKey);
  setBadge(registrationStateBadge, registered ? 'Зареєстровано' : 'Не зареєстровано', registered ? 'ok' : 'idle');
}

function updateSocketBadge(text: string, variant: 'idle' | 'connected' | 'disconnected' | 'error' | 'connecting'): void {
  socketState = variant === 'connecting'
    ? 'connecting'
    : variant === 'connected'
      ? 'connected'
      : variant === 'disconnected'
        ? 'disconnected'
        : variant === 'error'
          ? 'error'
          : 'idle';
  setBadge(socketStateBadge, text, variant === 'connected' ? 'connected' : variant === 'disconnected' ? 'disconnected' : variant === 'error' ? 'error' : variant === 'connecting' ? 'busy' : 'idle');
  renderTopStatus();
}

function renderTopStatus(): void {
  if (socketState === 'connected') {
    setBadge(globalStatusBadge, 'Підключено', 'connected');
    return;
  }
  if (socketState === 'connecting') {
    setBadge(globalStatusBadge, 'Підключення…', 'busy');
    return;
  }
  if (backendState === 'error' || socketState === 'error') {
    setBadge(globalStatusBadge, 'Помилка', 'error');
    return;
  }
  if ((config?.configuredPairs?.length || 0) > 0) {
    setBadge(globalStatusBadge, 'Готовий', 'ok');
    return;
  }
  setBadge(globalStatusBadge, 'Очікування', 'idle');
}

function renderPairBuilderOptions(): void {
  const videos = getVideoInputs();
  const audios = getAudioInputs();

  const renderOptions = (select: HTMLSelectElement, devices: MediaDeviceInfo[], emptyText: string) => {
    select.innerHTML = '';
    if (!devices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = emptyText;
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    select.disabled = false;
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = optionLabel(device, index);
      select.appendChild(option);
    });
  };

  const previousVideoValue = videoSelect.value;
  const previousAudioValue = audioSelect.value;

  renderOptions(videoSelect, videos, 'Немає камер');
  renderOptions(audioSelect, audios, 'Немає мікрофонів');

  if (videos.some((device) => device.deviceId === previousVideoValue)) {
    videoSelect.value = previousVideoValue;
  }
  if (audios.some((device) => device.deviceId === previousAudioValue)) {
    audioSelect.value = previousAudioValue;
  }

}

function updateControls(): void {
  const pair = activePair();
  const hasVideo = Boolean(pair?.videoDeviceId);
  const hasAudio = Boolean(pair?.audioDeviceId);
  const isRecording = Boolean(mediaRecorder && mediaRecorder.state === 'recording');
  const canBuildPairs = Boolean(videoSelect.value && audioSelect.value);

  stopPreviewBtn.disabled = !previewStream;
  startMicTestBtn.disabled = !hasAudio && !isRecording;
  playMicTestBtn.disabled = !recordedAudioUrl;
  disconnectSocketBtn.disabled = socketState !== 'connected' && socketState !== 'connecting';
  addPairBtn.disabled = !canBuildPairs;
  autofillPairsBtn.disabled = !getVideoInputs().length || !getAudioInputs().length;
  manualSnapshotBtn.disabled = activeRecordingSessions.size === 0 || snapshotInFlight;
  recordDot.style.opacity = isRecording ? '1' : '0.7';

  if (!hasVideo && !previewStream) {
    previewPlaceholder.textContent = 'Оберіть активну пару';
  }
}

function syncUiWithConfig(): void {
  if (!config) {
    return;
  }

  backendUrlInput.value = config.backendUrl || '';
  snapshotHotkeyInput.value = config.snapshotHotkey || '';
  cabinetCodeInput.value = config.cabinetCode || '';
  updateRegistrationBadge();
  renderPairBuilderOptions();
  renderPairs();
  updateControls();
}

function renderPairs(): void {
  const pairs = buildPairs();
  pairsCountText.textContent = String(pairs.length);
  pairsContainer.innerHTML = '';

  if (!pairs.length) {
    const empty = document.createElement('div');
    empty.className = 'pair-card';
    empty.innerHTML = '<div class="pair-card__title">Пари відсутні</div><div class="pair-card__meta">Створи одну або кілька пар вручну, або натисни «Усі комбінації».</div>';
    pairsContainer.appendChild(empty);
    return;
  }

  pairs.forEach((pair) => {
    const card = document.createElement('div');
    const isActive = pair.pairKey === (config?.activePairKey || '');
    card.className = `pair-card${isActive ? ' is-active' : ''}`;

    const title = document.createElement('div');
    title.className = 'pair-card__title';
    title.textContent = `${pair.videoLabel} + ${pair.audioLabel}`;

    const meta = document.createElement('div');
    meta.className = 'pair-card__meta';
    meta.innerHTML = `<div>${pair.videoLabel}</div><div>${pair.audioLabel}</div>`;

    const actions = document.createElement('div');
    actions.className = 'pair-card__actions';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'button button--secondary button--small';
    selectBtn.textContent = isActive ? 'Активна' : 'Активувати';
    selectBtn.disabled = isActive;
    selectBtn.addEventListener('click', () => {
      void setActivePair(pair.pairKey);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'button button--ghost button--small';
    removeBtn.textContent = 'Видалити';
    removeBtn.addEventListener('click', () => {
      void removeConfiguredPair(pair.pairKey);
    });

    const hotkeyRow = document.createElement('div');
    hotkeyRow.className = 'pair-card__hotkey';

    const hotkeyText = document.createElement('span');
    hotkeyText.textContent = `Знімок: ${pair.snapshotHotkey || 'не задано'}`;

    const setHotkeyBtn = document.createElement('button');
    setHotkeyBtn.type = 'button';
    setHotkeyBtn.className = 'button button--ghost button--small';
    setHotkeyBtn.textContent = 'Кнопка знімка';
    setHotkeyBtn.addEventListener('click', () => {
      awaitingSnapshotHotkey = false;
      awaitingSnapshotHotkeyPairKey = pair.pairKey;
      setSnapshotStatus(`Натисніть кнопку для знімка камери: ${pair.videoLabel}`);
      toast('Очікую кнопку для цієї камери…', 'info');
    });

    hotkeyRow.append(hotkeyText, setHotkeyBtn);

    actions.append(selectBtn, removeBtn);
    card.append(title, meta, hotkeyRow, actions);
    pairsContainer.appendChild(card);
  });
}



function buildRecordingKey(appointmentId: string, cabinetDeviceId: string): string {
  return `${appointmentId}::${cabinetDeviceId}`;
}

function pickRecordingMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const mimeType of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return 'video/webm';
}

function resolveRecordingPair(payload: Record<string, unknown>): PairView | null {
  const cameraDeviceId = String(payload.cameraDeviceId || '').trim();
  const microphoneDeviceId = String(payload.microphoneDeviceId || '').trim();
  const requestedPairKey = String(payload.pairKey || '').trim();

  const pairs = buildPairs();
  if (requestedPairKey) {
    const byKey = pairs.find((pair) => pair.pairKey === requestedPairKey);
    if (byKey) return byKey;
  }

  if (cameraDeviceId || microphoneDeviceId) {
    const byDevices = pairs.find((pair) => pair.videoDeviceId === cameraDeviceId && pair.audioDeviceId === microphoneDeviceId);
    if (byDevices) return byDevices;
  }

  if (cameraDeviceId && microphoneDeviceId) {
    return {
      pairKey: requestedPairKey || `${cameraDeviceId}::${microphoneDeviceId}`,
      displayName: String(payload.deviceName || makeDefaultPairName(cameraDeviceId, microphoneDeviceId)),
      videoDeviceId: cameraDeviceId,
      videoLabel: findDeviceLabel('videoinput', cameraDeviceId),
      audioDeviceId: microphoneDeviceId,
      audioLabel: findDeviceLabel('audioinput', microphoneDeviceId),
      snapshotHotkey: config?.snapshotHotkey || 'F8',
    };
  }

  return null;
}

async function startAgentRecordingSession(payload: Record<string, unknown>): Promise<void> {
  const appointmentId = String(payload.appointmentId || '').trim();
  const cabinetDeviceId = String(payload.cabinetDeviceId || '').trim();
  if (!appointmentId || !cabinetDeviceId) {
    throw new Error('Невірна команда старту запису: відсутній appointmentId або cabinetDeviceId.');
  }

  const recordingKey = buildRecordingKey(appointmentId, cabinetDeviceId);
  if (activeRecordingSessions.has(recordingKey)) {
    return;
  }

  const pair = resolveRecordingPair(payload);
  if (!pair) {
    throw new Error('Не вдалося знайти або зібрати пару пристроїв для запису.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(pair.videoDeviceId, 'local'),
    audio: pair.audioDeviceId ? { deviceId: { exact: pair.audioDeviceId } } : false,
  });

  const startedAt = String(payload.startedAt || new Date().toISOString());
  const mimeType = pickRecordingMimeType();
  const recorderOptions: MediaRecorderOptions = {
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  };

  if (mimeType) {
    recorderOptions.mimeType = mimeType;
  }

  const recorder = new MediaRecorder(stream, recorderOptions);
  const originalFileName = `appointment-${appointmentId}-${cabinetDeviceId}-${Date.now()}.webm`;

  let uploadEntryId = '';

  try {
    const uploadEntry = await window.agentApi.beginRecordingUpload({
      appointmentId,
      cabinetDeviceId,
      pairKey: pair.pairKey,
      mimeType: recorder.mimeType || mimeType || 'video/webm',
      originalFileName,
      startedAt,
    });

    uploadEntryId = uploadEntry.entryId;
  } catch (error) {
    stopMediaStream(stream);
    throw error;
  }

  const session: AgentRecordingSession = {
    recordingKey,
    appointmentId,
    cabinetDeviceId,
    pair,
    stream,
    recorder,
    uploadEntryId,
    pendingWrite: Promise.resolve(),
    totalBytes: 0,
    stopReason: null,
    maxDurationTimerId: null,
    startedAt,
    mimeType: recorder.mimeType || mimeType || 'video/webm',
    originalFileName,
  };

  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size <= 0) {
      return;
    }

    session.totalBytes += event.data.size;

    if (session.totalBytes > MAX_RECORDING_BYTES) {
      setStatusLine(`Запис ${pair.displayName} зупиняється: досягнуто безпечний локальний ліміт розміру.`);
      toast(`Запис ${pair.displayName} автоматично зупинено за лімітом розміру.`, 'info');
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      return;
    }

    const chunk = event.data;
    session.pendingWrite = session.pendingWrite
      .then(async () => {
        const buffer = await chunk.arrayBuffer();
        await window.agentApi.appendRecordingChunk({
          entryId: session.uploadEntryId,
          buffer,
        });
      })
      .catch((error) => {
        session.stopReason = error instanceof Error ? error.message : 'Не вдалося записати фрагмент відео на диск.';
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      });
  };

  recorder.onerror = () => {
    session.stopReason = `Помилка локального запису для ${pair.displayName}.`;
    toast(session.stopReason, 'error');
  };

  recorder.onstop = async () => {
    if (session.maxDurationTimerId !== null) {
      window.clearTimeout(session.maxDurationTimerId);
      session.maxDurationTimerId = null;
    }

    try {
      await session.pendingWrite;

      if (session.stopReason) {
        await window.agentApi.discardRecordingUpload({ entryId: session.uploadEntryId });
        throw new Error(session.stopReason);
      }

      await window.agentApi.finalizeRecordingUpload({
        entryId: session.uploadEntryId,
        endedAt: new Date().toISOString(),
      });

      setStatusLine(`Запис ${session.pair.displayName} збережено локально та поставлено в чергу на відправку.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не вдалося поставити запис у чергу.';
      setStatusLine(message);
      toast(message, 'error');
    } finally {
      stopMediaStream(session.stream);
      activeRecordingSessions.delete(recordingKey);
      updateControls();
    }
  };

  session.maxDurationTimerId = window.setTimeout(() => {
    if (recorder.state !== 'inactive') {
      setStatusLine(`Запис ${pair.displayName} автоматично зупиняється за лімітом часу.`);
      toast(`Запис ${pair.displayName} автоматично зупинено за лімітом часу.`, 'info');
      recorder.stop();
    }
  }, MAX_RECORDING_DURATION_MS);

  activeRecordingSessions.set(recordingKey, session);
  updateControls();
  recorder.start(RECORDING_TIMESLICE_MS);
  setStatusLine(`Іде запис: ${pair.displayName}. Відео пишеться фрагментами на диск, без накопичення всього файлу в RAM.`);
  toast(`Почато локальний запис: ${pair.displayName}`, 'info');
}

async function stopAgentRecordingSession(payload: Record<string, unknown>): Promise<void> {
  const appointmentId = String(payload.appointmentId || '').trim();
  const cabinetDeviceId = String(payload.cabinetDeviceId || '').trim();
  if (!appointmentId || !cabinetDeviceId) {
    return;
  }

  const recordingKey = buildRecordingKey(appointmentId, cabinetDeviceId);
  const session = activeRecordingSessions.get(recordingKey);
  if (!session) {
    return;
  }

  if (session.recorder.state !== 'inactive') {
    session.recorder.stop();
  }
}

function buildVideoConstraints(deviceId: string, profile: 'local' | 'remote' = 'local'): MediaTrackConstraints {
  const isLocalRecording = profile === 'local';

  return {
    deviceId: { exact: deviceId },
    width: isLocalRecording ? { ideal: 1280, max: 1280 } : { ideal: 960, max: 960 },
    height: isLocalRecording ? { ideal: 720, max: 720 } : { ideal: 540, max: 540 },
    frameRate: isLocalRecording ? { ideal: 18, max: 20 } : { ideal: 8, max: 12 },
    facingMode: 'user',
  };
}

function clampPreviewWidth(value: number, fallback: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(320, Math.min(960, normalized || fallback));
}

function clampPreviewQuality(value: number, fallback: number): number {
  const normalized = Number.isFinite(value) ? value : fallback;
  return Math.max(0.45, Math.min(0.9, normalized || fallback));
}

function clampPreviewFps(value: number, fallback = 8): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(2, Math.min(6, normalized || fallback));
}

function normalizePreviewMimeType(value: unknown, fallback = 'image/webp'): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'image/jpeg' || normalized === 'image/webp' ? normalized : fallback;
}

function disposeContinuousPreviewResources(state: ContinuousPreviewState | null): void {
  if (!state) {
    return;
  }

  if (state.timer !== null) {
    window.clearTimeout(state.timer);
    state.timer = null;
  }

  if (state.ownsStream) {
    stopMediaStream(state.stream);
  }
  state.stream = null;

  if (state.video) {
    state.video.pause();
    state.video.srcObject = null;
  }

  state.video = null;
  state.canvas = null;
  state.context = null;
  state.sending = false;
  state.stopped = true;
}

function stopContinuousPreview(pairKey?: string): void {
  if (!continuousPreviewState) {
    return;
  }

  if (pairKey && continuousPreviewState.pairKey !== pairKey) {
    return;
  }

  disposeContinuousPreviewResources(continuousPreviewState);
  continuousPreviewState = null;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Не вдалося перетворити preview-кадр у data URL.'));
    };
    reader.onerror = () => reject(new Error('Помилка читання preview-кадру.'));
    reader.readAsDataURL(blob);
  });
}


function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return bufferToHex(await crypto.subtle.digest('SHA-256', buffer));
}

async function encryptBlobForTransport(blob: Blob, secret: string): Promise<{
  encryptedBlob: Blob;
  sha256Hash: string;
  transportIv: string;
  transportAuthTag: string;
}> {
  const plainBuffer = await blob.arrayBuffer();
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret || 'oradent-capture-transport'));
  const key = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedWithTag = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plainBuffer));
  const tagLength = 16;
  const encryptedBytes = encryptedWithTag.slice(0, Math.max(0, encryptedWithTag.length - tagLength));
  const tagBytes = encryptedWithTag.slice(Math.max(0, encryptedWithTag.length - tagLength));
  const encryptedArrayBuffer = encryptedBytes.buffer.slice(
    encryptedBytes.byteOffset,
    encryptedBytes.byteOffset + encryptedBytes.byteLength,
  ) as ArrayBuffer;

  return {
    encryptedBlob: new Blob([encryptedArrayBuffer], { type: 'application/octet-stream' }),
    sha256Hash: await sha256Hex(plainBuffer),
    transportIv: bytesToBase64(iv),
    transportAuthTag: bytesToBase64(tagBytes),
  };
}

async function encodePreviewFrameBlob(
  video: HTMLVideoElement,
  options?: { width?: number; quality?: number; mimeType?: string; canvas?: HTMLCanvasElement | null; context?: CanvasRenderingContext2D | null },
): Promise<{ blob: Blob; mimeType: string; capturedAt: string }> {
  const sourceWidth = Math.max(1, video.videoWidth || video.clientWidth || 640);
  const sourceHeight = Math.max(1, video.videoHeight || video.clientHeight || 360);
  const targetWidth = clampPreviewWidth(Number(options?.width || sourceWidth), sourceWidth);
  const targetHeight = Math.max(200, Math.round((sourceHeight / sourceWidth) * targetWidth));
  const mimeType = normalizePreviewMimeType(options?.mimeType, 'image/jpeg');
  const quality = clampPreviewQuality(Number(options?.quality || 0.82), 0.82);
  const canvas = options?.canvas || document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = options?.context || canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas недоступний для формування preview.');
  }

  context.drawImage(video, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
          return;
        }
        reject(new Error('Не вдалося стиснути preview-кадр.'));
      },
      mimeType,
      quality,
    );
  });

  return {
    blob,
    mimeType,
    capturedAt: new Date().toISOString(),
  };
}

async function encodePreviewFrame(
  video: HTMLVideoElement,
  options?: { width?: number; quality?: number; mimeType?: string; canvas?: HTMLCanvasElement | null; context?: CanvasRenderingContext2D | null },
): Promise<EncodedPreviewFrame> {
  const encoded = await encodePreviewFrameBlob(video, options);

  return {
    imageDataUrl: await readBlobAsDataUrl(encoded.blob),
    mimeType: encoded.mimeType,
    capturedAt: encoded.capturedAt,
  };
}

async function encodePreviewFrameBinary(
  video: HTMLVideoElement,
  options?: { width?: number; quality?: number; mimeType?: string; canvas?: HTMLCanvasElement | null; context?: CanvasRenderingContext2D | null },
): Promise<BinaryPreviewFrame> {
  const encoded = await encodePreviewFrameBlob(video, options);

  return {
    imageBytes: new Uint8Array(await encoded.blob.arrayBuffer()),
    mimeType: encoded.mimeType,
    capturedAt: encoded.capturedAt,
  };
}

async function createVideoElementForStream(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  await waitForVideoReady(video);
  return video;
}

function findActiveRecordingSessionByPair(pair: PairView): AgentRecordingSession | null {
  for (const session of activeRecordingSessions.values()) {
    if (session.pair.pairKey === pair.pairKey) {
      return session;
    }
    if (session.pair.videoDeviceId === pair.videoDeviceId && session.pair.audioDeviceId === pair.audioDeviceId) {
      return session;
    }
  }
  return null;
}

async function createBackgroundPreviewVideo(pair: PairView): Promise<{ stream: MediaStream; video: HTMLVideoElement; ownsStream: boolean }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(pair.videoDeviceId, 'remote'),
    audio: false,
  });

  const video = await createVideoElementForStream(stream);
  return { stream, video, ownsStream: true };
}

async function ensureContinuousPreviewVideo(pair: PairView): Promise<{ stream: MediaStream | null; video: HTMLVideoElement; ownsStream: boolean }> {
  const recordingSession = findActiveRecordingSessionByPair(pair);
  if (recordingSession?.stream) {
    const video = await createVideoElementForStream(recordingSession.stream);
    return { stream: null, video, ownsStream: false };
  }

  const currentActivePair = activePair();
  if (previewStream && currentActivePair?.pairKey === pair.pairKey && previewVideo.readyState >= 2) {
    return { stream: null, video: previewVideo, ownsStream: false };
  }

  return createBackgroundPreviewVideo(pair);
}

async function pumpContinuousPreviewFrame(state: ContinuousPreviewState): Promise<void> {
  if (state.stopped || continuousPreviewState !== state || state.sending || !state.video) {
    return;
  }

  state.sending = true;
  try {
    const frame = await encodePreviewFrameBinary(state.video, {
      width: state.width,
      quality: state.quality,
      mimeType: state.mimeType,
      canvas: state.canvas,
      context: state.context,
    });

    const sent = await window.agentApi.sendPreviewFrame({
      pairKey: state.pairKey,
      imageBytes: frame.imageBytes,
      mimeType: frame.mimeType,
      capturedAt: frame.capturedAt,
    });

    if (!sent.ok) {
      return;
    }
  } finally {
    state.sending = false;
  }
}

function scheduleContinuousPreviewTick(state: ContinuousPreviewState): void {
  if (state.stopped || continuousPreviewState !== state) {
    return;
  }

  const delayMs = Math.max(60, Math.round(1000 / state.fps));
  state.timer = window.setTimeout(() => {
    void pumpContinuousPreviewFrame(state)
      .catch(() => undefined)
      .finally(() => {
        scheduleContinuousPreviewTick(state);
      });
  }, delayMs);
}

async function startContinuousPreview(pairKey: string, options?: { width?: number; quality?: number; fps?: number; mimeType?: string }): Promise<void> {
  const pair = buildPairs().find((item) => item.pairKey === pairKey);
  if (!pair?.videoDeviceId) {
    throw new Error('Пара для потокового preview не знайдена або не містить камеру.');
  }

  stopContinuousPreview();

  const prepared = await ensureContinuousPreviewVideo(pair);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const state: ContinuousPreviewState = {
    pairKey,
    width: clampPreviewWidth(Number(options?.width || 720), 720),
    quality: clampPreviewQuality(Number(options?.quality || 0.68), 0.68),
    fps: clampPreviewFps(Number(options?.fps || 8), 8),
    mimeType: normalizePreviewMimeType(options?.mimeType, 'image/webp'),
    timer: null,
    stream: prepared.stream,
    ownsStream: prepared.ownsStream,
    video: prepared.video,
    canvas,
    context,
    sending: false,
    stopped: false,
  };

  if (!state.context) {
    disposeContinuousPreviewResources(state);
    throw new Error('Canvas недоступний для потокового preview.');
  }

  continuousPreviewState = state;
  scheduleContinuousPreviewTick(state);
}

function buildPreviewSessionKey(setupSessionId: string | undefined, pairKey: string, previewSessionId?: string): string {
  if (previewSessionId) return `preview:${previewSessionId}`;
  return `setup:${setupSessionId || ''}:${pairKey}`;
}

async function stopWebRtcPreview(sessionKey?: string): Promise<void> {
  if (!webRtcPreviewState) {
    return;
  }

  if (sessionKey && webRtcPreviewState.sessionKey !== sessionKey) {
    return;
  }

  const current = webRtcPreviewState;
  webRtcPreviewState = null;

  try {
    current.pc.onicecandidate = null;
    current.pc.onconnectionstatechange = null;
    current.pc.oniceconnectionstatechange = null;
    current.pc.close();
  } catch {
    // noop
  }

  if (current.ownsStream) {
    stopMediaStream(current.stream);
  }
}

async function handlePreviewSignal(payload: PreviewSignalPayload): Promise<void> {
  const setupSessionId = String(payload.setupSessionId || '').trim() || undefined;
  const previewSessionId = String(payload.previewSessionId || '').trim() || undefined;
  const pairKey = String(payload.pairKey || '').trim();

  if (!pairKey || (!setupSessionId && !previewSessionId)) {
    return;
  }

  const description = payload.description;
  const candidate = payload.candidate;
  const sessionKey = buildPreviewSessionKey(setupSessionId, pairKey, previewSessionId);

  const sendSignal = async (message: Record<string, unknown>) => {
    await window.agentApi.sendPreviewSignal({
      ...(setupSessionId ? { setupSessionId } : {}),
      ...(previewSessionId ? { previewSessionId } : {}),
      pairKey,
      ...message,
    });
  };

  if (description?.type === 'offer') {
    await stopWebRtcPreview(sessionKey);

    const pair = buildPairs().find((item) => item.pairKey === pairKey);
    if (!pair?.videoDeviceId) {
      throw new Error('Пара для WebRTC preview не знайдена або не містить камеру.');
    }

    const recordingSession = findActiveRecordingSessionByPair(pair);
    const stream = recordingSession?.stream || await navigator.mediaDevices.getUserMedia({
      video: buildVideoConstraints(pair.videoDeviceId, 'remote'),
      audio: false,
    });
    const ownsStream = !recordingSession?.stream;

    const pc = new RTCPeerConnection(PREVIEW_RTC_CONFIGURATION);
    const state: WebRtcPreviewState = {
      sessionKey,
      setupSessionId,
      previewSessionId,
      pairKey,
      pc,
      stream,
      ownsStream,
    };

    webRtcPreviewState = state;

    pc.onicecandidate = (event) => {
      if (!event.candidate || webRtcPreviewState?.sessionKey !== sessionKey) {
        return;
      }

      void sendSignal({ candidate: event.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      const connectionState = pc.connectionState;
      if (connectionState === 'connected') {
        setStatusLine('WebRTC preview підключено.');
        return;
      }

      if (connectionState === 'failed' || connectionState === 'closed' || connectionState === 'disconnected') {
        void stopWebRtcPreview(sessionKey);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceConnectionState = pc.iceConnectionState;
      if (iceConnectionState === 'failed' || iceConnectionState === 'closed' || iceConnectionState === 'disconnected') {
        void stopWebRtcPreview(sessionKey);
      }
    };

    stream.getVideoTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    await pc.setRemoteDescription(description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await sendSignal({
      description: pc.localDescription
        ? {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp || undefined,
          }
        : answer,
    });
    return;
  }

  const current = webRtcPreviewState;
  if (!current || current.sessionKey !== sessionKey) {
    return;
  }

  if (description) {
    await current.pc.setRemoteDescription(description);
    return;
  }

  if (candidate) {
    await current.pc.addIceCandidate(candidate);
  }
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function clearPreview(): void {
  stopContinuousPreview(activePair()?.pairKey);
  stopMediaStream(previewStream);
  previewStream = null;
  previewVideo.srcObject = null;
  previewVideo.closest('.video-frame')?.classList.remove('has-video');
  previewPlaceholder.textContent = 'Оберіть активну пару';
  updateControls();
}

async function startPreviewForActivePair(): Promise<void> {
  clearPreview();

  const pair = activePair();
  if (!pair?.videoDeviceId) {
    previewPlaceholder.textContent = 'Немає камери для preview';
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('У системі недоступний доступ до медіапристроїв.');
  }

  try {
    previewStream = await navigator.mediaDevices.getUserMedia({
      video: buildVideoConstraints(pair.videoDeviceId, 'local'),
      audio: false,
    });
    previewVideo.srcObject = previewStream;
    await previewVideo.play();
    previewVideo.closest('.video-frame')?.classList.add('has-video');
    await refreshPermissionState();
  } catch (error) {
    previewPlaceholder.textContent = error instanceof Error ? error.message : 'Помилка preview';
    throw error;
  } finally {
    updateControls();
  }
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Не вдалося вчасно підготувати відеоджерело.')); }, 2200);
    const cleanup = () => { window.clearTimeout(timer); video.removeEventListener('loadeddata', onLoaded); video.removeEventListener('error', onError); };
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Не вдалося відкрити відеоджерело для preview.')); };
    if (video.readyState >= 2) { cleanup(); resolve(); return; }
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function capturePreviewForPair(pairKey: string, width = 960, quality = 0.82) {
  const pair = buildPairs().find((item) => item.pairKey === pairKey);
  if (!pair?.videoDeviceId) throw new Error('Пара для preview не знайдена або не містить камеру.');

  const currentActivePair = activePair();
  if (previewStream && currentActivePair?.pairKey === pairKey && previewVideo.readyState >= 2) {
    return encodePreviewFrame(previewVideo, {
      width,
      quality,
      mimeType: 'image/jpeg',
    });
  }

  if (!navigator.mediaDevices?.getUserMedia) throw new Error('У системі недоступний доступ до відеопристроїв.');

  let tempStream: MediaStream | null = null;
  const tempVideo = document.createElement('video');
  tempVideo.autoplay = true;
  tempVideo.muted = true;
  tempVideo.playsInline = true;

  try {
    tempStream = await navigator.mediaDevices.getUserMedia({
      video: buildVideoConstraints(pair.videoDeviceId, 'remote'),
      audio: false,
    });
    tempVideo.srcObject = tempStream;
    await tempVideo.play().catch(() => undefined);
    await waitForVideoReady(tempVideo);
    return encodePreviewFrame(tempVideo, {
      width,
      quality,
      mimeType: 'image/jpeg',
    });
  } finally {
    stopMediaStream(tempStream);
    tempVideo.srcObject = null;
  }
}

function stopMicTestPlayback(): void {
  if (recordedAudioUrl) {
    URL.revokeObjectURL(recordedAudioUrl);
    recordedAudioUrl = '';
  }
  micPlaybackAudio.pause();
  micPlaybackWrap.hidden = true;
  micPlaybackAudio.hidden = true;
  micPlaybackAudio.src = '';
  micTestMeta.textContent = 'Немає запису';
  playMicTestBtn.disabled = true;
  updateControls();
}

function resetMeter(): void {
  micMeterFill.style.width = '0%';
  meterPercentText.textContent = '0%';
}

function stopMeter(): void {
  if (analyserFrame) {
    cancelAnimationFrame(analyserFrame);
    analyserFrame = 0;
  }
  if (analyserSource) {
    analyserSource.disconnect();
    analyserSource = null;
  }
  if (audioContext) {
    void audioContext.close().catch(() => undefined);
    audioContext = null;
  }
  analyser = null;
  resetMeter();
}

function startMeter(stream: MediaStream): void {
  stopMeter();
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyserSource = audioContext.createMediaStreamSource(stream);
  analyserSource.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  const tick = (): void => {
    if (!analyser) {
      return;
    }

    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const centered = (data[index] - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    const percent = Math.max(0, Math.min(100, Math.round(rms * 180)));
    micMeterFill.style.width = `${percent}%`;
    meterPercentText.textContent = `${percent}%`;
    analyserFrame = requestAnimationFrame(tick);
  };

  tick();
}

function stopMicTestStream(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  stopMediaStream(micTestStream);
  micTestStream = null;
  stopMeter();
  recordButtonText.textContent = 'Почати тест';
  updateControls();
}

async function startMicTestRecording(): Promise<void> {
  const pair = activePair();
  if (!pair?.audioDeviceId) {
    throw new Error('У активній парі немає мікрофона.');
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Тест мікрофона недоступний у цій системі.');
  }

  stopMicTestPlayback();
  stopMicTestStream();

  micTestStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: pair.audioDeviceId } },
    video: false,
  });

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(micTestStream);
  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
    stopMicTestPlayback();
    recordedAudioUrl = URL.createObjectURL(blob);
    micPlaybackAudio.src = recordedAudioUrl;
    micPlaybackWrap.hidden = true;
    micPlaybackAudio.hidden = true;
    micTestMeta.textContent = `Запис: ${Math.max(1, Math.round(blob.size / 1024))} КБ`;
    playMicTestBtn.disabled = false;
    stopMicTestStream();
  };

  mediaRecorder.start();
  startMeter(micTestStream);
  recordButtonText.textContent = 'Зупинити тест';
}

async function toggleMicTest(): Promise<void> {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  await startMicTestRecording();
}

function rawDeviceSnapshot(): RawDeviceSnapshot[] {
  return deviceInventory
    .filter((device) => device.kind === 'videoinput' || device.kind === 'audioinput')
    .map((device, index) => ({
      kind: device.kind as 'videoinput' | 'audioinput',
      deviceId: device.deviceId,
      label: optionLabel(device, index),
    }));
}

function pairSnapshots(): DevicePairSnapshot[] {
  return buildPairs().map((pair, index) => ({
    pairKey: pair.pairKey,
    displayName: pair.displayName,
    videoDeviceId: pair.videoDeviceId,
    videoLabel: pair.videoLabel,
    audioDeviceId: pair.audioDeviceId,
    audioLabel: pair.audioLabel,
    sortOrder: index,
  }));
}

function buildSnapshot(): DeviceSyncSnapshot {
  return {
    devices: rawDeviceSnapshot(),
    devicePairs: pairSnapshots(),
  };
}

async function syncSnapshotIfConnected(): Promise<void> {
  if (!config?.agentToken) {
    return;
  }

  await window.agentApi.syncSnapshot(buildSnapshot()).catch(() => undefined);
}

async function reconcileConfiguredPairs(): Promise<void> {
  if (!config) {
    return;
  }

  const hasInventory = getVideoInputs().length > 0 || getAudioInputs().length > 0;
  const validPairs = hasInventory
    ? (config.configuredPairs || []).filter((pair) => resolveConfiguredPair(pair))
    : (config.configuredPairs || []);
  const changed = hasInventory && validPairs.length !== (config.configuredPairs || []).length;
  if (changed) {
    await updateConfiguredPairs(validPairs);
    return;
  }

  renderPairBuilderOptions();
  renderPairs();
  updateControls();
}

async function warmDeviceLabels(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return;
  }

  const streams: MediaStream[] = [];
  try {
    const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => null);
    if (cameraStream) streams.push(cameraStream);

    const audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }).catch(() => null);
    if (audioStream) streams.push(audioStream);
  } finally {
    streams.forEach((stream) => stopMediaStream(stream));
  }
}

async function refreshDeviceInventory(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error('enumerateDevices недоступний у цій системі.');
  }

  await warmDeviceLabels().catch(() => undefined);
  deviceInventory = await navigator.mediaDevices.enumerateDevices();
  await reconcileConfiguredPairs();
}

async function requestMediaAccess(): Promise<AccessResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia недоступний у цій системі.');
  }

  const result: AccessResult = { camera: false, microphone: false };
  const streams: MediaStream[] = [];

  const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => null);
  if (cameraStream) {
    streams.push(cameraStream);
    result.camera = cameraStream.getVideoTracks().length > 0;
  }

  const audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }).catch(() => null);
  if (audioStream) {
    streams.push(audioStream);
    result.microphone = audioStream.getAudioTracks().length > 0;
  }

  streams.forEach((stream) => stopMediaStream(stream));
  await refreshPermissionState();
  await refreshDeviceInventory().catch(() => undefined);
  return result;
}

async function refreshPermissionState(): Promise<void> {
  if (!navigator.permissions?.query) {
    return;
  }

  try {
    const cameraPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
    permissionState.camera = cameraPermission.state as PermissionStateValue;
    cameraPermission.onchange = () => {
      permissionState.camera = cameraPermission.state as PermissionStateValue;
      updatePermissionBadges();
      renderTopStatus();
    };
  } catch {
    // noop
  }

  try {
    const microphonePermission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    permissionState.microphone = microphonePermission.state as PermissionStateValue;
    microphonePermission.onchange = () => {
      permissionState.microphone = microphonePermission.state as PermissionStateValue;
      updatePermissionBadges();
      renderTopStatus();
    };
  } catch {
    // noop
  }

  updatePermissionBadges();
  renderTopStatus();
}

async function setActivePair(pairKey: string): Promise<void> {
  await persistConfig({ activePairKey: pairKey });
  await startPreviewForActivePair().catch(() => undefined);
  stopMicTestPlayback();
  await syncSnapshotIfConnected();
  setStatusLine('Активну пару змінено.');
}

async function persistSetupFields(): Promise<void> {
  if (!config) {
    return;
  }

  const nextBackendUrl = normalizedBackendUrl(backendUrlInput.value);
  const nextCabinetCode = cabinetCodeInput.value.trim().toUpperCase();
  const backendChanged = normalizedBackendUrl(config.backendUrl || '') !== nextBackendUrl;
  const cabinetChanged = (config.cabinetCode || '').trim().toUpperCase() !== nextCabinetCode;

  backendUrlInput.value = nextBackendUrl;
  cabinetCodeInput.value = nextCabinetCode;

  if (backendChanged || cabinetChanged) {
    await resetEnrollmentState('Код кабінету або backend URL змінено. Потрібна повторна прив’язка агента.');
  }

  await persistConfig({
    backendUrl: nextBackendUrl,
    cabinetCode: nextCabinetCode,
  });
}

async function ensureBackendReachable(): Promise<void> {
  updateBackendBadge('Перевірка…', 'busy');
  const result = await window.agentApi.pingBackend();
  updateBackendBadge(result.ok ? 'Доступний' : 'Помилка', result.ok ? 'ok' : 'error');
}

async function removeConfiguredPair(pairKey: string): Promise<void> {
  if (!config) {
    return;
  }

  const nextPairs = (config.configuredPairs || []).filter((pair) => pair.pairKey !== pairKey);
  if (config.activePairKey === pairKey) {
    clearPreview();
    stopMicTestPlayback();
  }
  await updateConfiguredPairs(nextPairs);
  setStatusLine('Пару видалено.');
}

async function addPair(): Promise<void> {
  if (!config) {
    return;
  }

  const videoDeviceId = videoSelect.value;
  const audioDeviceId = audioSelect.value;

  if (!videoDeviceId || !audioDeviceId) {
    throw new Error('Оберіть камеру і мікрофон.');
  }

  const displayName = '';
  const alreadyExists = (config.configuredPairs || []).some(
    (pair) => pair.videoDeviceId === videoDeviceId && pair.audioDeviceId === audioDeviceId,
  );

  if (alreadyExists) {
    throw new Error('Така пара вже додана.');
  }

  await updateConfiguredPairs([
    ...(config.configuredPairs || []),
    {
      pairKey: makePairKey(),
      displayName,
      videoDeviceId,
      audioDeviceId,
      snapshotHotkey: config.snapshotHotkey || 'F8',
    },
  ]);

  setStatusLine('Пару додано.');
  toast('Пару додано.', 'success');
}

async function addAllCombinations(): Promise<void> {
  if (!config) {
    return;
  }

  const existingIdentities = new Set(
    (config.configuredPairs || []).map((pair) => `${pair.videoDeviceId}::${pair.audioDeviceId}`),
  );

  const snapshotHotkey = config.snapshotHotkey || 'F8';
  const additions: AgentConfiguredPair[] = [];
  getVideoInputs().forEach((video) => {
    getAudioInputs().forEach((audio) => {
      const identity = `${video.deviceId}::${audio.deviceId}`;
      if (existingIdentities.has(identity)) {
        return;
      }
      existingIdentities.add(identity);
      additions.push({
        pairKey: makePairKey(),
        displayName: '',
        videoDeviceId: video.deviceId,
        audioDeviceId: audio.deviceId,
        snapshotHotkey: snapshotHotkey,
      });
    });
  });

  if (!additions.length) {
    setStatusLine('Усі доступні комбінації вже додані.');
    toast('Нових комбінацій не знайдено.', 'info');
    return;
  }

  await updateConfiguredPairs([...(config.configuredPairs || []), ...additions]);
  setStatusLine(`Додано ${additions.length} комбінацій.`);
  toast(`Додано ${additions.length} комбінацій.`, 'success');
}

async function connectAgent(): Promise<void> {
  if (!config) {
    throw new Error('Конфіг не завантажено.');
  }

  await persistSetupFields();

  if (!config) {
    throw new Error('Конфіг не завантажено.');
  }

  if (!config.backendUrl.trim()) {
    throw new Error('Заповни Backend URL.');
  }
  if (!config.cabinetCode.trim()) {
    throw new Error('Заповни Cabinet code.');
  }
  if (pairSnapshots().length === 0) {
    throw new Error('Створи хоча б одну пару камера + мікрофон.');
  }

  await ensureBackendReachable();
  await window.agentApi.disconnectSocket().catch(() => ({ ok: false }));

  const hasStoredEnrollment = Boolean(config.agentId && config.agentKey && config.agentToken);

  if (!hasStoredEnrollment) {
    const enrollResult = await window.agentApi.enroll(buildSnapshot());
    config = enrollResult.config;
    syncUiWithConfig();
    setStatusLine(`Агент прив’язано до ${config.cabinetCode || '—'}.`);
    toast('Агент зареєстровано.', 'success');
  } else {
    setStatusLine(`Повторне підключення агента до ${config.cabinetCode || '—'}.`);
  }

  updateSocketBadge('Підключення…', 'connecting');
  await window.agentApi.connectSocket(buildSnapshot());
}

async function initialize(): Promise<void> {
  config = await window.agentApi.getConfig();
  syncUiWithConfig();
  await refreshPermissionState();
  updateBackendBadge('Не перевірено', 'idle');
  updateSocketBadge('Не підключено', 'idle');
  setStatusLine('Готово');
  renderTopStatus();

  await refreshDeviceInventory().catch(() => undefined);

  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    void refreshDeviceInventory()
      .then(() => syncSnapshotIfConnected())
      .catch(() => undefined);
  });
}

async function runWithBusy(button: HTMLButtonElement, text: string, callback: () => Promise<void>): Promise<void> {
  const previous = button.textContent || '';
  button.disabled = true;
  button.textContent = text;
  try {
    await callback();
  } finally {
    button.disabled = false;
    button.textContent = previous;
    updateControls();
  }
}

grantAccessBtn.addEventListener('click', () => {
  void runWithBusy(grantAccessBtn, 'Запит…', async () => {
    const access = await requestMediaAccess();
    await refreshDeviceInventory();
    await startPreviewForActivePair().catch(() => undefined);
    await syncSnapshotIfConnected();
    const message = access.camera && access.microphone
      ? 'Доступ до камери і мікрофона надано.'
      : access.camera
        ? 'Доступ надано лише до камери.'
        : 'Доступ надано лише до мікрофона.';
    setStatusLine(message);
    toast(message, 'success');
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Не вдалося отримати доступ.';
    permissionState.camera = 'denied';
    permissionState.microphone = 'denied';
    updatePermissionBadges();
    setStatusLine(message);
    toast(message, 'error');
  });
});

refreshDevicesBtn.addEventListener('click', () => {
  void runWithBusy(refreshDevicesBtn, 'Оновлення…', async () => {
    await refreshDeviceInventory();
    await startPreviewForActivePair().catch(() => undefined);
    await syncSnapshotIfConnected();
    setStatusLine('Список пристроїв оновлено.');
    toast('Список пристроїв оновлено.', 'success');
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Не вдалося оновити пристрої.';
    setStatusLine(message);
    toast(message, 'error');
  });
});

connectAgentBtn.addEventListener('click', () => {
  void runWithBusy(connectAgentBtn, 'Підключення…', async () => {
    await connectAgent();
    setStatusLine('Запит на підключення відправлено.');
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Не вдалося підключити агент.';
    updateSocketBadge('Помилка', 'error');
    setStatusLine(message);
    toast(message, 'error');
  });
});

disconnectSocketBtn.addEventListener('click', () => {
  void runWithBusy(disconnectSocketBtn, 'Відключення…', async () => {
    await window.agentApi.disconnectSocket();
    updateSocketBadge('Відключено', 'disconnected');
    setStatusLine('Агента відключено.');
    toast('Агента відключено.', 'info');
  }).catch((error) => {
    const message = error instanceof Error ? error.message : 'Не вдалося відключити агент.';
    setStatusLine(message);
    toast(message, 'error');
  });
});

addPairBtn.addEventListener('click', () => {
  void runWithBusy(addPairBtn, 'Додаємо…', addPair).catch((error) => {
    const message = error instanceof Error ? error.message : 'Не вдалося додати пару.';
    setStatusLine(message);
    toast(message, 'error');
  });
});

autofillPairsBtn.addEventListener('click', () => {
  void runWithBusy(autofillPairsBtn, 'Формуємо…', addAllCombinations).catch((error) => {
    const message = error instanceof Error ? error.message : 'Не вдалося сформувати комбінації.';
    setStatusLine(message);
    toast(message, 'error');
  });
});

videoSelect.addEventListener('change', () => {
  updateControls();
});

audioSelect.addEventListener('change', () => {
  updateControls();
});

backendUrlInput.addEventListener('change', () => {
  backendUrlInput.value = normalizedBackendUrl(backendUrlInput.value);
  void persistSetupFields().catch(() => undefined);
});

cabinetCodeInput.addEventListener('change', () => {
  cabinetCodeInput.value = cabinetCodeInput.value.trim().toUpperCase();
  void persistSetupFields().catch(() => undefined);
});

stopPreviewBtn.addEventListener('click', () => {
  clearPreview();
  setStatusLine('Preview зупинено.');
  toast('Preview зупинено.', 'info');
});

startMicTestBtn.addEventListener('click', () => {
  void toggleMicTest().catch((error) => {
    const message = error instanceof Error ? error.message : 'Не вдалося запустити тест мікрофона.';
    setStatusLine(message);
    toast(message, 'error');
  });
});

playMicTestBtn.addEventListener('click', () => {
  if (!recordedAudioUrl) {
    return;
  }
  micPlaybackWrap.hidden = false;
  micPlaybackAudio.hidden = false;
  void micPlaybackAudio.play().catch(() => undefined);
});

captureHotkeyBtn.addEventListener('click', () => {
  awaitingSnapshotHotkey = true;
  snapshotHotkeyInput.value = 'Натисніть кнопку…';
  setSnapshotStatus('Натисніть клавішу або комбінацію клавіш для знімка.');
});

manualSnapshotBtn.addEventListener('click', () => {
  void captureDentalSnapshot();
});

resetHotkeyBtn.addEventListener('click', () => {
  const nextPairs = (config?.configuredPairs || []).map((pair) => ({ ...pair, snapshotHotkey: 'F8' }));
  void persistConfig({ snapshotHotkey: 'F8', configuredPairs: nextPairs }).then(() => {
    setSnapshotStatus('Кнопки знімка скинуто на F8.');
    toast('Кнопки знімка скинуто на F8', 'info');
  });
});

window.addEventListener('keydown', (event) => {
  if (awaitingSnapshotHotkeyPairKey) {
    event.preventDefault();
    event.stopPropagation();
    const pairKey = awaitingSnapshotHotkeyPairKey;
    const nextHotkey = serializeHotkey(event);
    awaitingSnapshotHotkeyPairKey = null;
    const nextPairs = (config?.configuredPairs || []).map((pair) => (
      pair.pairKey === pairKey ? { ...pair, snapshotHotkey: nextHotkey } : pair
    ));
    void updateConfiguredPairs(nextPairs).then(() => {
      setSnapshotStatus(`Кнопку для камери збережено: ${nextHotkey}`);
      toast(`Кнопку знімка збережено: ${nextHotkey}`, 'success');
    });
    return;
  }

  if (awaitingSnapshotHotkey) {
    event.preventDefault();
    event.stopPropagation();
    const nextHotkey = serializeHotkey(event);
    awaitingSnapshotHotkey = false;
    void persistConfig({ snapshotHotkey: nextHotkey }).then(() => {
      setSnapshotStatus(`Кнопка за замовчуванням: ${nextHotkey} .`.replace(' .', '.'));
      toast(`Кнопку за замовчуванням збережено: ${nextHotkey}`, 'success');
    });
    return;
  }

  const matchedSession = findRecordingSessionByHotkey(event);
  if (matchedSession) {
    event.preventDefault();
    void captureDentalSnapshot(matchedSession.pair.pairKey);
    return;
  }

  const hotkey = config?.snapshotHotkey;
  if (hotkey && hotkeyMatches(event, hotkey)) {
    event.preventDefault();
    void captureDentalSnapshot();
  }
});

window.agentApi.onSocketCommand((message) => {
  const payload = message.payload || {};

  if (message?.type === 'preview.request') {
    void capturePreviewForPair(
      String(payload.pairKey || ''),
      Number(payload.width || 960),
      Number(payload.quality || 0.82),
    )
      .then((preview) => window.agentApi.sendPreviewResponse({
        requestId: payload.requestId,
        pairKey: payload.pairKey,
        imageDataUrl: preview.imageDataUrl,
        mimeType: preview.mimeType,
        capturedAt: preview.capturedAt,
      }))
      .catch((error) => window.agentApi.sendPreviewResponse({
        requestId: payload.requestId,
        pairKey: payload.pairKey,
        error: error instanceof Error ? error.message : 'Не вдалося сформувати preview.',
      }));
    return;
  }

  if (message?.type === 'preview.start') {
    void startContinuousPreview(String(payload.pairKey || ''), {
      width: Number(payload.width || 640),
      quality: Number(payload.quality || 0.6),
      fps: Number(payload.fps || 4),
      mimeType: normalizePreviewMimeType(payload.mimeType, 'image/webp'),
    }).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : 'Не вдалося запустити потоковий preview.';
      setStatusLine(errorMessage);
      toast(errorMessage, 'error');
    });
    return;
  }

  if (message?.type === 'preview.signal') {
    void handlePreviewSignal(payload as PreviewSignalPayload).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : 'Не вдалося обробити WebRTC preview-сигнал.';
      setStatusLine(errorMessage);
      toast(errorMessage, 'error');
      void window.agentApi.sendPreviewSignal({
        setupSessionId: payload.setupSessionId,
        previewSessionId: payload.previewSessionId,
        pairKey: payload.pairKey,
        error: errorMessage,
      });
    });
    return;
  }

  if (message?.type === 'preview.stop') {
    stopContinuousPreview(String(payload.pairKey || '') || undefined);
    void stopWebRtcPreview(
      buildPreviewSessionKey(String(payload.setupSessionId || '') || undefined, String(payload.pairKey || ''), String(payload.previewSessionId || '') || undefined),
    );
    return;
  }

  if (message?.type === 'recording.start') {
    void startAgentRecordingSession(payload).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : 'Не вдалося почати локальний запис.';
      setStatusLine(errorMessage);
      toast(errorMessage, 'error');
    });
    return;
  }

  if (message?.type === 'recording.stop') {
    void stopAgentRecordingSession(payload).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : 'Не вдалося зупинити локальний запис.';
      setStatusLine(errorMessage);
      toast(errorMessage, 'error');
    });
  }
});

window.agentApi.onSocketStatus((payload) => {
  if (payload.type === 'connected') {
    updateSocketBadge('Підключено', 'connected');
    setStatusLine(payload.message || 'Агент підключено.');
    toast(payload.message || 'Агент підключено.', 'success');
    return;
  }

  if (payload.type === 'connecting') {
    updateSocketBadge('Підключення…', 'connecting');
    setStatusLine(payload.message || 'Підключення…');
    return;
  }

  if (payload.type === 'disconnected') {
    stopContinuousPreview();
    void stopWebRtcPreview();
    updateSocketBadge('Відключено', 'disconnected');
    setStatusLine(payload.message || 'Агента відключено.');
    toast(payload.message || 'Агента відключено.', 'info');
    return;
  }

  if (payload.type === 'error') {
    stopContinuousPreview();
    void stopWebRtcPreview();
    updateSocketBadge('Помилка', 'error');
    setStatusLine(payload.message || 'Помилка websocket.');
    toast(payload.message || 'Помилка websocket.', 'error');
    return;
  }

  if (payload.message) {
    setStatusLine(payload.message);
  }
});

window.addEventListener('beforeunload', () => {
  stopContinuousPreview();
  clearPreview();
});

void initialize().catch((error) => {
  const message = error instanceof Error ? error.message : 'Не вдалося запустити агент.';
  setStatusLine(message);
  toast(message, 'error');
});

export {};
