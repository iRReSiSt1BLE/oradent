import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    createCabinet,
    deleteCabinet,
    deleteCabinetSetupSession,
    getCabinetDoctorsOptions,
    getCabinetServicesOptions,
    getCabinetSetupSession,
    getCabinets,
    initCabinetSetupSession,
    requestCabinetPreview,
    toggleCabinetActive,
    updateCabinet,
    type CabinetDeviceStartMode,
    type CabinetDoctorOption,
    type CabinetItem,
    type CabinetServiceOption,
    type CabinetSetupSession,
} from '../../shared/api/cabinetApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import { useI18n } from '../../shared/i18n/I18nProvider';
import { API_BASE_URL } from '../../shared/api/http';
import './CabinetsAdminPage.scss';

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

type ModalMode = 'create' | 'edit';

type BrowserMediaDevice = {
    deviceId: string;
    label: string;
    kind: 'videoinput' | 'audioinput';
};

type CabinetDeviceForm = {
    key: string;
    sourcePairKey: string;
    name: string;
    cameraDeviceId: string;
    cameraLabel: string;
    microphoneDeviceId: string;
    microphoneLabel: string;
    startMode: CabinetDeviceStartMode;
};

type CabinetFormState = {
    name: string;
    description: string;
    isActive: boolean;
    serviceIds: string[];
    doctorIds: string[];
    devices: CabinetDeviceForm[];
};

type AppLanguage = 'ua' | 'en' | 'de' | 'fr';
type Localized = Record<AppLanguage, string>;
type LocalizedFieldType = 'cabinetNameI18n' | 'cabinetDescriptionI18n' | 'cabinetDeviceNameI18n';

type AgentPairOption = {
    value: string;
    pairKey: string;
    displayName: string;
    videoDeviceId: string;
    videoLabel: string;
    audioDeviceId: string;
    audioLabel: string;
    isAvailable: boolean;
};

function buildSetupWebSocketUrl(token: string, setupSessionId: string) {
    const base = new URL(API_BASE_URL);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${base.host}/cabinets/setup/ws?token=${encodeURIComponent(token)}&setupSessionId=${encodeURIComponent(setupSessionId)}`;
}

function buildDirectPreviewWebSocketUrl(token: string) {
    const base = new URL(API_BASE_URL);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${base.host}/capture-agent/preview/ws?token=${encodeURIComponent(token)}`;
}

const PREVIEW_BINARY_MAGIC = 'OPF1';
const previewBinaryMagicBytes = new TextEncoder().encode(PREVIEW_BINARY_MAGIC);
const previewBinaryTextDecoder = new TextDecoder();

type BinaryPreviewFramePacket = {
    pairKey?: string;
    mimeType?: string;
    capturedAt?: string;
    imageBytes: Uint8Array;
};

type PreviewSignalPayload = {
    setupSessionId?: string;
    previewSessionId?: string;
    pairKey?: string;
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
    error?: string;
};

const PREVIEW_RTC_CONFIGURATION: RTCConfiguration = {
    iceServers: [
        {
            urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
        },
    ],
};

async function parseBinaryPreviewFramePacket(data: Blob | ArrayBuffer) {
    const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
    const view = new Uint8Array(buffer);
    const headerLength = previewBinaryMagicBytes.length + 4;

    if (view.length <= headerLength) return null;

    for (let i = 0; i < previewBinaryMagicBytes.length; i += 1) {
        if (view[i] !== previewBinaryMagicBytes[i]) return null;
    }

    const metaLengthView = new DataView(buffer, previewBinaryMagicBytes.length, 4);
    const metadataLength = metaLengthView.getUint32(0);
    const metadataStart = headerLength;
    const metadataEnd = metadataStart + metadataLength;

    if (!metadataLength || metadataEnd > view.length) return null;

    const metadataRaw = previewBinaryTextDecoder.decode(view.slice(metadataStart, metadataEnd));
    const metadata = JSON.parse(metadataRaw) as Omit<BinaryPreviewFramePacket, 'imageBytes'>;
    const imageBytes = view.slice(metadataEnd);

    if (!imageBytes.length) return null;

    return {
        pairKey: metadata.pairKey,
        mimeType: metadata.mimeType,
        capturedAt: metadata.capturedAt,
        imageBytes,
    } satisfies BinaryPreviewFramePacket;
}


function getI18nVariants(raw: unknown): string[] {
    const values = new Set<string>();

    const push = (value: unknown) => {
        if (typeof value !== 'string') return;
        const prepared = normalizeComparableText(value);
        if (prepared) values.add(prepared);
    };

    push(parseDbI18nValue(raw, 'ua'));
    push(parseDbI18nValue(raw, 'en'));
    push(parseDbI18nValue(raw, 'de'));
    push(parseDbI18nValue(raw, 'fr'));

    if (typeof raw === 'string') {
        push(raw);
    }

    return [...values];
}

function normalizeLocalized(data: Partial<Localized>): Localized {
    return {
        ua: data.ua || '',
        en: data.en || '',
        de: data.de || '',
        fr: data.fr || '',
    };
}

function serializeI18n(type: LocalizedFieldType, data: Partial<Localized>): string {
    return `__ORADENT_I18N__:${JSON.stringify({
        type,
        v: 1,
        data: normalizeLocalized(data),
    })}`;
}

function parseLocalizedEditorValue(raw: unknown): Localized {
    if (!raw) {
        return normalizeLocalized({});
    }

    if (typeof raw === 'string') {
        const extracted = tryExtractDbI18nData(raw);
        if (extracted) {
            return normalizeLocalized(extracted as Partial<Localized>);
        }

        return normalizeLocalized({ ua: raw });
    }

    if (typeof raw === 'object' && raw !== null) {
        const record = raw as Record<string, any>;
        if ('data' in record && record.data && typeof record.data === 'object') {
            return normalizeLocalized(record.data as Partial<Localized>);
        }

        return normalizeLocalized(record as Partial<Localized>);
    }

    return normalizeLocalized({ ua: String(raw) });
}

function getPrimaryLocalizedValue(raw: unknown) {
    const localized = parseLocalizedEditorValue(raw);
    return localized.ua || localized.en || localized.de || localized.fr || '';
}

function updateLocalizedRawValue(
    raw: string,
    language: AppLanguage,
    value: string,
    type: LocalizedFieldType,
) {
    const localized = parseLocalizedEditorValue(raw);
    localized[language] = value;
    const hasAnyValue = Object.values(localized).some((item) => item.trim());

    if (!hasAnyValue) return '';

    return serializeI18n(type, localized);
}

