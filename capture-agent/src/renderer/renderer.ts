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
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  context: CanvasRenderingContext2D | null;
  sending: boolean;
  stopped: boolean;
};

type PreviewSignalPayload = {
  setupSessionId?: string;
  pairKey?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type WebRtcPreviewState = {
  sessionKey: string;
  setupSessionId: string;
  pairKey: string;
  pc: RTCPeerConnection;
  stream: MediaStream | null;
};

const PREVIEW_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    {
      urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    },
  ],
};

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

const backendUrlInput = byId<HTMLInputElement>('backendUrlInput');
const cabinetCodeInput = byId<HTMLInputElement>('cabinetCodeInput');
const pairNameInput = byId<HTMLInputElement>('pairNameInput');
const videoSelect = byId<HTMLSelectElement>('videoSelect');
const audioSelect = byId<HTMLSelectElement>('audioSelect');

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
  const videoIndex = getVideoInputs().findIndex((item) => item.deviceId === pair.videoDeviceId);
  const audioIndex = getAudioInputs().findIndex((item) => item.deviceId === pair.audioDeviceId);
  const video = videoIndex >= 0 ? getVideoInputs()[videoIndex] : null;
  const audio = audioIndex >= 0 ? getAudioInputs()[audioIndex] : null;

  if (!video || !audio) {
    return null;
  }

  return {
    pairKey: pair.pairKey,
    displayName: pair.displayName || makeDefaultPairName(pair.videoDeviceId, pair.audioDeviceId),
    videoDeviceId: pair.videoDeviceId,
    videoLabel: optionLabel(video, videoIndex),
    audioDeviceId: pair.audioDeviceId,
    audioLabel: optionLabel(audio, audioIndex),
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
  const resolvedPairs = nextPairs.filter((pair) => pair.pairKey && pair.videoDeviceId && pair.audioDeviceId);
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

    actions.append(selectBtn, removeBtn);
    card.append(title, meta, actions);
    pairsContainer.appendChild(card);
  });
}


function buildVideoConstraints(deviceId: string, profile: 'local' | 'remote' = 'local'): MediaTrackConstraints {
  return {
    deviceId: { exact: deviceId },
    width: profile === 'local' ? { ideal: 1280, max: 1920 } : { ideal: 1280, max: 1280 },
    height: profile === 'local' ? { ideal: 720, max: 1080 } : { ideal: 720, max: 720 },
    frameRate: profile === 'local' ? { ideal: 24, max: 30 } : { ideal: 18, max: 24 },
    facingMode: 'user',
  };
}

function clampPreviewWidth(value: number, fallback: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(360, Math.min(1280, normalized || fallback));
}

function clampPreviewQuality(value: number, fallback: number): number {
  const normalized = Number.isFinite(value) ? value : fallback;
  return Math.max(0.45, Math.min(0.9, normalized || fallback));
}

function clampPreviewFps(value: number, fallback = 8): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(3, Math.min(12, normalized || fallback));
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

  stopMediaStream(state.stream);
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

async function createBackgroundPreviewVideo(pair: PairView): Promise<{ stream: MediaStream; video: HTMLVideoElement }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(pair.videoDeviceId, 'remote'),
    audio: false,
  });

  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  await waitForVideoReady(video);

  return { stream, video };
}

async function ensureContinuousPreviewVideo(pair: PairView): Promise<{ stream: MediaStream | null; video: HTMLVideoElement }> {
  const currentActivePair = activePair();
  if (previewStream && currentActivePair?.pairKey === pair.pairKey && previewVideo.readyState >= 2) {
    return { stream: null, video: previewVideo };
  }

  const prepared = await createBackgroundPreviewVideo(pair);
  return prepared;
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

function buildPreviewSessionKey(setupSessionId: string, pairKey: string): string {
  return `${setupSessionId}:${pairKey}`;
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

  stopMediaStream(current.stream);
}

async function handlePreviewSignal(payload: PreviewSignalPayload): Promise<void> {
  const setupSessionId = String(payload.setupSessionId || '').trim();
  const pairKey = String(payload.pairKey || '').trim();

  if (!setupSessionId || !pairKey) {
    return;
  }

  const description = payload.description;
  const candidate = payload.candidate;
  const sessionKey = buildPreviewSessionKey(setupSessionId, pairKey);

  if (description?.type === 'offer') {
    await stopWebRtcPreview(sessionKey);

    const pair = buildPairs().find((item) => item.pairKey === pairKey);
    if (!pair?.videoDeviceId) {
      throw new Error('Пара для WebRTC preview не знайдена або не містить камеру.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: buildVideoConstraints(pair.videoDeviceId, 'remote'),
      audio: false,
    });

    const pc = new RTCPeerConnection(PREVIEW_RTC_CONFIGURATION);
    const state: WebRtcPreviewState = {
      sessionKey,
      setupSessionId,
      pairKey,
      pc,
      stream,
    };

    webRtcPreviewState = state;

    pc.onicecandidate = (event) => {
      if (!event.candidate || webRtcPreviewState?.sessionKey !== sessionKey) {
        return;
      }

      void window.agentApi.sendPreviewSignal({
        setupSessionId,
        pairKey,
        candidate: event.candidate.toJSON(),
      });
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

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    await pc.setRemoteDescription(description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await window.agentApi.sendPreviewSignal({
      setupSessionId,
      pairKey,
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

  const validPairs = (config.configuredPairs || []).filter((pair) => resolveConfiguredPair(pair));
  const changed = validPairs.length !== (config.configuredPairs || []).length;
  if (changed) {
    await updateConfiguredPairs(validPairs);
    return;
  }

  renderPairBuilderOptions();
  renderPairs();
  updateControls();
}

async function refreshDeviceInventory(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error('enumerateDevices недоступний у цій системі.');
  }

  deviceInventory = await navigator.mediaDevices.enumerateDevices();
  await reconcileConfiguredPairs();
}

async function requestMediaAccess(): Promise<AccessResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia недоступний у цій системі.');
  }

  const result: AccessResult = { camera: false, microphone: false };

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  result.camera = stream.getVideoTracks().length > 0;
  result.microphone = stream.getAudioTracks().length > 0;
  stopMediaStream(stream);

  await refreshPermissionState();
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

  const enrollResult = await window.agentApi.enroll(buildSnapshot());
  config = enrollResult.config;
  syncUiWithConfig();
  setStatusLine(`Агент прив’язано до ${config.cabinetCode || '—'}.`);
  toast('Агент зареєстровано.', 'success');

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
      width: Number(payload.width || 720),
      quality: Number(payload.quality || 0.68),
      fps: Number(payload.fps || 8),
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
        pairKey: payload.pairKey,
        error: errorMessage,
      });
    });
    return;
  }

  if (message?.type === 'preview.stop') {
    stopContinuousPreview(String(payload.pairKey || '') || undefined);
    void stopWebRtcPreview(
      buildPreviewSessionKey(String(payload.setupSessionId || ''), String(payload.pairKey || '')),
    );
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