async function translateText(text: string, from: AppLanguage, to: AppLanguage) {
    const source = text.trim();
    if (!source) return '';
    if (from === to) return source;

    const sourceLang = from === 'ua' ? 'uk' : from;
    const targetLang = to === 'ua' ? 'uk' : to;

    const endpoints = [
        'https://translate.argosopentech.com/translate',
        'https://libretranslate.de/translate',
    ];

    for (const url of endpoints) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: source,
                    source: sourceLang,
                    target: targetLang,
                    format: 'text',
                }),
            });

            if (!resp.ok) continue;
            const data = (await resp.json()) as { translatedText?: string };
            const translated = (data.translatedText || '').trim();
            if (translated) return translated;
        } catch {
            // ignore
        }
    }

    try {
        const query = new URLSearchParams({
            q: source,
            langpair: `${sourceLang}|${targetLang}`,
        });

        const resp = await fetch(`https://api.mymemory.translated.net/get?${query.toString()}`);
        if (resp.ok) {
            const data = (await resp.json()) as { responseData?: { translatedText?: string } };
            const translated = (data.responseData?.translatedText || '').trim();
            if (translated) return translated;
        }
    } catch {
        // ignore
    }

    try {
        const query = new URLSearchParams({
            client: 'gtx',
            sl: sourceLang,
            tl: targetLang,
            dt: 't',
            q: source,
        });

        const resp = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`);
        if (resp.ok) {
            const data = (await resp.json()) as unknown;
            if (Array.isArray(data) && Array.isArray(data[0])) {
                const translated = data[0]
                    .map((part) => (Array.isArray(part) ? String(part[0] ?? '') : ''))
                    .join('')
                    .trim();
                if (translated) return translated;
            }
        }
    } catch {
        // ignore
    }

    throw new Error('Не вдалося виконати автопереклад');
}


async function autoTranslateLocalizedRaw(
    raw: string,
    activeLanguage: AppLanguage,
    type: LocalizedFieldType,
) {
    const localized = parseLocalizedEditorValue(raw);
    const sourceLanguage = localized.ua.trim() ? 'ua' : activeLanguage;
    const sourceText = (localized[sourceLanguage] || '').trim();

    if (!sourceText) {
        throw new Error('Немає тексту для перекладу');
    }

    const targets = (['ua', 'en', 'de', 'fr'] as AppLanguage[]).filter((lang) => lang !== sourceLanguage);

    const translatedPairs = await Promise.all(
        targets.map(async (lang) => {
            const translated = await translateText(sourceText, sourceLanguage, lang).catch(() => localized[lang] || '');
            return [lang, translated] as const;
        }),
    );

    const next: Localized = {
        ...localized,
        [sourceLanguage]: sourceText,
    };

    for (const [lang, translated] of translatedPairs) {
        next[lang] = translated || next[lang];
    }

    return serializeI18n(type, next);
}

function pluralizeUa(count: number, one: string, few: string, many: string) {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
    return many;
}


const DRAFT_CABINET_PREFIX = '__DRAFT__CABINET__';

const CABINET_CREATE_SETUP_DRAFT_KEY = 'oradent:cabinets:create-setup-draft';

type PersistedCreateCabinetDraft = {
    setupSessionId: string;
    form: CabinetFormState;
};

function saveCreateCabinetDraft(draft: PersistedCreateCabinetDraft) {
    try {
        sessionStorage.setItem(CABINET_CREATE_SETUP_DRAFT_KEY, JSON.stringify(draft));
    } catch {
        // ignore storage errors
    }
}

function loadCreateCabinetDraft(): PersistedCreateCabinetDraft | null {
    try {
        const raw = sessionStorage.getItem(CABINET_CREATE_SETUP_DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedCreateCabinetDraft;
        if (!parsed?.setupSessionId) return null;
        return {
            setupSessionId: parsed.setupSessionId,
            form: parsed.form || createEmptyForm(),
        };
    } catch {
        return null;
    }
}

function clearCreateCabinetDraft() {
    try {
        sessionStorage.removeItem(CABINET_CREATE_SETUP_DRAFT_KEY);
    } catch {
        // ignore storage errors
    }
}

function isDraftCabinet(cabinet: Pick<CabinetItem, 'name'> | null | undefined) {
    return Boolean(cabinet?.name?.startsWith(DRAFT_CABINET_PREFIX));
}

function formatCamerasCount(count: number, t: (key: string) => string) {
    return `${count} ${pluralizeUa(
        count,
        t('cabinetsAdmin.cameraCountOne'),
        t('cabinetsAdmin.cameraCountFew'),
        t('cabinetsAdmin.cameraCountMany'),
    )}`;
}


function uid() {

    return Math.random().toString(36).slice(2, 11);
}

function createEmptyForm(): CabinetFormState {
    return {
        name: '',
        description: '',
        isActive: true,
        serviceIds: [],
        doctorIds: [],
        devices: [],
    };
}

function normalizeComparableText(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}


function tryExtractDbI18nData(raw: string): Record<string, string> | null {
    if (!raw || typeof raw !== 'string') return null;
    const jsonStart = raw.indexOf('{');
    if (jsonStart === -1) return null;

    try {
        const parsed = JSON.parse(raw.slice(jsonStart));
        if (parsed && typeof parsed === 'object') {
            if (parsed.data && typeof parsed.data === 'object') {
                return parsed.data as Record<string, string>;
            }
            return parsed as Record<string, string>;
        }
        return null;
    } catch {
        return null;
    }
}

function parseDbI18nValue(raw: unknown, language: string): string {
    if (!raw) return '';

    if (typeof raw === 'object' && raw !== null) {
        const record = raw as Record<string, any>;

        if ('ua' in record || 'en' in record || 'de' in record || 'fr' in record) {
            return record[language] || record.ua || record.en || record.de || record.fr || '';
        }

        if ('i18n' in record && record.i18n) {
            const map = record.i18n as Record<string, string>;
            return map[language] || map.ua || map.en || map.de || map.fr || '';
        }

        if ('value' in record && typeof record.value === 'string') {
            return record.value;
        }

        if ('name' in record) {
            return parseDbI18nValue(record.name, language);
        }

        if ('data' in record && record.data && typeof record.data === 'object') {
            return record.data[language] || record.data.ua || record.data.en || record.data.de || record.data.fr || '';
        }
    }

    if (typeof raw === 'string') {
        const extracted = tryExtractDbI18nData(raw);
        if (!extracted) return raw;
        return extracted[language] || extracted.ua || extracted.en || extracted.de || extracted.fr || raw;
    }

    return String(raw);
}

function doctorFullName(doctor: CabinetDoctorOption | null | undefined) {
    if (!doctor) return '';
    return `${doctor.lastName || ''} ${doctor.firstName || ''} ${doctor.middleName || ''}`
        .replace(/\s+/g, ' ')
        .trim();
}

function getAgentStatusLabel(status: string | null | undefined, t: (key: string) => string) {
    return status === 'online' ? t('cabinetsAdmin.agentStatusOnline') : t('cabinetsAdmin.agentStatusOffline');
}

function getAgentPairOptions(cabinet: CabinetItem | null): AgentPairOption[] {
    return (cabinet?.linkedAgent?.pairs || []).map((pair) => ({
        value: `${pair.videoDeviceId}::${pair.audioDeviceId}`,
        pairKey: pair.pairKey,
        displayName: pair.displayName || pair.pairKey,
        videoDeviceId: pair.videoDeviceId,
        videoLabel: pair.videoLabel || pair.videoDeviceId,
        audioDeviceId: pair.audioDeviceId,
        audioLabel: pair.audioLabel || pair.audioDeviceId,
        isAvailable: pair.isAvailable,
    }));
}

function getDevicePairValue(device: Pick<CabinetDeviceForm, 'cameraDeviceId' | 'microphoneDeviceId'>) {
    if (!device.cameraDeviceId || !device.microphoneDeviceId) return '';
    return `${device.cameraDeviceId}::${device.microphoneDeviceId}`;
}


function mapCabinetToForm(cabinet: CabinetItem): CabinetFormState {
    return {
        name: cabinet.name || '',
        description: cabinet.description || '',
        isActive: cabinet.isActive,
        serviceIds: cabinet.serviceIds || [],
        doctorIds: cabinet.doctorIds || cabinet.doctorAssignments.map((item) => item.doctorId),
        devices:
            cabinet.devices.length > 0
                ? cabinet.devices.map((item) => ({
                      key: item.id,
                      sourcePairKey:
                          cabinet.linkedAgent?.pairs.find(
                              (pair) =>
                                  pair.videoDeviceId === (item.cameraDeviceId || '') &&
                                  pair.audioDeviceId === (item.microphoneDeviceId || ''),
                          )?.pairKey || '',
                      name: item.name || '',
                      cameraDeviceId: item.cameraDeviceId || '',
                      cameraLabel: item.cameraLabel || '',
                      microphoneDeviceId: item.microphoneDeviceId || '',
                      microphoneLabel: item.microphoneLabel || '',
                      startMode: item.startMode,
                  }))
                : [],
    };
}


function buildFallbackLabel(kind: 'videoinput' | 'audioinput', index: number, t: (key: string) => string) {
    return `${kind === 'videoinput' ? t('cabinetsAdmin.cameraShort') : t('cabinetsAdmin.microphoneShort')} ${index + 1}`;
}


function doctorTokenSet(doctor: CabinetDoctorOption) {
    const tokens = new Set<string>();
    getI18nVariants(doctor.specialty).forEach((item) => tokens.add(item));
    for (const item of doctor.specialties || []) {
        getI18nVariants(item).forEach((token) => tokens.add(token));
    }
    return tokens;
}

function serviceTokenSet(service: CabinetServiceOption) {
    const tokens = new Set<string>();

    for (const id of service.specialtyIds || []) {
        const prepared = normalizeComparableText(id);
        if (prepared) tokens.add(prepared);
    }

    for (const item of service.specialties || []) {
        getI18nVariants(item.name).forEach((token) => tokens.add(token));
        if (item.id) {
            const prepared = normalizeComparableText(item.id);
            if (prepared) tokens.add(prepared);
        }
    }

    return tokens;
}


export default function CabinetsAdminPage() {
    const token = getToken();
    const role = getUserRole();
    const { t, language } = useI18n();

    const [alert, setAlert] = useState<AlertState>(null);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [cabinets, setCabinets] = useState<CabinetItem[]>([]);
    const [doctors, setDoctors] = useState<CabinetDoctorOption[]>([]);
    const [services, setServices] = useState<CabinetServiceOption[]>([]);
    const [search, setSearch] = useState('');
    const [onlyActive, setOnlyActive] = useState(false);
    const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<ModalMode>('create');
    const [editingCabinetId, setEditingCabinetId] = useState<string | null>(null);
    const [setupSession, setSetupSession] = useState<CabinetSetupSession | null>(null);
    const [form, setForm] = useState<CabinetFormState>(createEmptyForm());
    const [saving, setSaving] = useState(false);
    const [draftBootstrapping, setDraftBootstrapping] = useState(false);
    const [refreshingSetupSession, setRefreshingSetupSession] = useState(false);
    const [refreshingDevices, setRefreshingDevices] = useState(false);
    const [translatingTarget, setTranslatingTarget] = useState<string | null>(null);
    const [nameEditorLanguage, setNameEditorLanguage] = useState<AppLanguage>('ua');
    const [descriptionEditorLanguage, setDescriptionEditorLanguage] = useState<AppLanguage>('ua');
    const [deviceEditorLanguages, setDeviceEditorLanguages] = useState<Record<string, AppLanguage>>({});
    const [deviceAccessGranted, setDeviceAccessGranted] = useState(false);
    const [videoInputs, setVideoInputs] = useState<BrowserMediaDevice[]>([]);
    const [audioInputs, setAudioInputs] = useState<BrowserMediaDevice[]>([]);
    const [cameraTestingKey, setCameraTestingKey] = useState<string | null>(null);
    const [microphoneTestingKey, setMicrophoneTestingKey] = useState<string | null>(null);
    const [microphoneLevel, setMicrophoneLevel] = useState(0);

    const blocked = role !== 'ADMIN' && role !== 'SUPER_ADMIN';

    const cameraPreviewTimerRef = useRef<number | null>(null);
    const cameraPreviewRequestIdRef = useRef(0);
    const cameraPreviewImgRef = useRef<HTMLImageElement | null>(null);
    const cameraPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
    const cameraPreviewPlaceholderRef = useRef<HTMLDivElement | null>(null);
    const cameraPreviewMetaRef = useRef<HTMLDivElement | null>(null);
    const cameraPreviewObjectUrlRef = useRef<string | null>(null);
    const cameraPreviewLiveStreamRef = useRef<MediaStream | null>(null);
    const previewPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const previewWebRtcPairKeyRef = useRef<string | null>(null);
    const directPreviewSocketRef = useRef<WebSocket | null>(null);
    const directPreviewSessionIdRef = useRef<string | null>(null);
    const previewWebRtcTimeoutRef = useRef<number | null>(null);
    const microphoneStreamRef = useRef<MediaStream | null>(null);
    const microphoneAudioContextRef = useRef<AudioContext | null>(null);
    const microphoneAnimationRef = useRef<number | null>(null);
    const createSetupRestoreAttemptedRef = useRef(false);
    const setupSocketRef = useRef<WebSocket | null>(null);
    const previewPairKeyRef = useRef<string | null>(null);

    const selectedCabinet = useMemo(
        () => cabinets.find((item) => item.id === selectedCabinetId) || null,
        [cabinets, selectedCabinetId],
    );

    const modalCabinet = useMemo(
        () => (editingCabinetId ? cabinets.find((item) => item.id === editingCabinetId) || null : null),
        [cabinets, editingCabinetId],
    );

    const modalConnectionCode = modalMode === 'create' ? setupSession?.connectionCode || '' : modalCabinet?.connectionCode || '';
    const modalLinkedAgent = modalMode === 'create' ? setupSession?.linkedAgent || null : modalCabinet?.linkedAgent || null;
    const modalAgentPairOptions = useMemo(() => {
        if (modalMode === 'create') {
            return (setupSession?.linkedAgent?.pairs || []).map((pair) => ({
                value: `${pair.videoDeviceId}::${pair.audioDeviceId}`,
                pairKey: pair.pairKey,
                displayName: pair.displayName || pair.pairKey,
                videoDeviceId: pair.videoDeviceId,
                videoLabel: pair.videoLabel || pair.videoDeviceId,
                audioDeviceId: pair.audioDeviceId,
                audioLabel: pair.audioLabel || pair.audioDeviceId,
                isAvailable: pair.isAvailable,
            }));
        }

        return getAgentPairOptions(modalCabinet);
    }, [modalCabinet, modalMode, setupSession]);

    const filteredCabinets = useMemo(() => {
        const query = normalizeComparableText(search);
        return cabinets.filter((cabinet) => {
            if (isDraftCabinet(cabinet)) return false;
            if (onlyActive && !cabinet.isActive) return false;
            if (!query) return true;
            const text = normalizeComparableText([
                parseDbI18nValue(cabinet.name, language),
                parseDbI18nValue(cabinet.description, language) || '',
                ...cabinet.services.map((item) => parseDbI18nValue(item.name, language)),
                ...cabinet.doctorAssignments.map((item) => doctorFullName(item.doctor)),
                cabinet.connectionCode,
                cabinet.linkedAgent?.name || '',
                cabinet.linkedAgent?.agentKey || '',
                ...cabinet.devices.flatMap((item) => [parseDbI18nValue(item.name, language), item.cameraLabel || '', item.microphoneLabel || '']),
            ].join(' '));
            return text.includes(query);
        });
    }, [cabinets, language, onlyActive, search]);

    
const matchingDoctors = useMemo(() => {
    const selectedServices = services.filter((item) => form.serviceIds.includes(item.id));
    if (!selectedServices.length) return doctors;

    return doctors.filter((doctor) => {
        if (selectedServices.some((service) => Array.isArray(service.doctorIds) && service.doctorIds.includes(doctor.id))) {
            return true;
        }

        const doctorTokens = doctorTokenSet(doctor);
        return selectedServices.some((service) => {
            const serviceTokens = serviceTokenSet(service);
            if (!serviceTokens.size) return true;
            return [...serviceTokens].some((token) => doctorTokens.has(token));
        });
    });
}, [doctors, form.serviceIds, services]);


    const microphoneBars = useMemo(() => {
        const count = 28;
        const active = Math.max(0, Math.min(count, Math.round(microphoneLevel * count)));
        return Array.from({ length: count }, (_, index) => index < active);
    }, [microphoneLevel]);

    void refreshingDevices;
    void deviceAccessGranted;
    void videoInputs;
    void audioInputs;
    void microphoneBars;

    const nameEditorValue = useMemo(() => parseLocalizedEditorValue(form.name), [form.name]);
    const descriptionEditorValue = useMemo(() => parseLocalizedEditorValue(form.description), [form.description]);
    const translationLanguages = useMemo(
        () =>
            ([
                { key: 'ua', label: t('cabinetsAdmin.translationUa') },
                { key: 'en', label: t('cabinetsAdmin.translationEn') },
                { key: 'de', label: t('cabinetsAdmin.translationDe') },
                { key: 'fr', label: t('cabinetsAdmin.translationFr') },
            ] as Array<{ key: AppLanguage; label: string }>),
        [t],
    );

    async function loadData() {
        if (!token || blocked) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const [cabinetsRes, doctorsRes, servicesRes] = await Promise.all([
                getCabinets(token),
                getCabinetDoctorsOptions(token),
                getCabinetServicesOptions(token),
            ]);
            setCabinets(Array.isArray(cabinetsRes.cabinets) ? cabinetsRes.cabinets : []);
            setDoctors(Array.isArray(doctorsRes.doctors) ? doctorsRes.doctors : []);
            setServices(Array.isArray(servicesRes.services) ? servicesRes.services : []);
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('cabinetsAdmin.loadError'),
            });
        } finally {
            setLoading(false);
        }
    }

    async function refreshBrowserDevices(requestPermission = false) {
        if (!navigator.mediaDevices?.enumerateDevices) {
            setAlert({ variant: 'error', message: t('cabinetsAdmin.osDevicesUnavailable') });
            return;
        }

        try {
            setRefreshingDevices(true);

            if (requestPermission && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                stream.getTracks().forEach((track) => track.stop());
                setDeviceAccessGranted(true);
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices
                .filter((device) => device.kind === 'videoinput')
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    label: device.label || buildFallbackLabel('videoinput', index, t),
                    kind: 'videoinput' as const,
                }));

            const microphones = devices
                .filter((device) => device.kind === 'audioinput')
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    label: device.label || buildFallbackLabel('audioinput', index, t),
                    kind: 'audioinput' as const,
                }));

            setVideoInputs(cameras);
            setAudioInputs(microphones);
            setAlert({
                variant: 'success',
                message: requestPermission ? t('cabinetsAdmin.osDevicesReady') : t('cabinetsAdmin.osDevicesRefreshed'),
            });
        } catch (err: any) {
            setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.osDevicesLoadError') });
        } finally {
            setRefreshingDevices(false);
        }
    }

    useEffect(() => {
        void loadData();
    }, []);

    useEffect(() => {
        if (!modalOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [modalOpen]);


    async function syncCurrentSetupSession(showError = false) {
        if (!token || !setupSession?.id) return;

        try {
            setRefreshingSetupSession(true);
            const response = await getCabinetSetupSession(token, setupSession.id);
            setSetupSession(response.setupSession);
        } catch (err: any) {
            if (showError) {
                setAlert({ variant: 'error', message: err?.message || 'Не вдалося оновити setup-сесію кабінету.' });
            }
        } finally {
            setRefreshingSetupSession(false);
        }
    }

    useEffect(() => {
        if (!token || createSetupRestoreAttemptedRef.current) return;
        createSetupRestoreAttemptedRef.current = true;

        const storedDraft = loadCreateCabinetDraft();
        if (!storedDraft?.setupSessionId) return;

        setModalMode('create');
        setEditingCabinetId(null);
        setForm(storedDraft.form || createEmptyForm());
        setNameEditorLanguage('ua');
        setDescriptionEditorLanguage('ua');
        setModalOpen(true);
        setDraftBootstrapping(true);

        void getCabinetSetupSession(token, storedDraft.setupSessionId)
            .then((response) => {
                setSetupSession(response.setupSession);
            })
            .catch(() => {
                clearCreateCabinetDraft();
                setModalOpen(false);
                setSetupSession(null);
                setForm(createEmptyForm());
            })
            .finally(() => {
                setDraftBootstrapping(false);
            });
    }, [token]);

    useEffect(() => {
        if (!(modalOpen && modalMode === 'create' && setupSession?.id)) {
            return;
        }

        saveCreateCabinetDraft({
            setupSessionId: setupSession.id,
            form,
        });
    }, [form, modalMode, modalOpen, setupSession?.id]);

    useEffect(() => {
        if (!(modalOpen && modalMode === 'create' && setupSession?.id)) {
            return;
        }

        const handleVisibilityOrFocus = () => {
            void syncCurrentSetupSession(false);
        };

        window.addEventListener('focus', handleVisibilityOrFocus);
        document.addEventListener('visibilitychange', handleVisibilityOrFocus);

        return () => {
            window.removeEventListener('focus', handleVisibilityOrFocus);
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
        };
    }, [modalMode, modalOpen, setupSession?.id, t, token]);

    useEffect(() => {
        if (!(modalOpen && modalMode === 'create' && token && setupSession?.id)) {
            return;
        }

        let cancelled = false;
        let socket: WebSocket | null = null;
        let reconnectTimer: number | null = null;

        const connect = () => {
            try {
                socket = new WebSocket(buildSetupWebSocketUrl(token, setupSession.id));
                socket.binaryType = 'arraybuffer';
                setupSocketRef.current = socket;
            } catch {
                reconnectTimer = window.setTimeout(connect, 2000);
                return;
            }

            socket.onmessage = (event) => {
                void (async () => {
                    try {
                        if (typeof event.data !== 'string') {
                            const frame = await parseBinaryPreviewFramePacket(event.data as Blob | ArrayBuffer);
                            if (frame?.pairKey && frame.pairKey === previewPairKeyRef.current) {
                                showCameraPreviewFromBinary(frame);
                            }
                            return;
                        }

                        const message = JSON.parse(event.data) as { type?: string; payload?: Record<string, unknown> };
                        if (message.type === 'setup.updated' || message.type === 'setup.connected') {
                            void getCabinetSetupSession(token, setupSession.id)
                                .then((response) => {
                                    if (!cancelled) {
                                        setSetupSession(response.setupSession);
                                    }
                                })
                                .catch(() => undefined);
                            return;
                        }

                        if (message.type === 'preview.frame') {
                            const pairKey = typeof message.payload?.pairKey === 'string' ? message.payload.pairKey : '';
                            const imageDataUrl = typeof message.payload?.imageDataUrl === 'string' ? message.payload.imageDataUrl : '';
                            const capturedAt = typeof message.payload?.capturedAt === 'string' ? message.payload.capturedAt : new Date().toISOString();

                            if (pairKey && imageDataUrl && pairKey === previewPairKeyRef.current) {
                                showCameraPreviewFromUrl(imageDataUrl, capturedAt);
                            }
                            return;
                        }

                        if (message.type === 'preview.signal') {
                            try {
                                await handleSetupPreviewSignal(message.payload as PreviewSignalPayload);
                            } catch (error: any) {
                                if (!cancelled) {
                                    setAlert({ variant: 'error', message: error?.message || t('cabinetsAdmin.cameraTestError') });
                                    stopCameraTest();
                                }
                            }
                            return;
                        }

                        if (message.type === 'preview.stopped') {
                            closePreviewPeerConnection();
                            return;
                        }

                        if (message.type === 'preview.error') {
                            if (!cancelled) {
                                setAlert({ variant: 'error', message: String(message.payload?.message || t('cabinetsAdmin.cameraTestError')) });
                                stopCameraTest();
                            }
                        }
                    } catch {
                        // ignore malformed ws payloads
                    }
                })();
            };

            socket.onclose = () => {
                if (setupSocketRef.current === socket) {
                    setupSocketRef.current = null;
                }
                closePreviewPeerConnection();
                if (cancelled) return;
                reconnectTimer = window.setTimeout(connect, 2000);
            };

            socket.onerror = () => {
                socket?.close();
            };
        };

        connect();

        return () => {
            cancelled = true;
            if (reconnectTimer) {
                window.clearTimeout(reconnectTimer);
            }
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
            if (setupSocketRef.current === socket) {
                setupSocketRef.current = null;
            }
            closePreviewPeerConnection();
        };
    }, [modalMode, modalOpen, setupSession?.id, token]);

    useEffect(() => {
        return () => {
            previewPairKeyRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!modalOpen || !token) return;

        let cancelled = false;

        if (modalMode === 'create') {
            if (!setupSession?.id) return;

            const syncSetupSession = async () => {
                try {
                    const response = await getCabinetSetupSession(token, setupSession.id);
                    if (cancelled) return;
                    setSetupSession(response.setupSession);
                } catch {
                    // ignore setup polling errors
                }
            };

            void syncCurrentSetupSession(false);
            const intervalId = window.setInterval(() => {
                void syncSetupSession();
            }, 10000);

            return () => {
                cancelled = true;
                window.clearInterval(intervalId);
            };
        }

        if (!editingCabinetId) return;

        const syncModalCabinet = async () => {
            try {
                const response = await getCabinets(token);
                if (cancelled) return;
                setCabinets(response.cabinets);
            } catch {
                // ignore modal polling errors
            }
        };

        void syncModalCabinet();
        const intervalId = window.setInterval(() => {
            void syncModalCabinet();
        }, 10000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [editingCabinetId, modalMode, modalOpen, setupSession?.id, token]);

    useEffect(() => {
        setForm((prev) => ({
            ...prev,
            doctorIds: prev.doctorIds.filter((id) => matchingDoctors.some((doctor) => doctor.id === id)),
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchingDoctors.map((item) => item.id).join('|')]);

    useEffect(() => {
        return () => {
            stopCameraTest();
            stopMicrophoneTest();
        };
    }, []);

    async function openCreateModal() {
        if (!token) return;

        stopCameraTest();
        stopMicrophoneTest();
        clearCreateCabinetDraft();
        setModalMode('create');
        setEditingCabinetId(null);
        setSetupSession(null);
        setForm(createEmptyForm());
        setNameEditorLanguage('ua');
        setDescriptionEditorLanguage('ua');
        setModalOpen(true);
        setDraftBootstrapping(true);

        try {
            const response = await initCabinetSetupSession(token);
            setSetupSession(response.setupSession);
        } catch (err: any) {
            setModalOpen(false);
            setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.saveError') });
        } finally {
            setDraftBootstrapping(false);
        }
    }

    function openEditModal(cabinet: CabinetItem) {
        stopCameraTest();
        stopMicrophoneTest();
        setModalMode('edit');
        setSetupSession(null);
        setEditingCabinetId(cabinet.id);
        const nextForm = mapCabinetToForm(cabinet);
        setForm(nextForm);
        setNameEditorLanguage('ua');
        setDescriptionEditorLanguage('ua');
        setModalOpen(true);
    }

    async function closeModal(cleanupSetupSession = true) {
        const setupSessionId = modalMode === 'create' ? setupSession?.id || null : null;

        clearCreateCabinetDraft();
        stopCameraTest();
        stopMicrophoneTest();
        setModalOpen(false);
        setEditingCabinetId(null);
        setSetupSession(null);
        setForm(createEmptyForm());
        setNameEditorLanguage('ua');
        setDescriptionEditorLanguage('ua');
        setDeviceEditorLanguages({});
        setDraftBootstrapping(false);

        if (cleanupSetupSession && token && setupSessionId) {
            try {
                await deleteCabinetSetupSession(token, setupSessionId);
            } catch {
                // ignore setup cleanup errors
            }
        }
    }

    function releaseCameraPreviewObjectUrl() {
        if (cameraPreviewObjectUrlRef.current) {
            URL.revokeObjectURL(cameraPreviewObjectUrlRef.current);
            cameraPreviewObjectUrlRef.current = null;
        }
    }

    function clearPreviewWebRtcTimeout() {
        if (previewWebRtcTimeoutRef.current) {
            window.clearTimeout(previewWebRtcTimeoutRef.current);
            previewWebRtcTimeoutRef.current = null;
        }
    }

    function closePreviewPeerConnection() {
        clearPreviewWebRtcTimeout();

        const directSessionId = directPreviewSessionIdRef.current;
        const directSocket = directPreviewSocketRef.current;
        if (directSocket) {
            try {
                if (directSocket.readyState === WebSocket.OPEN && directSessionId) {
                    directSocket.send(JSON.stringify({ type: 'preview.stop', payload: { previewSessionId: directSessionId } }));
                }
                directSocket.onopen = null;
                directSocket.onmessage = null;
                directSocket.onerror = null;
                directSocket.onclose = null;
                directSocket.close();
            } catch {
                // ignore direct preview close errors
            }
        }
        directPreviewSocketRef.current = null;
        directPreviewSessionIdRef.current = null;

        if (previewPeerConnectionRef.current) {
            try {
                previewPeerConnectionRef.current.ontrack = null;
                previewPeerConnectionRef.current.onicecandidate = null;
                previewPeerConnectionRef.current.onconnectionstatechange = null;
                previewPeerConnectionRef.current.close();
            } catch {
                // ignore close errors
            }
            previewPeerConnectionRef.current = null;
        }

        if (cameraPreviewLiveStreamRef.current) {
            cameraPreviewLiveStreamRef.current.getTracks().forEach((track) => track.stop());
            cameraPreviewLiveStreamRef.current = null;
        }

        if (cameraPreviewVideoRef.current) {
            cameraPreviewVideoRef.current.pause();
            cameraPreviewVideoRef.current.srcObject = null;
            cameraPreviewVideoRef.current.style.display = 'none';
        }

        previewWebRtcPairKeyRef.current = null;
    }

    function showLiveCameraPreview(stream: MediaStream, capturedAt?: string | null) {
        releaseCameraPreviewObjectUrl();

        if (cameraPreviewImgRef.current) {
            cameraPreviewImgRef.current.removeAttribute('src');
            cameraPreviewImgRef.current.style.display = 'none';
        }

        if (cameraPreviewVideoRef.current) {
            cameraPreviewVideoRef.current.srcObject = stream;
            cameraPreviewVideoRef.current.style.display = '';
            void cameraPreviewVideoRef.current.play().catch(() => undefined);
        }

        if (cameraPreviewPlaceholderRef.current) {
            cameraPreviewPlaceholderRef.current.style.display = 'none';
        }

        if (cameraPreviewMetaRef.current) {
            const stamp = capturedAt || new Date().toISOString();
            cameraPreviewMetaRef.current.textContent = `${t('cabinetsAdmin.previewUpdatedAt')}: ${new Date(stamp).toLocaleTimeString()}`;
            cameraPreviewMetaRef.current.style.display = '';
        }
    }

    async function handleSetupPreviewSignal(payload: PreviewSignalPayload) {
        const pairKey = typeof payload.pairKey === 'string' ? payload.pairKey : '';
        if (!pairKey || pairKey !== previewWebRtcPairKeyRef.current) {
            return;
        }

        if (payload.error) {
            throw new Error(payload.error);
        }

        const pc = previewPeerConnectionRef.current;
        if (!pc) {
            return;
        }

        if (payload.description) {
            await pc.setRemoteDescription(payload.description);
        }

        if (payload.candidate) {
            await pc.addIceCandidate(payload.candidate);
        }
    }

    async function startSetupWebRtcPreview(pairKey: string) {
        if (typeof RTCPeerConnection === 'undefined') {
            throw new Error('WebRTC preview не підтримується у цьому браузері.');
        }

        const socket = setupSocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error(t('cabinetsAdmin.previewSocketUnavailable'));
        }

        closePreviewPeerConnection();
        previewWebRtcPairKeyRef.current = pairKey;

        const pc = new RTCPeerConnection(PREVIEW_RTC_CONFIGURATION);
        previewPeerConnectionRef.current = pc;

        pc.ontrack = (event) => {
            clearPreviewWebRtcTimeout();
            const stream = event.streams[0] || new MediaStream([event.track]);
            cameraPreviewLiveStreamRef.current = stream;
            showLiveCameraPreview(stream, new Date().toISOString());
        };

        pc.onicecandidate = (event) => {
            if (!event.candidate || previewWebRtcPairKeyRef.current !== pairKey) {
                return;
            }

            try {
                sendSetupPreviewCommand('preview.signal', {
                    pairKey,
                    candidate: event.candidate.toJSON(),
                });
            } catch {
                // ignore transient ICE send errors here
            }
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                closePreviewPeerConnection();
            }
        };

        pc.addTransceiver('video', { direction: 'recvonly' });
        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
        await pc.setLocalDescription(offer);

        sendSetupPreviewCommand('preview.signal', {
            pairKey,
            description: pc.localDescription
                ? {
                      type: pc.localDescription.type,
                      sdp: pc.localDescription.sdp || undefined,
                  }
                : offer,
        });

        clearPreviewWebRtcTimeout();
        previewWebRtcTimeoutRef.current = window.setTimeout(() => {
            if (previewWebRtcPairKeyRef.current !== pairKey || cameraPreviewLiveStreamRef.current) {
                return;
            }

            closePreviewPeerConnection();
            void loadAgentPreviewFrame(cameraTestingKey || '').catch(() => undefined);
        }, 12000);
    }

    async function startDirectCabinetWebRtcPreview(pairKey: string, cabinetId: string) {
        if (!token || typeof RTCPeerConnection === 'undefined') {
            throw new Error('WebRTC preview не підтримується у цьому браузері.');
        }

        closePreviewPeerConnection();
        previewWebRtcPairKeyRef.current = pairKey;

        const socket = new WebSocket(buildDirectPreviewWebSocketUrl(token));
        const pc = new RTCPeerConnection(PREVIEW_RTC_CONFIGURATION);
        const candidateQueue: RTCIceCandidateInit[] = [];
        directPreviewSocketRef.current = socket;
        previewPeerConnectionRef.current = pc;

        pc.ontrack = (event) => {
            clearPreviewWebRtcTimeout();
            const stream = event.streams[0] || new MediaStream([event.track]);
            cameraPreviewLiveStreamRef.current = stream;
            showLiveCameraPreview(stream, new Date().toISOString());
        };

        pc.onicecandidate = (event) => {
            if (!event.candidate || previewWebRtcPairKeyRef.current !== pairKey) return;
            const candidate = event.candidate.toJSON();
            const previewSessionId = directPreviewSessionIdRef.current;
            if (!previewSessionId || socket.readyState !== WebSocket.OPEN) {
                candidateQueue.push(candidate);
                return;
            }
            socket.send(JSON.stringify({ type: 'preview.ice', payload: { previewSessionId, candidate } }));
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                closePreviewPeerConnection();
            }
        };

        socket.onmessage = (event) => {
            void (async () => {
                const message = JSON.parse(String(event.data || '{}')) as { type?: string; payload?: PreviewSignalPayload & { message?: string } };
                const payload = message.payload || {};

                if (message.type === 'preview.session' && payload.previewSessionId) {
                    directPreviewSessionIdRef.current = String(payload.previewSessionId);
                    while (candidateQueue.length) {
                        const candidate = candidateQueue.shift();
                        socket.send(JSON.stringify({ type: 'preview.ice', payload: { previewSessionId: payload.previewSessionId, candidate } }));
                    }
                    return;
                }

                if (message.type === 'preview.signal') {
                    if (payload.error) throw new Error(payload.error);
                    if (payload.previewSessionId) directPreviewSessionIdRef.current = String(payload.previewSessionId);
                    if (payload.description) await pc.setRemoteDescription(payload.description);
                    if (payload.candidate) await pc.addIceCandidate(payload.candidate);
                    return;
                }

                if (message.type === 'preview.error') {
                    throw new Error(payload.message || 'WebRTC preview error');
                }
            })().catch((error) => {
                closePreviewPeerConnection();
                setAlert({ variant: 'error', message: error instanceof Error ? error.message : 'WebRTC preview error' });
            });
        };

        socket.onerror = () => {
            closePreviewPeerConnection();
        };

        socket.onopen = () => {
            void (async () => {
                pc.addTransceiver('video', { direction: 'recvonly' });
                const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
                await pc.setLocalDescription(offer);
                socket.send(JSON.stringify({
                    type: 'preview.offer',
                    payload: {
                        cabinetId,
                        pairKey,
                        description: pc.localDescription
                            ? { type: pc.localDescription.type, sdp: pc.localDescription.sdp || undefined }
                            : offer,
                    },
                }));
            })().catch((error) => {
                closePreviewPeerConnection();
                setAlert({ variant: 'error', message: error instanceof Error ? error.message : 'WebRTC preview error' });
            });
        };

        clearPreviewWebRtcTimeout();
        previewWebRtcTimeoutRef.current = window.setTimeout(() => {
            if (previewWebRtcPairKeyRef.current !== pairKey || cameraPreviewLiveStreamRef.current) return;
            closePreviewPeerConnection();
            void loadAgentPreviewFrame(cameraTestingKey || '').catch(() => undefined);
        }, 8000);
    }

    function clearCameraPreviewUi(placeholderText?: string) {
        releaseCameraPreviewObjectUrl();
        closePreviewPeerConnection();

        if (cameraPreviewImgRef.current) {
            cameraPreviewImgRef.current.removeAttribute('src');
            cameraPreviewImgRef.current.style.display = 'none';
        }

        if (cameraPreviewPlaceholderRef.current) {
            cameraPreviewPlaceholderRef.current.textContent = placeholderText || t('cabinetsAdmin.previewLoading');
            cameraPreviewPlaceholderRef.current.style.display = '';
        }

        if (cameraPreviewMetaRef.current) {
            cameraPreviewMetaRef.current.textContent = '';
            cameraPreviewMetaRef.current.style.display = 'none';
        }
    }

    function showCameraPreviewFromUrl(imageUrl: string, capturedAt?: string | null) {
        if (!cameraPreviewImgRef.current) return;

        if (cameraPreviewVideoRef.current) {
            cameraPreviewVideoRef.current.pause();
            cameraPreviewVideoRef.current.srcObject = null;
            cameraPreviewVideoRef.current.style.display = 'none';
        }

        releaseCameraPreviewObjectUrl();
        cameraPreviewImgRef.current.src = imageUrl;
        cameraPreviewImgRef.current.style.display = '';

        if (cameraPreviewPlaceholderRef.current) {
            cameraPreviewPlaceholderRef.current.style.display = 'none';
        }

        if (cameraPreviewMetaRef.current) {
            if (capturedAt) {
                cameraPreviewMetaRef.current.textContent = `${t('cabinetsAdmin.previewUpdatedAt')}: ${new Date(capturedAt).toLocaleTimeString()}`;
                cameraPreviewMetaRef.current.style.display = '';
            } else {
                cameraPreviewMetaRef.current.textContent = '';
                cameraPreviewMetaRef.current.style.display = 'none';
            }
        }
    }

    function showCameraPreviewFromBinary(frame: BinaryPreviewFramePacket) {
        const mimeType = frame.mimeType || 'image/webp';
        if (cameraPreviewVideoRef.current) {
            cameraPreviewVideoRef.current.pause();
            cameraPreviewVideoRef.current.srcObject = null;
            cameraPreviewVideoRef.current.style.display = 'none';
        }
        releaseCameraPreviewObjectUrl();
        const normalizedImageBytes = new Uint8Array(frame.imageBytes.byteLength);
        normalizedImageBytes.set(frame.imageBytes);
        const objectUrl = URL.createObjectURL(new Blob([normalizedImageBytes.buffer], { type: mimeType }));
        cameraPreviewObjectUrlRef.current = objectUrl;

        if (cameraPreviewImgRef.current) {
            cameraPreviewImgRef.current.src = objectUrl;
            cameraPreviewImgRef.current.style.display = '';
        }

        if (cameraPreviewPlaceholderRef.current) {
            cameraPreviewPlaceholderRef.current.style.display = 'none';
        }

        if (cameraPreviewMetaRef.current) {
            if (frame.capturedAt) {
                cameraPreviewMetaRef.current.textContent = `${t('cabinetsAdmin.previewUpdatedAt')}: ${new Date(frame.capturedAt).toLocaleTimeString()}`;
                cameraPreviewMetaRef.current.style.display = '';
            } else {
                cameraPreviewMetaRef.current.textContent = '';
                cameraPreviewMetaRef.current.style.display = 'none';
            }
        }
    }

    function toggleCabinetSelection(cabinetId: string) {
        setSelectedCabinetId((prev) => (prev === cabinetId ? null : cabinetId));
    }



    async function copyConnectionCode(value: string) {
        const prepared = value.trim();
        if (!prepared) return;

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(prepared);
        } else {
            const input = document.createElement('textarea');
            input.value = prepared;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            input.remove();
        }

        setAlert({ variant: 'success', message: t('cabinetsAdmin.codeCopied') });
    }

    function toggleAgentPair(pair: AgentPairOption) {
        setForm((prev) => {
            const existing = prev.devices.find(
                (device) => device.sourcePairKey === pair.pairKey || getDevicePairValue(device) === pair.value,
            );

            if (existing) {
                stopCameraTest(existing.key);
                stopMicrophoneTest(existing.key);
                setDeviceEditorLanguages((prevLanguages) => {
                    const next = { ...prevLanguages };
                    delete next[existing.key];
                    return next;
                });
                return {
                    ...prev,
                    devices: prev.devices.filter((device) => device.key !== existing.key),
                };
            }

            const nextKey = uid();
            setDeviceEditorLanguages((prevLanguages) => ({ ...prevLanguages, [nextKey]: 'ua' }));

            return {
                ...prev,
                devices: [
                    ...prev.devices,
                    {
                        key: nextKey,
                        sourcePairKey: pair.pairKey,
                        name: '',
                        cameraDeviceId: pair.videoDeviceId,
                        cameraLabel: pair.videoLabel,
                        microphoneDeviceId: pair.audioDeviceId,
                        microphoneLabel: pair.audioLabel,
                        startMode: 'MANUAL',
                    },
                ],
            };
        });
    }

    function updateDeviceStartMode(pairKey: string, startMode: CabinetDeviceStartMode) {
        setForm((prev) => ({
            ...prev,
            devices: prev.devices.map((device) =>
                device.sourcePairKey === pairKey ? { ...device, startMode } : device,
            ),
        }));
    }


    function toggleInArray(list: string[], value: string) {
        return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    }

    function toggleService(serviceId: string) {
        setForm((prev) => ({
            ...prev,
            serviceIds: toggleInArray(prev.serviceIds, serviceId),
        }));
    }

    function toggleDoctor(doctorId: string) {
        setForm((prev) => ({
            ...prev,
            doctorIds: toggleInArray(prev.doctorIds, doctorId),
        }));
    }

    function updateNameTranslation(languageKey: AppLanguage, value: string) {
        setForm((prev) => ({
            ...prev,
            name: updateLocalizedRawValue(prev.name, languageKey, value, 'cabinetNameI18n'),
        }));
    }

    function updateDescriptionTranslation(languageKey: AppLanguage, value: string) {
        setForm((prev) => ({
            ...prev,
            description: updateLocalizedRawValue(prev.description, languageKey, value, 'cabinetDescriptionI18n'),
        }));
    }

    function updateDeviceNameTranslation(deviceKey: string, languageKey: AppLanguage, value: string) {
        setForm((prev) => ({
            ...prev,
            devices: prev.devices.map((device) =>
                device.key === deviceKey
                    ? {
                          ...device,
                          name: updateLocalizedRawValue(device.name, languageKey, value, 'cabinetDeviceNameI18n'),
                      }
                    : device,
            ),
        }));
    }

    function setDeviceEditorLanguage(deviceKey: string, languageKey: AppLanguage) {
        setDeviceEditorLanguages((prev) => ({ ...prev, [deviceKey]: languageKey }));
    }

    function getDeviceEditorLanguage(deviceKey: string): AppLanguage {
        return deviceEditorLanguages[deviceKey] || 'ua';
    }

    async function handleTranslateField(
        target: 'name' | 'description' | `device:${string}`,
        rawValue: string,
        languageKey: AppLanguage,
        type: LocalizedFieldType,
    ) {
        try {
            setTranslatingTarget(target);
            const translated = await autoTranslateLocalizedRaw(rawValue, languageKey, type);

            if (target === 'name') {
                setForm((prev) => ({ ...prev, name: translated }));
            } else if (target === 'description') {
                setForm((prev) => ({ ...prev, description: translated }));
            } else {
                const key = target.replace('device:', '');
                setForm((prev) => ({
                    ...prev,
                    devices: prev.devices.map((device) =>
                        device.key === key
                            ? {
                                  ...device,
                                  name: translated,
                              }
                            : device,
                    ),
                }));
            }

            setAlert({
                variant: 'success',
                message: t('cabinetsAdmin.translatedSuccess'),
            });
        } catch (err: any) {
            setAlert({
                variant: 'error',
                message: err?.message || t('cabinetsAdmin.translateError'),
            });
        } finally {
            setTranslatingTarget(null);
        }
    }

    function sendSetupPreviewCommand(type: 'preview.start' | 'preview.stop' | 'preview.signal', payload: Record<string, unknown>) {
        const socket = setupSocketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error(t('cabinetsAdmin.previewSocketUnavailable'));
        }

        socket.send(JSON.stringify({ type, payload }));
    }

    async function loadAgentPreviewFrame(deviceKey: string) {
        if (!token) {
            return;
        }

        const device = form.devices.find((item) => item.key === deviceKey);
        if (!device?.sourcePairKey) {
            throw new Error(t('cabinetsAdmin.cameraTestError'));
        }

        const requestId = ++cameraPreviewRequestIdRef.current;
        const response = await requestCabinetPreview(token, {
            setupSessionId: modalMode === 'create' ? setupSession?.id : undefined,
            cabinetId: modalMode === 'edit' ? editingCabinetId || undefined : undefined,
            pairKey: device.sourcePairKey,
        });

        if (requestId !== cameraPreviewRequestIdRef.current) {
            return;
        }

        showCameraPreviewFromUrl(response.preview.imageDataUrl, response.preview.capturedAt);
    }

    async function startCameraTest(deviceKey: string) {
        const device = form.devices.find((item) => item.key === deviceKey);
        if (!device?.sourcePairKey) {
            setAlert({ variant: 'error', message: t('cabinetsAdmin.cameraTestError') });
            return;
        }

        try {
            stopCameraTest();
            setCameraTestingKey(deviceKey);
            clearCameraPreviewUi();
            previewPairKeyRef.current = device.sourcePairKey;

            if (modalMode === 'create' && setupSession?.id) {
                await startSetupWebRtcPreview(device.sourcePairKey);
                return;
            }

            if (modalMode === 'edit' && editingCabinetId) {
                await startDirectCabinetWebRtcPreview(device.sourcePairKey, editingCabinetId);
                return;
            }

            await loadAgentPreviewFrame(deviceKey);
            cameraPreviewTimerRef.current = window.setInterval(() => {
                void loadAgentPreviewFrame(deviceKey).catch(() => undefined);
            }, 1200);
        } catch (err: any) {
            stopCameraTest();
            setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.cameraTestError') });
        }
    }

    function stopCameraTest(targetKey?: string) {
        if (targetKey && cameraTestingKey !== targetKey) return;
        const pairKey = previewPairKeyRef.current;
        if (modalMode === 'create' && setupSession?.id && pairKey) {
            try {
                sendSetupPreviewCommand('preview.stop', { pairKey });
            } catch {
                // ignore socket stop errors
            }
        }
        previewPairKeyRef.current = null;
        closePreviewPeerConnection();
        if (cameraPreviewTimerRef.current) {
            window.clearInterval(cameraPreviewTimerRef.current);
            cameraPreviewTimerRef.current = null;
        }
        cameraPreviewRequestIdRef.current += 1;
        setCameraTestingKey(null);
        clearCameraPreviewUi();
    }

    async function startMicrophoneTest(deviceKey: string) {
        const device = form.devices.find((item) => item.key === deviceKey);
        if (!navigator.mediaDevices?.getUserMedia) return;

        try {
            stopMicrophoneTest();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: device?.microphoneDeviceId ? { deviceId: { exact: device.microphoneDeviceId } } : true,
                video: false,
            });
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
                analyser.getByteFrequencyData(data);
                const sum = data.reduce((acc, value) => acc + value, 0);
                const average = sum / data.length / 255;
                setMicrophoneLevel(average);
                microphoneAnimationRef.current = window.requestAnimationFrame(tick);
            };
            microphoneStreamRef.current = stream;
            microphoneAudioContextRef.current = audioContext;
            setMicrophoneTestingKey(deviceKey);
            tick();
        } catch (err: any) {
            setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.microphoneTestError') });
        }
    }

    void refreshBrowserDevices;
    void startMicrophoneTest;

    function stopMicrophoneTest(targetKey?: string) {
        if (targetKey && microphoneTestingKey !== targetKey) return;
        if (microphoneAnimationRef.current) {
            window.cancelAnimationFrame(microphoneAnimationRef.current);
            microphoneAnimationRef.current = null;
        }
        microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
        microphoneStreamRef.current = null;
        if (microphoneAudioContextRef.current) {
            void microphoneAudioContextRef.current.close().catch(() => undefined);
            microphoneAudioContextRef.current = null;
        }
        setMicrophoneTestingKey(null);
        setMicrophoneLevel(0);
    }

    

async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    const rawName = getPrimaryLocalizedValue(form.name).trim();
    const rawDescription = getPrimaryLocalizedValue(form.description).trim();

    if (!rawName) {
        setAlert({ variant: 'info', message: t('cabinetsAdmin.errorNameRequired') });
        return;
    }

    if (form.devices.some((device) => !(getPrimaryLocalizedValue(device.name) || '').trim())) {
        setAlert({ variant: 'info', message: t('cabinetsAdmin.deviceNameRequired') });
        return;
    }

    try {
        setSaving(true);

        const devices = form.devices
            .map((device) => {
                const selectedPair = modalAgentPairOptions.find((item) => item.value === getDevicePairValue(device));
                return {
                    name: device.name,
                    cameraDeviceId: device.cameraDeviceId || undefined,
                    cameraLabel: selectedPair?.videoLabel || device.cameraLabel || undefined,
                    microphoneDeviceId: device.microphoneDeviceId || undefined,
                    microphoneLabel: selectedPair?.audioLabel || device.microphoneLabel || undefined,
                    startMode: device.startMode,
                };
            })
            .filter((device) => getPrimaryLocalizedValue(device.name).trim() && (device.cameraDeviceId || device.microphoneDeviceId));

        const payload = {
            name: form.name,
            description: rawDescription ? form.description : undefined,
            isActive: form.isActive,
            serviceIds: form.serviceIds,
            doctorIds: form.doctorIds,
            devices,
        };

        if (modalMode === 'create') {
            if (!setupSession?.id) {
                throw new Error('Setup-сесію кабінету ще не підготовлено.');
            }

            const response = await createCabinet(token, {
                ...payload,
                setupSessionId: setupSession.id,
            });
            setCabinets((prev) => [response.cabinet, ...prev]);
            setSelectedCabinetId(response.cabinet.id);
            setAlert({ variant: 'success', message: `${t('cabinetsAdmin.created')} ${t('cabinetsAdmin.connectionCode')}: ${response.cabinet.connectionCode}` });
            await closeModal(false);
            return;
        } else if (editingCabinetId) {
            const response = await updateCabinet(token, editingCabinetId, payload);
            setCabinets((prev) => prev.map((item) => (item.id === editingCabinetId ? response.cabinet : item)));
            setSelectedCabinetId(response.cabinet.id);
            setAlert({ variant: 'success', message: t('cabinetsAdmin.updated') });
        }
        await closeModal(false);
    } catch (err: any) {
        setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.saveError') });
    } finally {
        setSaving(false);
    }
}


    async function handleToggleCabinet(cabinet: CabinetItem) {
        if (!token) return;
        try {
            setProcessingId(cabinet.id);
            const response = await toggleCabinetActive(token, cabinet.id);
            setCabinets((prev) => prev.map((item) => (item.id === cabinet.id ? response.cabinet : item)));
        } catch (err: any) {
            setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.toggleError') });
        } finally {
            setProcessingId(null);
        }
    }

    async function handleDeleteCabinet(cabinet: CabinetItem) {
        if (!token) return;
        if (!window.confirm(t('cabinetsAdmin.deleteConfirm'))) return;

        try {
            setProcessingId(cabinet.id);
            await deleteCabinet(token, cabinet.id);
            const next = cabinets.filter((item) => item.id !== cabinet.id);
            setCabinets(next);
            setSelectedCabinetId((prev) => (prev === cabinet.id ? null : prev));
            setAlert({ variant: 'success', message: t('cabinetsAdmin.deleted') });
        } catch (err: any) {
            setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.deleteError') });
        } finally {
            setProcessingId(null);
        }
    }

    return (
        <section className="cabinets-admin-page">
            {alert ? <AlertToast variant={alert.variant} message={alert.message} onClose={() => setAlert(null)} /> : null}

            <div className="cabinets-admin-page__container container">
                {blocked ? (
                    <div className="cabinets-admin-page__blocked">{t('cabinetsAdmin.blocked')}</div>
                ) : (
                    <>
                        <div className="cabinets-admin-page__head">
                            <div>
                                <h1>{t('cabinetsAdmin.title')}</h1>
                                <p>{t('cabinetsAdmin.subtitle')}</p>
                            </div>
                            <button type="button" className="cabinets-admin-page__primary-btn" onClick={() => void openCreateModal()}>
                                {t('cabinetsAdmin.newCabinet')}
                            </button>
                        </div>

                        <div className="cabinets-admin-page__toolbar">
                            <input
                                className="cabinets-admin-page__search"
                                type="text"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder={t('cabinetsAdmin.searchPlaceholder')}
                            />
                            <label className="cabinets-admin-page__filter">
                                <input type="checkbox" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} />
                                <span>{t('cabinetsAdmin.onlyActive')}</span>
                            </label>
                        </div>

                        {selectedCabinet ? (
                            <div className="cabinets-admin-page__selected-actions">
                                <button type="button" className="cabinets-admin-page__secondary-btn" onClick={() => openEditModal(selectedCabinet)} disabled={processingId === selectedCabinet.id}>
                                    {t('cabinetsAdmin.edit')}
                                </button>
                                <button
                                    type="button"
                                    className="cabinets-admin-page__secondary-btn"
                                    onClick={() => void handleToggleCabinet(selectedCabinet)}
                                    disabled={processingId === selectedCabinet.id}
                                >
                                    {processingId === selectedCabinet.id ? (
                                        <span className="cabinets-admin-page__button-loading">
                                            <span className="cabinets-admin-page__button-spinner" />
                                            {selectedCabinet.isActive ? t('cabinetsAdmin.deactivating') : t('cabinetsAdmin.activating')}
                                        </span>
                                    ) : selectedCabinet.isActive ? t('cabinetsAdmin.deactivate') : t('cabinetsAdmin.activate')}
                                </button>
                                <button
                                    type="button"
                                    className="cabinets-admin-page__danger-btn"
                                    onClick={() => void handleDeleteCabinet(selectedCabinet)}
                                    disabled={processingId === selectedCabinet.id}
                                >
                                    {processingId === selectedCabinet.id ? (
                                        <span className="cabinets-admin-page__button-loading">
                                            <span className="cabinets-admin-page__button-spinner" />
                                            {t('cabinetsAdmin.deleting')}
                                        </span>
                                    ) : (
                                        t('cabinetsAdmin.delete')
                                    )}
                                </button>
                            </div>
                        ) : null}

                        {loading ? (
                            <div className="cabinets-admin-page__list">
                                {Array.from({ length: 4 }).map((_, index) => (
                                    <div key={`cabinet-skeleton-${index}`} className="cabinets-admin-page__skeleton-row">
                                        <div className="cabinets-admin-page__skeleton-texts">
                                            <div className="cabinets-admin-page__skeleton-line cabinets-admin-page__skeleton-line--title" />
                                            <div className="cabinets-admin-page__skeleton-line" />
                                            <div className="cabinets-admin-page__skeleton-line cabinets-admin-page__skeleton-line--short" />
                                        </div>
                                        <div className="cabinets-admin-page__skeleton-pill" />
                                    </div>
                                ))}
                            </div>
                        ) : filteredCabinets.length ? (
                            <div className="cabinets-admin-page__list">
                                {filteredCabinets.map((cabinet) => {
                                    const selected = selectedCabinetId === cabinet.id;
                                    const camerasCount = cabinet.devices.filter((item) => item.cameraDeviceId).length;
                                    return (
                                        <button
                                            key={cabinet.id}
                                            type="button"
                                            className={`cabinets-admin-page__row ${selected ? 'is-selected' : ''}`}
                                            onClick={() => toggleCabinetSelection(cabinet.id)}
                                        >
                                            <div className="cabinets-admin-page__row-main">
                                                <div className="cabinets-admin-page__row-title-line">
                                                    <strong>{parseDbI18nValue(cabinet.name, language) || getPrimaryLocalizedValue(cabinet.name) || cabinet.name}</strong>
                                                    <span className={`cabinets-admin-page__status-dot ${cabinet.isActive ? 'is-active' : 'is-inactive'}`} />
                                                </div>
                                                <div className="cabinets-admin-page__row-subtitle">
                                                    <div>{parseDbI18nValue(cabinet.description, language) || getPrimaryLocalizedValue(cabinet.description) || cabinet.description || t('cabinetsAdmin.noDescription')}</div>
                                                    <div className="cabinets-admin-page__row-meta">
                                                        <span>{t('cabinetsAdmin.connectionCode')}: {cabinet.connectionCode}</span>
                                                        <span>
                                                            {cabinet.linkedAgent
                                                                ? `${t('cabinetsAdmin.linkedAgent')}: ${cabinet.linkedAgent.name} · ${getAgentStatusLabel(cabinet.linkedAgent.status, t)}`
                                                                : t('cabinetsAdmin.agentNotConnected')}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="cabinets-admin-page__row-side">
                                                <span className="cabinets-admin-page__pill">{formatCamerasCount(camerasCount, t)}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="cabinets-admin-page__empty">{t('cabinetsAdmin.empty')}</div>
                        )}
                    </>
                )}
            </div>

            {modalOpen ? (
                <div className="cabinets-admin-page__modal-backdrop">
                    <div className="cabinets-admin-page__modal" onClick={(event) => event.stopPropagation()}>
                        <div className="cabinets-admin-page__modal-header">
                            <div>
                                <h2>{modalMode === 'create' ? t('cabinetsAdmin.createCabinet') : t('cabinetsAdmin.editCabinet')}</h2>
                                <p>{t('cabinetsAdmin.modalHint')}</p>
                            </div>
                            <button type="button" className="cabinets-admin-page__icon-btn cabinets-admin-page__icon-btn--close" onClick={() => void closeModal()} aria-label={t('cabinetsAdmin.close')}>
                                ×
                            </button>
                        </div>

                        <form className="cabinets-admin-page__form" onSubmit={handleSubmit}>
                            <div className="cabinets-admin-page__grid cabinets-admin-page__grid--top">
                                <label className="cabinets-admin-page__field">
                                    <span>{t('cabinetsAdmin.name')}</span>
                                    <div className="cabinets-admin-page__translation-tools">
                                        <div className="cabinets-admin-page__translation-tabs">
                                            {translationLanguages.map((item) => (
                                                <button
                                                    key={`name-tab-${item.key}`}
                                                    type="button"
                                                    className={`cabinets-admin-page__translation-tab ${nameEditorLanguage === item.key ? 'is-active' : ''}`}
                                                    onClick={() => setNameEditorLanguage(item.key)}
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            className="cabinets-admin-page__translation-btn"
                                            onClick={() => void handleTranslateField('name', form.name, nameEditorLanguage, 'cabinetNameI18n')}
                                            disabled={translatingTarget === 'name'}
                                        >
                                            {translatingTarget === 'name' ? t('cabinetsAdmin.translating') : t('cabinetsAdmin.autoTranslate')}
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        value={nameEditorValue[nameEditorLanguage]}
                                        onChange={(event) => updateNameTranslation(nameEditorLanguage, event.target.value)}
                                        placeholder={t('cabinetsAdmin.namePlaceholder')}
                                    />
                                </label>

                                <label className="cabinets-admin-page__field cabinets-admin-page__field--checkbox">
                                    <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                                    <span>{t('cabinetsAdmin.activeCabinet')}</span>
                                </label>
                            </div>

                            <label className="cabinets-admin-page__field">
                                <span>{t('cabinetsAdmin.description')}</span>
                                <div className="cabinets-admin-page__translation-tools">
                                    <div className="cabinets-admin-page__translation-tabs">
                                        {translationLanguages.map((item) => (
                                            <button
                                                key={`description-tab-${item.key}`}
                                                type="button"
                                                className={`cabinets-admin-page__translation-tab ${descriptionEditorLanguage === item.key ? 'is-active' : ''}`}
                                                onClick={() => setDescriptionEditorLanguage(item.key)}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        className="cabinets-admin-page__translation-btn"
                                        onClick={() => void handleTranslateField('description', form.description, descriptionEditorLanguage, 'cabinetDescriptionI18n')}
                                        disabled={translatingTarget === 'description'}
                                    >
                                        {translatingTarget === 'description' ? t('cabinetsAdmin.translating') : t('cabinetsAdmin.autoTranslate')}
                                    </button>
                                </div>
                                <textarea
                                    value={descriptionEditorValue[descriptionEditorLanguage]}
                                    onChange={(event) => updateDescriptionTranslation(descriptionEditorLanguage, event.target.value)}
                                    placeholder={t('cabinetsAdmin.descriptionPlaceholder')}
                                    rows={3}
                                />
                            </label>

                            <div className="cabinets-admin-page__grid cabinets-admin-page__grid--selectors">
                                <div className="cabinets-admin-page__selector-card">
                                    <div className="cabinets-admin-page__selector-head">
                                        <div>
                                            <h3>{t('cabinetsAdmin.services')}</h3>
                                            <p>{t('cabinetsAdmin.servicesHint')}</p>
                                        </div>
                                    </div>
                                    <div className="cabinets-admin-page__checkbox-list">
                                        {services.map((service) => (
                                            <label key={service.id} className="cabinets-admin-page__checkbox-item">
                                                <input type="checkbox" checked={form.serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} />
                                                <span>{parseDbI18nValue(service.name, language)}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="cabinets-admin-page__selector-card">
                                    <div className="cabinets-admin-page__selector-head">
                                        <div>
                                            <h3>{t('cabinetsAdmin.assignedDoctors')}</h3>
                                            <p>{t('cabinetsAdmin.doctorsHint')}</p>
                                        </div>
                                    </div>
                                    <div className="cabinets-admin-page__checkbox-list">
                                        {matchingDoctors.length ? (
                                            matchingDoctors.map((doctor) => (
                                                <label key={doctor.id} className="cabinets-admin-page__checkbox-item">
                                                    <input type="checkbox" checked={form.doctorIds.includes(doctor.id)} onChange={() => toggleDoctor(doctor.id)} />
                                                    <span>{doctorFullName(doctor)}</span>
                                                </label>
                                            ))
                                        ) : (
                                            <div className="cabinets-admin-page__selector-empty">{t('cabinetsAdmin.noMatchingDoctors')}</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="cabinets-admin-page__setup-info-grid">
                                <div className="cabinets-admin-page__setup-info-card">
                                    <div className="cabinets-admin-page__selector-head">
                                        <div>
                                            <h3>{t('cabinetsAdmin.connectionCode')}</h3>
                                            <p>{t('cabinetsAdmin.connectionCodeHint')}</p>
                                        </div>
                                    </div>
                                    <div className="cabinets-admin-page__connection-code-box">
                                        <strong>{modalConnectionCode || '—'}</strong>
                                        {modalConnectionCode ? (
                                            <button type="button" className="cabinets-admin-page__ghost-btn" onClick={() => void copyConnectionCode(modalConnectionCode)}>
                                                {t('cabinetsAdmin.copyCode')}
                                            </button>
                                        ) : null}
                                    </div>
                                    <p className="cabinets-admin-page__setup-copy">
                                        {draftBootstrapping
                                            ? t('cabinetsAdmin.preparingConnectionCode')
                                            : modalLinkedAgent
                                              ? t('cabinetsAdmin.connectionCodeReady')
                                              : modalConnectionCode
                                                ? t('cabinetsAdmin.connectionCodeReady')
                                                : t('cabinetsAdmin.connectionCodePending')}
                                    </p>
                                </div>

                                <div className="cabinets-admin-page__setup-info-card">
                                    <div className="cabinets-admin-page__selector-head">
                                        <div>
                                            <h3>{t('cabinetsAdmin.agentPairs')}</h3>
                                            <p>{t('cabinetsAdmin.agentDevicesHint')}</p>
                                        </div>
                                        {modalMode === 'create' && setupSession?.id ? (
                                            <button
                                                type="button"
                                                className="cabinets-admin-page__secondary-btn"
                                                onClick={() => void syncCurrentSetupSession(true)}
                                                disabled={refreshingSetupSession}
                                            >
                                                {refreshingSetupSession ? t('cabinetsAdmin.refreshingAgentStatus') : t('cabinetsAdmin.refreshAgentStatus')}
                                            </button>
                                        ) : null}
                                    </div>

                                    <div className="cabinets-admin-page__agent-inline-status">
                                        <div className="cabinets-admin-page__summary-value-row">
                                            <strong>{modalAgentPairOptions.length}</strong>
                                            <span className={`cabinets-admin-page__status-dot ${(modalLinkedAgent?.status || 'offline') === 'online' ? 'is-active' : 'is-inactive'}`} />
                                        </div>
                                        <span className="cabinets-admin-page__agent-inline-text">
                                            {modalLinkedAgent
                                                ? `${t('cabinetsAdmin.linkedAgent')}: ${modalLinkedAgent?.name || '—'} · ${getAgentStatusLabel(modalLinkedAgent?.status, t)}`
                                                : t('cabinetsAdmin.agentNotConnected')}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="cabinets-admin-page__devices-section">
                                <div className="cabinets-admin-page__devices-head">
                                    <div>
                                        <h3>{t('cabinetsAdmin.deviceConfig')}</h3>
                                        <p>{t('cabinetsAdmin.deviceConfigHint')}</p>
                                    </div>
                                </div>

                                {modalAgentPairOptions.length ? (
                                    <div className="cabinets-admin-page__agent-pair-picker">
                                        {modalAgentPairOptions.map((pair) => {
                                            const selectedDevice = form.devices.find(
                                                (device) => device.sourcePairKey === pair.pairKey || getDevicePairValue(device) === pair.value,
                                            );
                                            const checked = Boolean(selectedDevice);
                                            const deviceEditorLanguage = selectedDevice ? getDeviceEditorLanguage(selectedDevice.key) : 'ua';
                                            const deviceEditorValue = selectedDevice ? parseLocalizedEditorValue(selectedDevice.name) : normalizeLocalized({});

                                            return (
                                                <div key={pair.pairKey} className={`cabinets-admin-page__agent-pair-option ${checked ? 'is-selected' : ''}`}>
                                                    <label className="cabinets-admin-page__agent-pair-check">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleAgentPair(pair)}
                                                        />
                                                        <div className="cabinets-admin-page__agent-pair-text">
                                                            <strong>{pair.videoLabel} + {pair.audioLabel}</strong>
                                                            <span>
                                                                {pair.isAvailable ? t('cabinetsAdmin.pairReady') : `${t('cabinetsAdmin.pairUnavailable')} · ${t('cabinetsAdmin.refreshAgentStatus')}`}
                                                            </span>
                                                        </div>
                                                    </label>

                                                    {checked && selectedDevice ? (
                                                        <div className="cabinets-admin-page__agent-pair-config">
                                                            <div className="cabinets-admin-page__pair-summary">
                                                                <span>{selectedDevice.cameraLabel || pair.videoLabel || '—'}</span>
                                                                <span>{selectedDevice.microphoneLabel || pair.audioLabel || '—'}</span>
                                                            </div>

                                                            <label className="cabinets-admin-page__field">
                                                                <span>{t('cabinetsAdmin.deviceName')}</span>
                                                                <div className="cabinets-admin-page__translation-tools">
                                                                    <div className="cabinets-admin-page__translation-tabs">
                                                                        {translationLanguages.map((item) => (
                                                                            <button
                                                                                key={`device-${selectedDevice.key}-${item.key}`}
                                                                                type="button"
                                                                                className={`cabinets-admin-page__translation-tab ${deviceEditorLanguage === item.key ? 'is-active' : ''}`}
                                                                                onClick={() => setDeviceEditorLanguage(selectedDevice.key, item.key)}
                                                                            >
                                                                                {item.label}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        className="cabinets-admin-page__translation-btn"
                                                                        onClick={() => void handleTranslateField(`device:${selectedDevice.key}`, selectedDevice.name, deviceEditorLanguage, 'cabinetDeviceNameI18n')}
                                                                        disabled={translatingTarget === `device:${selectedDevice.key}`}
                                                                    >
                                                                        {translatingTarget === `device:${selectedDevice.key}` ? t('cabinetsAdmin.translating') : t('cabinetsAdmin.autoTranslate')}
                                                                    </button>
                                                                </div>
                                                                <input
                                                                    type="text"
                                                                    value={deviceEditorValue[deviceEditorLanguage]}
                                                                    onChange={(event) => updateDeviceNameTranslation(selectedDevice.key, deviceEditorLanguage, event.target.value)}
                                                                    placeholder={t('cabinetsAdmin.deviceNamePlaceholder')}
                                                                />
                                                            </label>

                                                            <label className="cabinets-admin-page__field cabinets-admin-page__field--compact">
                                                                <span>{t('cabinetsAdmin.startModeLabel')}</span>
                                                                <select
                                                                    value={selectedDevice.startMode}
                                                                    onChange={(event) => updateDeviceStartMode(pair.pairKey, event.target.value as CabinetDeviceStartMode)}
                                                                >
                                                                    <option value="AUTO_ON_VISIT_START">{t('cabinetsAdmin.startMode.AUTO_ON_VISIT_START')}</option>
                                                                    <option value="MANUAL">{t('cabinetsAdmin.startMode.MANUAL')}</option>
                                                                </select>
                                                            </label>

                                                            <div className="cabinets-admin-page__device-actions">
                                                                <button
                                                                    type="button"
                                                                    className="cabinets-admin-page__secondary-btn"
                                                                    onClick={() => void (cameraTestingKey === selectedDevice.key ? stopCameraTest(selectedDevice.key) : startCameraTest(selectedDevice.key))}
                                                                >
                                                                    {cameraTestingKey === selectedDevice.key ? t('cabinetsAdmin.stopCameraTest') : t('cabinetsAdmin.openPreview')}
                                                                </button>
                                                            </div>

                                                            {cameraTestingKey === selectedDevice.key ? (
                                                                <div className="cabinets-admin-page__camera-preview">
                                                                    <video ref={cameraPreviewVideoRef} autoPlay playsInline muted style={{ display: 'none' }} />
                                                                    <img ref={cameraPreviewImgRef} alt={selectedDevice.cameraLabel || 'preview'} style={{ display: 'none' }} />
                                                                    <div ref={cameraPreviewPlaceholderRef} className="cabinets-admin-page__camera-preview-empty">{t('cabinetsAdmin.previewLoading')}</div>
                                                                    <div ref={cameraPreviewMetaRef} className="cabinets-admin-page__camera-preview-meta" style={{ display: 'none' }} />
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="cabinets-admin-page__devices-empty">
                                        {draftBootstrapping
                                            ? t('cabinetsAdmin.preparingConnectionCode')
                                            : modalLinkedAgent
                                              ? t('cabinetsAdmin.waitingPairsFromAgent')
                                              : t('cabinetsAdmin.noAgentPairs')}
                                    </div>
                                )}
                            </div>
                            <div className="cabinets-admin-page__form-actions">
                                <button type="button" className="cabinets-admin-page__secondary-btn" onClick={() => void closeModal()}>{t('cabinetsAdmin.cancel')}</button>
                                <button type="submit" className="cabinets-admin-page__primary-btn" disabled={saving}>{saving ? (<span className="cabinets-admin-page__button-loading"><span className="cabinets-admin-page__button-spinner" />{t('cabinetsAdmin.saving')}</span>) : t('cabinetsAdmin.save')}</button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
