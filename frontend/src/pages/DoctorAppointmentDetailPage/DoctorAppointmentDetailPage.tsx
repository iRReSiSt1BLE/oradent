import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    completeDoctorAppointment,
    startAppointmentAgentPreview,
    getAppointmentAgentPreviewFrame,
    getAppointmentAgentRecordingState,
    startAppointmentAgentRecording,
    stopAppointmentAgentPreview,
    stopAppointmentAgentRecording,
    createDoctorFollowUpAppointment,
    getDoctorAppointmentById,
    getManualAvailabilityDay,
    getManualAvailabilityMonth,
    updateAppointmentVisitFlowStatus,
    type AppointmentAgentRecordingState,
    type AppointmentCabinetDevice,
    type AppointmentItem,
    type ManualAvailabilityDayResponse,
    type ManualAvailabilityMonthDay,
} from '../../shared/api/appointmentApi';
import { getPublicDoctors, type PublicDoctorItem } from '../../shared/api/doctorApi';
import { getActivePublicServices, type ClinicService } from '../../shared/api/servicesApi';
import {
    createDentalSnapshot,
    deleteDentalSnapshot,
    fetchDentalSnapshotFile,
    getAppointmentDentalChart,
    updateDentalSnapshot,
    type DentalChartResponse,
    type DentalSnapshotItem,
    type DentalTargetType,
} from '../../shared/api/dentalChartApi';
import { API_BASE_URL } from '../../shared/api/http';
import {
    DentalFormulaEditor,
    createInitialStates,
    type DentalFormulaState,
} from '../InteractiveDentalChartPage/InteractiveDentalChartPage';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import './DoctorAppointmentDetailPage.scss';

type MediaDeviceOption = {
    id: string;
    label: string;
};

type RecorderSlotState = {
    id: string;
    name: string;
    videoDeviceId: string;
    audioDeviceId: string;
    startMode: 'AUTO_ON_VISIT_START' | 'MANUAL' | string;
    recording: boolean;
    uploading: boolean;
    showPreview: boolean;
    hasMedia: boolean;
    previewActive: boolean;
    previewLoading: boolean;
    previewImageDataUrl: string | null;    previewCapturedAt: string | null;
    previewError: string | null;
    previewWebRtcActive: boolean;
    recordingState: string | null;
    recordingStateLabel: string;
    recordingStateAt: string | null;
    recordingBytes: number | null;
    recordingHash: string | null;
    recordingEntryId: string | null;
    recordingTimeline: AppointmentAgentRecordingState[];
};

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

type DentalSnapshotDraft = {
    title: string;
    description: string;
    targetValue: string;
};
type DentalFormulaHistoryEntry = {
    id: string;
    savedAt: string;
    changedTeeth: number[];
    state: DentalFormulaState;
};
type DentalTargetSelection = {
    targetType: DentalTargetType;
    label: string;
    toothNumber?: number | null;
    jaw?: 'UPPER' | 'LOWER' | 'WHOLE' | null;
};

const DENTAL_TEETH_ROWS = [
    [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
    [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
];

const PREVIEW_RTC_CONFIGURATION: RTCConfiguration = {
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ],
};
function buildDentalFormulaStorageKey(appointment: AppointmentItem | null) {
    const patientId = appointment?.patient?.id || appointment?.patientId || 'unknown-patient';
    return `oradent:dental-formula:${patientId}`;
}

function normalizeDentalFormulaState(value: unknown): DentalFormulaState {
    const empty = createInitialStates(false);

    if (!value || typeof value !== 'object') {
        return empty;
    }

    return {
        ...empty,
        ...(value as DentalFormulaState),
    };
}

function loadStoredDentalFormula(appointment: AppointmentItem | null): DentalFormulaState {
    if (typeof window === 'undefined') {
        return createInitialStates(false);
    }

    try {
        const raw = window.localStorage.getItem(buildDentalFormulaStorageKey(appointment));

        if (!raw) {
            return createInitialStates(false);
        }

        return normalizeDentalFormulaState(JSON.parse(raw));
    } catch {
        return createInitialStates(false);
    }
}
function buildDentalFormulaHistoryKey(appointment: AppointmentItem | null) {
    const patientId = appointment?.patient?.id || appointment?.patientId || 'unknown-patient';
    return `oradent:dental-formula-history:${patientId}`;
}

function loadStoredDentalFormulaHistory(appointment: AppointmentItem | null): DentalFormulaHistoryEntry[] {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(buildDentalFormulaHistoryKey(appointment));
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((item) => ({
                id: typeof item?.id === 'string'
                    ? item.id
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                savedAt: typeof item?.savedAt === 'string'
                    ? item.savedAt
                    : new Date().toISOString(),
                changedTeeth: Array.isArray(item?.changedTeeth)
                    ? item.changedTeeth.filter((value: unknown) => typeof value === 'number')
                    : [],
                state: normalizeDentalFormulaState(item?.state),
            }))
            .sort((a, b) => +new Date(b.savedAt) - +new Date(a.savedAt));
    } catch {
        return [];
    }
}

function saveStoredDentalFormulaHistory(
    appointment: AppointmentItem | null,
    history: DentalFormulaHistoryEntry[],
) {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(
            buildDentalFormulaHistoryKey(appointment),
            JSON.stringify(history.slice(0, 30)),
        );
    } catch {
        // ignore
    }
}

function collectDentalFormulaDiff(before: DentalFormulaState | null, after: DentalFormulaState | null) {
    if (!before || !after) {
        return {
            changedTeeth: [] as number[],
            changedKeys: [] as string[],
        };
    }

    const changedTeeth: number[] = [];
    const changedKeys: string[] = [];

    DENTAL_TEETH_ROWS.flat().forEach((tooth) => {
        const previous = JSON.stringify(before[tooth] || null);
        const current = JSON.stringify(after[tooth] || null);

        if (previous !== current) {
            changedTeeth.push(tooth);
            changedKeys.push(`tooth:${tooth}`);
        }
    });

    return { changedTeeth, changedKeys };
}
function buildPreviewWsUrl(token: string) {
    const url = new URL(API_BASE_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/capture-agent/preview/ws';
    url.search = new URLSearchParams({ token }).toString();
    return url.toString();
}

function normalizeRecordingState(state?: string | null) {
    return String(state || '').trim().toLowerCase();
}

function getRecordingStateLabel(state?: string | null) {
    switch (normalizeRecordingState(state)) {
        case 'start_requested': return 'Команда старту';
        case 'starting': return 'Запуск агента';
        case 'media_opening': return 'Відкриття камери';
        case 'media_ready': return 'Камера готова';
        case 'upload_entry_ready': return 'Журнал запису готовий';
        case 'recording': return 'Йде запис';
        case 'stop_requested': return 'Команда зупинки';
        case 'stopping': return 'Зупинка запису';
        case 'finalizing': return 'Фіналізація файлу';
        case 'queued': return 'Очікує повторного upload';
        case 'uploaded': return 'Відео завантажено';
        case 'failed': return 'Помилка запису';
        default: return state ? String(state) : 'Очікування';
    }
}

function isAgentRecordingState(state?: string | null) {
    return ['starting', 'media_opening', 'media_ready', 'upload_entry_ready', 'recording'].includes(normalizeRecordingState(state));
}

function isAgentBusyState(state?: string | null) {
    return ['start_requested', 'stop_requested', 'stopping', 'finalizing', 'queued'].includes(normalizeRecordingState(state));
}

function isAgentTerminalState(state?: string | null) {
    return ['uploaded', 'failed'].includes(normalizeRecordingState(state));
}

function getRecordingStateTone(state?: string | null) {
    const normalized = normalizeRecordingState(state);
    if (normalized === 'recording') return 'recording';
    if (['start_requested', 'starting', 'media_opening', 'media_ready', 'upload_entry_ready'].includes(normalized)) return 'starting';
    if (['stop_requested', 'stopping', 'finalizing', 'queued'].includes(normalized)) return 'processing';
    if (normalized === 'uploaded') return 'uploaded';
    if (normalized === 'failed') return 'failed';
    return 'idle';
}

function formatBytes(bytes?: number | null) {
    if (!Number.isFinite(bytes || NaN) || !bytes || bytes <= 0) return null;
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function pickLatestRecordingStates(states: AppointmentAgentRecordingState[]) {
    const byCabinetDevice = new Map<string, AppointmentAgentRecordingState>();

    states.forEach((state) => {
        if (!state.cabinetDeviceId) return;
        const previous = byCabinetDevice.get(state.cabinetDeviceId);
        const previousSequence = previous?.sequence ?? 0;
        const nextSequence = state.sequence ?? previousSequence + 1;

        if (!previous || nextSequence >= previousSequence) {
            byCabinetDevice.set(state.cabinetDeviceId, state);
        }
    });

    return byCabinetDevice;
}

function statesForCabinetDevice(states: AppointmentAgentRecordingState[], cabinetDeviceId: string) {
    return states.filter((state) => state.cabinetDeviceId === cabinetDeviceId);
}
function targetValueFromSnapshot(snapshot: DentalSnapshotItem) {
    if (snapshot.targetType === 'TOOTH' && snapshot.toothNumber) {
        return `TOOTH:${snapshot.toothNumber}`;
    }

    if (snapshot.targetType === 'JAW' && snapshot.jaw) {
        return `JAW:${snapshot.jaw}`;
    }

    return 'MOUTH:mouth';
}

function targetValueFromSelection(target: DentalTargetSelection) {
    if (target.targetType === 'TOOTH' && target.toothNumber) {
        return `TOOTH:${target.toothNumber}`;
    }

    if (target.targetType === 'JAW' && target.jaw) {
        return `JAW:${target.jaw === 'LOWER' ? 'LOWER' : 'UPPER'}`;
    }

    return 'MOUTH:mouth';
}

function parseDentalTargetValue(value: string) {
    const [targetType, rawValue] = value.split(':');

    if (targetType === 'TOOTH') {
        const toothNumber = Number(rawValue);

        return {
            targetType: 'TOOTH' as const,
            targetId: `tooth-${toothNumber}`,
            toothNumber,
            jaw: null,
        };
    }

    if (targetType === 'JAW') {
        const jaw = rawValue === 'LOWER' ? ('LOWER' as const) : ('UPPER' as const);

        return {
            targetType: 'JAW' as const,
            targetId: jaw === 'UPPER' ? 'upper-jaw' : 'lower-jaw',
            toothNumber: null,
            jaw,
        };
    }

    return {
        targetType: 'MOUTH' as const,
        targetId: 'mouth',
        toothNumber: null,
        jaw: 'WHOLE' as const,
    };
}

function dentalTargetLabel(target: DentalTargetSelection | DentalSnapshotItem) {
    if (target.targetType === 'TOOTH' && target.toothNumber) {
        return `Зуб ${target.toothNumber}`;
    }

    if (target.targetType === 'JAW') {
        return target.jaw === 'LOWER' ? 'Нижня щелепа' : 'Верхня щелепа';
    }

    return 'Уся ротова порожнина';
}


type CalendarCell =
    | { kind: 'empty'; key: string }
    | { kind: 'day'; key: string; day: ManualAvailabilityMonthDay };

function fullName(a: AppointmentItem | null) {
    if (!a?.patient) return 'Пацієнт не вказаний';
    return `${a.patient.lastName} ${a.patient.firstName}${a.patient.middleName ? ` ${a.patient.middleName}` : ''}`;
}

function formatDateTime(value: string | null) {
    if (!value) return 'Дата не вказана';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('uk-UA');
}

function formatDateOnly(value: string | null) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('uk-UA');
}

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthKey(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, month - 1, 1);
}

function shiftMonthKey(monthKey: string, diff: number) {
    const date = parseMonthKey(monthKey);
    date.setMonth(date.getMonth() + diff);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isBeforeCurrentMonth(monthKey: string) {
    return parseMonthKey(monthKey).getTime() < parseMonthKey(currentMonthKey()).getTime();
}


function getMonthLabel(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    const result = new Intl.DateTimeFormat('uk-UA', {
        month: 'long',
        year: 'numeric',
    }).format(date);
    return result.charAt(0).toUpperCase() + result.slice(1);
}

function getWeekdayLabels() {
    const monday = new Date('2026-04-06T00:00:00');
    return Array.from({ length: 7 }, (_, index) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + index);
        return new Intl.DateTimeFormat('uk-UA', { weekday: 'short' }).format(d);
    });
}

function buildCalendarCells(days: ManualAvailabilityMonthDay[]): CalendarCell[] {
    if (!days.length) return [];

    const firstDate = new Date(`${days[0].date}T00:00:00`);
    const jsDay = firstDate.getDay();
    const mondayBasedIndex = (jsDay + 6) % 7;

    const leading: CalendarCell[] = Array.from({ length: mondayBasedIndex }, (_, i) => ({
        kind: 'empty',
        key: `empty-${i}`,
    }));

    return [
        ...leading,
        ...days.map((day) => ({ kind: 'day' as const, key: day.date, day })),
    ];
}

function parseDbI18nValue(raw: unknown): string {
    if (!raw) return '';

    if (typeof raw === 'object' && raw !== null) {
        const record = raw as Record<string, any>;

        if ('ua' in record || 'en' in record || 'de' in record || 'fr' in record) {
            return record.ua || record.en || record.de || record.fr || '';
        }

        if ('i18n' in record && record.i18n && typeof record.i18n === 'object') {
            const map = record.i18n as Record<string, string>;
            return map.ua || map.en || map.de || map.fr || '';
        }
    }

    if (typeof raw === 'string') {
        if (!raw.includes('__ORADENT_I18N__')) return raw;

        try {
            const start = raw.indexOf('{');
            if (start === -1) return raw;
            const parsed = JSON.parse(raw.slice(start));
            const data = parsed?.data;
            if (data && typeof data === 'object') {
                return data.ua || data.en || data.de || data.fr || raw;
            }
            return raw;
        } catch {
            return raw;
        }
    }

    return String(raw);
}

function serviceLabel(service: ClinicService) {
    const name = parseDbI18nValue((service as any).name) || 'Послуга';
    const minutes = Number((service as any).durationMinutes || 0);
    return `${name} · ${minutes} хв · ${Number(service.priceUah || 0)} грн`;
}

function doctorLabel(doctor: PublicDoctorItem) {
    return `${doctor.lastName || ''} ${doctor.firstName || ''}${doctor.middleName ? ` ${doctor.middleName}` : ''}`.replace(/\s+/g, ' ').trim();
}

function normalizeListText(value: string) {
    return value
        .split('\n')
        .map((item) => item.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
        .filter(Boolean);
}

export default function DoctorAppointmentDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const role = getUserRole();
    const token = getToken();
    const isDoctor = role === 'DOCTOR';

    const [appointment, setAppointment] = useState<AppointmentItem | null>(null);
    const [loading, setLoading] = useState(true);
    const [resourcesLoading, setResourcesLoading] = useState(true);

    const [videoDevices, setVideoDevices] = useState<MediaDeviceOption[]>([]);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceOption[]>([]);
    const [slots, setSlots] = useState<RecorderSlotState[]>([]);
    const [expandedSlots, setExpandedSlots] = useState<Record<string, boolean>>({});

    const [alert, setAlert] = useState<AlertState>(null);
    const [finishing, setFinishing] = useState(false);
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
    const [createdFollowUpDate, setCreatedFollowUpDate] = useState<string | null>(null);

    const [dentalFormulaHistory, setDentalFormulaHistory] = useState<DentalFormulaHistoryEntry[]>([]);
    const [newDentalImageFile, setNewDentalImageFile] = useState<File | null>(null);
    const newDentalImageInputRef = useRef<HTMLInputElement | null>(null);

    const [consultationConclusion, setConsultationConclusion] = useState('');
    const [treatmentPlanText, setTreatmentPlanText] = useState('');
    const [recommendationText, setRecommendationText] = useState('');
    const [medicationText, setMedicationText] = useState('');
    const [consultationEmail, setConsultationEmail] = useState('');

    const [doctors, setDoctors] = useState<PublicDoctorItem[]>([]);
    const [services, setServices] = useState<ClinicService[]>([]);
    const [followUpDoctorId, setFollowUpDoctorId] = useState('');
    const [followUpServiceId, setFollowUpServiceId] = useState('');
    const [month, setMonth] = useState(currentMonthKey());
    const [monthDays, setMonthDays] = useState<ManualAvailabilityMonthDay[]>([]);
    const [loadingMonth, setLoadingMonth] = useState(false);
    const [selectedDate, setSelectedDate] = useState('');
    const [dayData, setDayData] = useState<ManualAvailabilityDayResponse | null>(null);
    const [loadingDay, setLoadingDay] = useState(false);
    const [selectedTime, setSelectedTime] = useState('');
    const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);

    const [dentalChart, setDentalChart] = useState<DentalChartResponse | null>(null);
    const [, setDentalLoading] = useState(false);
    const [dentalSavingId, setDentalSavingId] = useState<string | null>(null);
    const [dentalDeletingId, setDentalDeletingId] = useState<string | null>(null);
    const [dentalDrafts, setDentalDrafts] = useState<Record<string, DentalSnapshotDraft>>({});
    const [newDentalDraft, setNewDentalDraft] = useState<DentalSnapshotDraft>({
        title: '',
        description: '',
        targetValue: 'MOUTH:mouth',
    });
    const [dentalImageUrls, setDentalImageUrls] = useState<Record<string, string>>({});
    const [selectedDentalTarget, setSelectedDentalTarget] = useState<DentalTargetSelection>({
        targetType: 'MOUTH',
        label: 'Уся ротова порожнина',
        jaw: 'WHOLE',
    });

    const [dentalWorkspaceTab, setDentalWorkspaceTab] = useState<'formula' | 'history'>('formula');

    const [dentalFormula, setDentalFormula] = useState<DentalFormulaState>(() =>
        createInitialStates(false),
    );

    const [savedDentalFormula, setSavedDentalFormula] = useState<DentalFormulaState | null>(null);
    const [dentalFormulaChangedTeeth, setDentalFormulaChangedTeeth] = useState<number[]>([]);
    const previewRefs = useRef<Record<string, HTMLVideoElement | HTMLImageElement | null>>({});
    const previewVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
    const previewPeerConnectionsRef = useRef<Record<string, RTCPeerConnection | null>>({});
    const previewSocketsRef = useRef<Record<string, WebSocket | null>>({});
    const previewSessionIdsRef = useRef<Record<string, string | null>>({});
    const previewFallbackTimersRef = useRef<Record<string, number | null>>({});
    const previewRestartTimersRef = useRef<Record<string, number | null>>({});
    const previewRestartAttemptsRef = useRef<Record<string, number>>({});
    const previewStreamsRef = useRef<Record<string, MediaStream | null>>({});
    const streamsRef = useRef<Record<string, MediaStream | null>>({});
    const recordersRef = useRef<Record<string, MediaRecorder | null>>({});
    const previewPollersRef = useRef<Record<string, number | null>>({});
    const previewInFlightRef = useRef<Record<string, boolean>>({});
    const dentalImageUrlsRef = useRef<Record<string, string>>({});
    const failedDentalImageIdsRef = useRef<Set<string>>(new Set());
    const autoStartedRef = useRef<Set<string>>(new Set());
    const finishAfterUploadsRef = useRef(false);
    const slotsRef = useRef<RecorderSlotState[]>([]);
    const expandedSlotsRef = useRef<Record<string, boolean>>({});

    useEffect(() => {
        slotsRef.current = slots;
    }, [slots]);

    useEffect(() => {
        expandedSlotsRef.current = expandedSlots;
    }, [expandedSlots]);

    const hasAnyRecording = useMemo(() => slots.some((slot) => slot.recording), [slots]);
    const hasAnyUploading = useMemo(() => slots.some((slot) => slot.uploading), [slots]);
    const calendarCells = useMemo(() => buildCalendarCells(monthDays), [monthDays]);
    const weekdayLabels = useMemo(() => getWeekdayLabels(), []);
    const freeSlots = useMemo(
        () => (dayData?.slots || []).filter((slot) => slot.state === 'FREE'),
        [dayData],
    );
    const isCompleted = useMemo(() => {
        const visitCompleted = String(appointment?.visitFlowStatus || '').toUpperCase() === 'COMPLETED';
        const statusCompleted = String(appointment?.status || '').toUpperCase() === 'COMPLETED';
        return visitCompleted || statusCompleted;
    }, [appointment?.status, appointment?.visitFlowStatus]);
    const dentalTargetOptions = useMemo(() => [
        { value: 'MOUTH:mouth', label: 'Уся ротова порожнина' },
        { value: 'JAW:UPPER', label: 'Верхня щелепа' },
        { value: 'JAW:LOWER', label: 'Нижня щелепа' },
        ...DENTAL_TEETH_ROWS.flat().map((toothNumber) => ({
            value: `TOOTH:${toothNumber}`,
            label: `Зуб ${toothNumber}`,
        })),
    ], []);
    const currentVisitSnapshots = useMemo(
        () => (dentalChart?.snapshots || []).filter((snapshot) => snapshot.appointmentId === appointment?.id),
        [dentalChart?.snapshots, appointment?.id],
    );

    const previousVisitSnapshots = useMemo(
        () => (dentalChart?.snapshots || []).filter((snapshot) => snapshot.appointmentId !== appointment?.id),
        [dentalChart?.snapshots, appointment?.id],
    );



    useEffect(() => {
        setNewDentalDraft((prev) => ({ ...prev, targetValue: targetValueFromSelection(selectedDentalTarget) }));
    }, [selectedDentalTarget]);

    useEffect(() => {
        if (!appointment?.id) return;

        const stored = loadStoredDentalFormula(appointment);

        setDentalFormula(stored);
        setSavedDentalFormula(stored);
        setDentalFormulaChangedTeeth([]);
        setDentalFormulaHistory(loadStoredDentalFormulaHistory(appointment));
    }, [appointment?.id, appointment?.patient?.id]);

    useEffect(() => {
        async function loadAppointment() {
            if (!id || !isDoctor || !token) {
                setLoading(false);
                return;
            }

            try {
                const item = await getDoctorAppointmentById(token, id);
                setAppointment(item);
                setConsultationConclusion(item.consultationConclusion || '');
                setTreatmentPlanText((item.treatmentPlanItems || []).map((value, index) => `${index + 1}. ${value}`).join('\n'));
                setRecommendationText((item.recommendationItems || []).map((value, index) => `${index + 1}. ${value}`).join('\n'));
                setMedicationText((item.medicationItems || []).map((value, index) => `${index + 1}. ${value}`).join('\n'));
                setConsultationEmail(item.consultationEmail || item.patient?.email || '');
            } catch (err) {
                setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося завантажити прийом' });
            } finally {
                setLoading(false);
            }
        }

        void loadAppointment();
    }, [id, isDoctor, token]);

    async function loadDentalChart(silent = false) {
        if (!appointment?.id || !token) return;

        try {
            if (!silent) setDentalLoading(true);
            const response = await getAppointmentDentalChart(token, appointment.id);
            setDentalChart(response);
            setDentalDrafts((prev) => {
                const next = { ...prev };
                response.snapshots.forEach((snapshot) => {
                    if (!next[snapshot.id]) {
                        next[snapshot.id] = {
                            title: snapshot.title || '',
                            description: snapshot.description || '',
                            targetValue: targetValueFromSnapshot(snapshot),
                        };
                    }
                });
                return next;
            });
        } catch (error) {
            if (!silent) {
                setAlert({ variant: 'error', message: error instanceof Error ? error.message : 'Не вдалося завантажити зубну карту' });
            }
        } finally {
            if (!silent) setDentalLoading(false);
        }
    }

    useEffect(() => {
        if (!appointment?.id || !token) return;

        void loadDentalChart(false);

        if (isCompleted) {
            return;
        }

        const timerId = window.setInterval(() => {
            void loadDentalChart(true);
        }, 30000);

        return () => window.clearInterval(timerId);
    }, [appointment?.id, token, isCompleted]);

    useEffect(() => {
        if (!token || !dentalChart?.snapshots?.length) return;

        dentalChart.snapshots.forEach((snapshot) => {
            if (!snapshot.hasFile) return;
            if (dentalImageUrlsRef.current[snapshot.id]) return;
            if (failedDentalImageIdsRef.current.has(snapshot.id)) return;

            void fetchDentalSnapshotFile(token, snapshot.id)
                .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    dentalImageUrlsRef.current[snapshot.id] = url;
                    setDentalImageUrls((prev) => ({ ...prev, [snapshot.id]: url }));
                })
                .catch(() => {
                    failedDentalImageIdsRef.current.add(snapshot.id);
                });
        });
    }, [dentalChart?.snapshots, token]);

    useEffect(() => {
        return () => {
            Object.values(dentalImageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
            dentalImageUrlsRef.current = {};
            failedDentalImageIdsRef.current.clear();
        };
    }, []);

    useEffect(() => {
        return () => {
            Object.values(dentalImageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
            dentalImageUrlsRef.current = {};
        };
    }, []);

    useEffect(() => {
        setVideoDevices([]);
        setAudioDevices([]);
    }, []);

    useEffect(() => {
        async function loadResources() {
            try {
                setResourcesLoading(true);
                const [doctorsRes, servicesRes] = await Promise.all([getPublicDoctors(), getActivePublicServices()]);
                setDoctors(Array.isArray((doctorsRes as any)?.doctors) ? (doctorsRes as any).doctors : []);
                setServices(Array.isArray((servicesRes as any)?.services) ? (servicesRes as any).services : []);
            } catch {
                setAlert({ variant: 'error', message: 'Не вдалося завантажити дані для повторного запису' });
            } finally {
                setResourcesLoading(false);
            }
        }

        if (isDoctor) {
            void loadResources();
        }
    }, [isDoctor]);

    useEffect(() => {
        const cabinetDevices = appointment?.cabinet?.devices || [];
        const preparedSlots = cabinetDevices.map((device: AppointmentCabinetDevice) => ({
            id: device.id,
            name: device.name,
            videoDeviceId: device.cameraDeviceId || '',
            audioDeviceId: device.microphoneDeviceId || '',
            startMode: device.startMode || 'MANUAL',
            recording: false,
            uploading: false,
            showPreview: false,
            hasMedia: Boolean(device.cameraDeviceId || device.microphoneDeviceId),
            previewActive: false,
            previewLoading: false,
            previewImageDataUrl: null,
            previewCapturedAt: null,
            previewError: null,
            previewWebRtcActive: false,
            recordingState: null,
            recordingStateLabel: 'Очікування',
            recordingStateAt: null,
            recordingBytes: null,
            recordingHash: null,
            recordingEntryId: null,
            recordingTimeline: [],
        }));

        setSlots(preparedSlots);
        setExpandedSlots(Object.fromEntries(preparedSlots.map((slot) => [slot.id, false])));
    }, [appointment?.cabinet?.devices, videoDevices, audioDevices]);

    useEffect(() => {
        if (!appointment?.id || !token || appointment.recordingCompleted || statusUpdating || isCompleted) return;
        if (String(appointment.visitFlowStatus || '').toUpperCase() === 'IN_PROGRESS') return;

        setStatusUpdating(true);
        void updateAppointmentVisitFlowStatus(token, appointment.id, 'IN_PROGRESS')
            .then(() => setAppointment((prev) => (prev ? { ...prev, visitFlowStatus: 'IN_PROGRESS' } : prev)))
            .catch(() => null)
            .finally(() => setStatusUpdating(false));
    }, [appointment?.id, appointment?.recordingCompleted, appointment?.visitFlowStatus, isCompleted, statusUpdating, token]);

    useEffect(() => {
        if (!appointment || appointment.recordingCompleted || isCompleted) return;
        slots.forEach((slot) => {
            if (slot.startMode !== 'AUTO_ON_VISIT_START') return;
            if (slot.recording || slot.uploading || !slot.hasMedia) return;
            if (autoStartedRef.current.has(slot.id)) return;
            void startRecording(slot.id, { auto: true });
        });
    }, [appointment, slots, isCompleted]);

    useEffect(() => {
        return () => {
            Object.values(previewPollersRef.current).forEach((timerId) => {
                if (typeof timerId === 'number') {
                    window.clearInterval(timerId);
                }
            });
            previewPollersRef.current = {};
            previewInFlightRef.current = {};
            Object.values(previewRestartTimersRef.current).forEach((timerId) => {
                if (typeof timerId === 'number') {
                    window.clearTimeout(timerId);
                }
            });
            previewRestartTimersRef.current = {};
            previewRestartAttemptsRef.current = {};
            Object.keys(previewSocketsRef.current).forEach((slotId) => cleanupWebRtcPreview(slotId));

            if (appointment?.id && token) {
                slots.forEach((slot) => {
                    void stopAppointmentAgentPreview(token, appointment.id, { cabinetDeviceId: slot.id }).catch(() => null);
                });
            }

            Object.values(recordersRef.current).forEach((recorder) => {
                if (recorder && recorder.state !== 'inactive') recorder.stop();
            });
            Object.values(streamsRef.current).forEach((stream) => {
                if (stream) stream.getTracks().forEach((track) => track.stop());
            });
        };
    }, []);



    useEffect(() => {
        if (!appointment?.id || !token) return;

        let cancelled = false;
        let timerId: number | null = null;

        const applyRecordingState = async () => {
            try {
                const response = await getAppointmentAgentRecordingState(token, appointment.id);
                if (cancelled) return;

                const timeline = Array.isArray(response.states) ? response.states : [];
                const currentStates = Array.isArray(response.currentStates) && response.currentStates.length
                    ? response.currentStates
                    : Array.from(pickLatestRecordingStates(timeline).values());
                const latestByDevice = pickLatestRecordingStates(currentStates.length ? currentStates : timeline);

                setSlots((prev) => prev.map((slot) => {
                    const state = latestByDevice.get(slot.id);
                    if (!state) return slot;

                    const stateName = normalizeRecordingState(state.state);
                    const recording = isAgentRecordingState(stateName);
                    const uploading = isAgentBusyState(stateName);
                    const terminal = isAgentTerminalState(stateName);
                    const slotTimeline = statesForCabinetDevice(timeline, slot.id);

                    return {
                        ...slot,
                        recording,
                        uploading,
                        showPreview: terminal ? false : (slot.showPreview || recording || uploading),
                        recordingState: state.state || null,
                        recordingStateLabel: getRecordingStateLabel(state.state),
                        recordingStateAt: state.reportedAt || state.receivedAt || null,
                        recordingBytes: typeof state.totalBytes === 'number' ? state.totalBytes : slot.recordingBytes,
                        recordingHash: state.sha256Hash || slot.recordingHash,
                        recordingEntryId: state.entryId || slot.recordingEntryId,
                        recordingTimeline: slotTimeline,
                    };
                }));
            } catch {
                // State polling is diagnostic. Recording itself should continue even if this request fails.
            }
        };

        void applyRecordingState();
        timerId = window.setInterval(() => {
            void applyRecordingState();
        }, 3000);

        return () => {
            cancelled = true;
            if (typeof timerId === 'number') {
                window.clearInterval(timerId);
            }
        };
    }, [appointment?.id, token]);



    useEffect(() => {
        if (!finishAfterUploadsRef.current) return;
        if (hasAnyRecording || hasAnyUploading) return;
        finishAfterUploadsRef.current = false;
        void finalizeAppointment();
    }, [hasAnyRecording, hasAnyUploading]);

    useEffect(() => {
        if (!followUpDoctorId || !followUpServiceId) {
            setMonthDays([]);
            setSelectedDate('');
            setSelectedTime('');
            setDayData(null);
            setSelectedCabinetId(null);
            return;
        }

        async function loadMonth() {
            try {
                setLoadingMonth(true);
                const response = await getManualAvailabilityMonth({
                    doctorId: followUpDoctorId,
                    serviceId: followUpServiceId,
                    month,
                });
                setMonthDays(Array.isArray(response.days) ? response.days : []);
            } catch (err) {
                setMonthDays([]);
                setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося завантажити календар' });
            } finally {
                setLoadingMonth(false);
            }
        }

        setSelectedDate('');
        setSelectedTime('');
        setDayData(null);
        setSelectedCabinetId(null);
        void loadMonth();
    }, [followUpDoctorId, followUpServiceId, month]);

    useEffect(() => {
        if (!followUpDoctorId || !followUpServiceId || !selectedDate) {
            setDayData(null);
            setSelectedTime('');
            setSelectedCabinetId(null);
            return;
        }

        async function loadDay() {
            try {
                setLoadingDay(true);
                const response = await getManualAvailabilityDay({
                    doctorId: followUpDoctorId,
                    serviceId: followUpServiceId,
                    date: selectedDate,
                });
                setDayData(response);
            } catch (err) {
                setDayData(null);
                setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося завантажити слоти' });
            } finally {
                setLoadingDay(false);
            }
        }

        setSelectedTime('');
        setSelectedCabinetId(null);
        void loadDay();
    }, [followUpDoctorId, followUpServiceId, selectedDate]);

    function updateSlot(slotId: string, patch: Partial<RecorderSlotState>) {
        setSlots((prev) => prev.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)));
    }

    function updateDentalDraft(snapshotId: string, patch: Partial<DentalSnapshotDraft>) {
        setDentalDrafts((prev) => ({
            ...prev,
            [snapshotId]: {
                title: prev[snapshotId]?.title || '',
                description: prev[snapshotId]?.description || '',
                targetValue: prev[snapshotId]?.targetValue || 'MOUTH:mouth',
                ...patch,
            },
        }));
    }

    async function saveDentalSnapshot(snapshot: DentalSnapshotItem) {
        if (!token) return;

        const draft = dentalDrafts[snapshot.id] || {
            title: snapshot.title || '',
            description: snapshot.description || '',
            targetValue: targetValueFromSnapshot(snapshot),
        };
        const target = parseDentalTargetValue(draft.targetValue);

        try {
            setDentalSavingId(snapshot.id);
            await updateDentalSnapshot(token, snapshot.id, {
                ...target,
                title: draft.title,
                description: draft.description,
            });
            await loadDentalChart(true);
            setAlert({ variant: 'success', message: 'Знімок оновлено' });
        } catch (error) {
            setAlert({ variant: 'error', message: error instanceof Error ? error.message : 'Не вдалося оновити знімок' });
        } finally {
            setDentalSavingId(null);
        }
    }


    async function captureWebsiteScreenshot() {
        if (!navigator.mediaDevices?.getDisplayMedia) {
            setAlert({ variant: 'error', message: 'Браузер не підтримує знімок екрана.' });
            return;
        }

        let stream: MediaStream | null = null;

        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false,
            });

            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;

            await video.play();
            await new Promise((resolve) => window.setTimeout(resolve, 250));

            const width = video.videoWidth || 1280;
            const height = video.videoHeight || 720;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');

            if (!context) {
                throw new Error('Не вдалося підготувати canvas для знімка.');
            }

            context.drawImage(video, 0, 0, width, height);

            const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.9),
            );

            if (!blob) {
                throw new Error('Не вдалося створити файл знімка.');
            }

            const file = new File([blob], `dental-screen-${Date.now()}.jpg`, {
                type: 'image/jpeg',
            });

            setNewDentalImageFile(file);
            setAlert({ variant: 'success', message: 'Знімок екрана готовий до збереження.' });
        } catch (error) {
            setAlert({
                variant: 'error',
                message: error instanceof Error ? error.message : 'Не вдалося зробити знімок екрана.',
            });
        } finally {
            stream?.getTracks().forEach((track) => track.stop());
        }
    }

    async function createDentalNote() {
        if (!token || !appointment?.id || isCompleted) return;

        const target = parseDentalTargetValue(newDentalDraft.targetValue);
        const title = newDentalDraft.title.trim();
        const description = newDentalDraft.description.trim();

        if (!title && !description && !newDentalImageFile) {
            setAlert({ variant: 'error', message: 'Додайте текст або зображення.' });
            return;
        }

        try {
            setDentalSavingId('new');

            await createDentalSnapshot(
                token,
                appointment.id,
                {
                    ...target,
                    title,
                    description,
                },
                newDentalImageFile,
            );
            setNewDentalDraft({
                title: '',
                description: '',
                targetValue: targetValueFromSelection(selectedDentalTarget),
            });

            clearNewDentalImage();

            await loadDentalChart(true);
            setAlert({ variant: 'success', message: 'Запис додано' });
        } catch (error) {
            setAlert({
                variant: 'error',
                message: error instanceof Error ? error.message : 'Не вдалося додати запис',
            });
        } finally {
            setDentalSavingId(null);
        }
    }


    function handleNewDentalImageChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0] || null;
        setNewDentalImageFile(file);
    }

    function clearNewDentalImage() {
        setNewDentalImageFile(null);

        if (newDentalImageInputRef.current) {
            newDentalImageInputRef.current.value = '';
        }
    }

    function persistDentalFormula(nextState: DentalFormulaState, changedTeeth: number[]) {
        if (!appointment?.id) return;

        const normalized = normalizeDentalFormulaState(nextState);

        const nextHistory =
            changedTeeth.length > 0
                ? [
                    {
                        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        savedAt: new Date().toISOString(),
                        changedTeeth,
                        state: normalized,
                    },
                    ...dentalFormulaHistory,
                ].slice(0, 30)
                : dentalFormulaHistory;

        try {
            window.localStorage.setItem(
                buildDentalFormulaStorageKey(appointment),
                JSON.stringify(normalized),
            );

            saveStoredDentalFormulaHistory(appointment, nextHistory);

            setSavedDentalFormula(normalized);
            setDentalFormulaHistory(nextHistory);
        } catch {
            // localStorage can be unavailable or full; the UI should not break.
        }
    }

    function handleDentalFormulaChange(nextState: DentalFormulaState) {
        const normalized = normalizeDentalFormulaState(nextState);

        const diff = savedDentalFormula
            ? collectDentalFormulaDiff(savedDentalFormula, normalized)
            : { changedTeeth: [] as number[], changedKeys: [] as string[] };

        setDentalFormula(normalized);
        setDentalFormulaChangedTeeth(diff.changedTeeth);

        persistDentalFormula(normalized, diff.changedTeeth);
    }

    async function removeDentalSnapshot(snapshotId: string) {
        if (!token || isCompleted) return;

        try {
            setDentalDeletingId(snapshotId);
            await deleteDentalSnapshot(token, snapshotId);
            await loadDentalChart(true);
            setAlert({ variant: 'success', message: 'Запис видалено' });
        } catch (error) {
            setAlert({ variant: 'error', message: error instanceof Error ? error.message : 'Не вдалося видалити запис' });
        } finally {
            setDentalDeletingId(null);
        }
    }

    function clearPreviewPoller(slotId: string) {
        const timerId = previewPollersRef.current[slotId];
        if (typeof timerId === 'number') {
            window.clearInterval(timerId);
        }
        delete previewPollersRef.current[slotId];
        delete previewInFlightRef.current[slotId];
    }

    function clearPreviewRestart(slotId: string) {
        const timerId = previewRestartTimersRef.current[slotId];
        if (typeof timerId === 'number') {
            window.clearTimeout(timerId);
        }
        delete previewRestartTimersRef.current[slotId];
        delete previewRestartAttemptsRef.current[slotId];
    }

    function shouldAutoRecoverPreview(slotId: string) {
        const slot = slotsRef.current.find((item) => item.id === slotId);
        if (!slot?.videoDeviceId) return false;
        return Boolean(slot.showPreview || slot.previewActive || slot.recording || slot.uploading || expandedSlotsRef.current[slotId]);
    }

    function schedulePreviewRestart(slotId: string, reason?: string) {
        if (!appointment?.id || !token) return;
        if (!shouldAutoRecoverPreview(slotId)) return;
        if (typeof previewRestartTimersRef.current[slotId] === 'number') return;

        const attempt = (previewRestartAttemptsRef.current[slotId] || 0) + 1;
        previewRestartAttemptsRef.current[slotId] = attempt;
        const delayMs = Math.min(6000, 900 + attempt * 600);
        const message = reason && /failed to fetch/i.test(reason)
            ? 'Backend тимчасово недоступний. Відновлюємо preview…'
            : 'Відновлюємо preview після reconnect…';

        updateSlot(slotId, {
            showPreview: true,
            previewActive: true,
            previewLoading: true,
            previewError: message,
            previewWebRtcActive: false,
        });

        previewRestartTimersRef.current[slotId] = window.setTimeout(() => {
            delete previewRestartTimersRef.current[slotId];
            if (!shouldAutoRecoverPreview(slotId)) return;
            void startSlotPreview(slotId, { recover: true });
        }, delayMs);
    }

    function cleanupWebRtcPreview(slotId: string) {
        const fallbackTimer = previewFallbackTimersRef.current[slotId];
        if (typeof fallbackTimer === 'number') {
            window.clearTimeout(fallbackTimer);
        }
        delete previewFallbackTimersRef.current[slotId];

        const sessionId = previewSessionIdsRef.current[slotId];
        const socket = previewSocketsRef.current[slotId];
        if (socket && socket.readyState === WebSocket.OPEN && sessionId) {
            try {
                socket.send(JSON.stringify({ type: 'preview.stop', payload: { previewSessionId: sessionId } }));
            } catch {
                // noop
            }
        }
        if (socket) {
            try {
                socket.onopen = null;
                socket.onmessage = null;
                socket.onerror = null;
                socket.onclose = null;
                socket.close();
            } catch {
                // noop
            }
        }
        delete previewSocketsRef.current[slotId];
        delete previewSessionIdsRef.current[slotId];

        const pc = previewPeerConnectionsRef.current[slotId];
        if (pc) {
            try {
                pc.ontrack = null;
                pc.onicecandidate = null;
                pc.onconnectionstatechange = null;
                pc.close();
            } catch {
                // noop
            }
        }
        delete previewPeerConnectionsRef.current[slotId];

        const stream = previewStreamsRef.current[slotId];
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
        }
        delete previewStreamsRef.current[slotId];

        const video = previewVideoRefs.current[slotId];
        if (video) {
            video.pause();
            video.srcObject = null;
        }
    }

    async function startSlotWebRtcPreview(slotId: string): Promise<boolean> {
        if (!appointment?.id || !token || typeof RTCPeerConnection === 'undefined') return false;

        return new Promise<boolean>((resolve) => {
            let settled = false;
            const candidateQueue: RTCIceCandidateInit[] = [];

            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                const timerId = previewFallbackTimersRef.current[slotId];
                if (typeof timerId === 'number') window.clearTimeout(timerId);
                delete previewFallbackTimersRef.current[slotId];
                resolve(value);
            };

            try {
                cleanupWebRtcPreview(slotId);
                const socket = new WebSocket(buildPreviewWsUrl(token));
                const pc = new RTCPeerConnection(PREVIEW_RTC_CONFIGURATION);

                previewSocketsRef.current[slotId] = socket;
                previewPeerConnectionsRef.current[slotId] = pc;

                pc.addTransceiver('video', { direction: 'recvonly' });

                pc.ontrack = (event) => {
                    const stream = event.streams[0] || new MediaStream([event.track]);
                    previewStreamsRef.current[slotId] = stream;
                    const video = previewVideoRefs.current[slotId];
                    if (video) {
                        video.srcObject = stream;
                        void video.play().catch(() => undefined);
                    }
                    previewRestartAttemptsRef.current[slotId] = 0;
                    updateSlot(slotId, {
                        previewLoading: false,
                        previewError: null,
                        previewImageDataUrl: null,
                previewCapturedAt: new Date().toISOString(),
                        previewWebRtcActive: true,
                    });
                    finish(true);
                };

                pc.onicecandidate = (event) => {
                    if (!event.candidate) return;
                    const candidate = event.candidate.toJSON();
                    const previewSessionId = previewSessionIdsRef.current[slotId];
                    if (!previewSessionId || socket.readyState !== WebSocket.OPEN) {
                        candidateQueue.push(candidate);
                        return;
                    }
                    socket.send(JSON.stringify({ type: 'preview.ice', payload: { previewSessionId, candidate } }));
                };

                pc.onconnectionstatechange = () => {
                    if (pc.connectionState === 'connected') {
                        previewRestartAttemptsRef.current[slotId] = 0;
                        updateSlot(slotId, { previewError: null, previewLoading: false });
                        return;
                    }
                    if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
                        if (settled) {
                            schedulePreviewRestart(slotId, `WebRTC ${pc.connectionState}`);
                        } else {
                            finish(false);
                        }
                    }
                };

                socket.onopen = () => {
                    void (async () => {
                        try {
                            const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
                            await pc.setLocalDescription(offer);
                            socket.send(JSON.stringify({
                                type: 'preview.offer',
                                payload: {
                                    appointmentId: appointment.id,
                                    cabinetDeviceId: slotId,
                                    description: pc.localDescription
                                        ? { type: pc.localDescription.type, sdp: pc.localDescription.sdp || undefined }
                                        : offer,
                                },
                            }));
                        } catch {
                            finish(false);
                        }
                    })();
                };

                socket.onmessage = (event) => {
                    void (async () => {
                        try {
                            const message = JSON.parse(String(event.data || '{}')) as { type?: string; payload?: any };
                            const payload = message.payload || {};

                            if (message.type === 'preview.session' && payload.previewSessionId) {
                                previewSessionIdsRef.current[slotId] = String(payload.previewSessionId);
                                while (candidateQueue.length) {
                                    const candidate = candidateQueue.shift();
                                    socket.send(JSON.stringify({
                                        type: 'preview.ice',
                                        payload: { previewSessionId: payload.previewSessionId, candidate },
                                    }));
                                }
                                return;
                            }

                            if (message.type === 'preview.signal') {
                                if (payload.previewSessionId) {
                                    previewSessionIdsRef.current[slotId] = String(payload.previewSessionId);
                                }
                                if (payload.error) {
                                    updateSlot(slotId, { previewError: String(payload.error) });
                                    finish(false);
                                    return;
                                }
                                if (payload.description) {
                                    await pc.setRemoteDescription(payload.description);
                                }
                                if (payload.candidate) {
                                    await pc.addIceCandidate(payload.candidate);
                                }
                                return;
                            }

                            if (message.type === 'preview.error') {
                                updateSlot(slotId, { previewError: String(payload.message || 'WebRTC preview error') });
                                finish(false);
                            }
                        } catch {
                            finish(false);
                        }
                    })();
                };

                socket.onerror = () => {
                    if (settled) {
                        schedulePreviewRestart(slotId, 'Preview signaling socket error');
                    } else {
                        finish(false);
                    }
                };
                socket.onclose = () => {
                    if (!settled) {
                        finish(false);
                        return;
                    }
                    schedulePreviewRestart(slotId, 'Preview signaling socket closed');
                };

                previewFallbackTimersRef.current[slotId] = window.setTimeout(() => finish(false), 7000);
            } catch {
                finish(false);
            }
        });
    }

    async function startSlotFramePreview(slotId: string) {
        if (!appointment?.id || !token) return;

        try {
            await startAppointmentAgentPreview(token, appointment.id, {
                cabinetDeviceId: slotId,
                fps: 12,
                width: 960,
                quality: 0.82,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Не вдалося запустити live-preview.';
            updateSlot(slotId, {
                showPreview: true,
                previewActive: true,
                previewLoading: true,
                previewError: /failed to fetch/i.test(message)
                    ? 'Backend тимчасово недоступний. Відновлюємо preview…'
                    : message,
                previewWebRtcActive: false,
            });
            schedulePreviewRestart(slotId, message);
            return;
        }

        const poll = async () => {
            if (previewInFlightRef.current[slotId]) {
                return;
            }

            previewInFlightRef.current[slotId] = true;
            try {
                const frame = await getAppointmentAgentPreviewFrame(token, appointment.id, slotId);
                if (frame.preview?.imageDataUrl) {
                    previewRestartAttemptsRef.current[slotId] = 0;
                    updateSlot(slotId, {
                        previewLoading: false,
                        previewError: null,
                        previewWebRtcActive: false,
                        previewImageDataUrl: frame.preview.imageDataUrl,
                        previewCapturedAt: frame.preview.capturedAt,
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Не вдалося отримати кадр preview.';
                updateSlot(slotId, {
                    previewLoading: true,
                    previewError: /failed to fetch/i.test(message)
                        ? 'Backend тимчасово недоступний. Відновлюємо preview…'
                        : message,
                });
                schedulePreviewRestart(slotId, message);
            } finally {
                previewInFlightRef.current[slotId] = false;
            }
        };

        await poll();
        previewPollersRef.current[slotId] = window.setInterval(() => {
            void poll();
        }, 250);
    }

    async function startSlotPreview(slotId: string, options?: { recover?: boolean }) {
        if (!appointment?.id || !token) return;

        const slot = slots.find((item) => item.id === slotId);
        if (!slot?.videoDeviceId) {
            updateSlot(slotId, { previewActive: false, previewLoading: false, previewError: 'Для цього джерела не налаштовано камеру.' });
            return;
        }

        if (!options?.recover) {
            clearPreviewRestart(slotId);
        }
        clearPreviewPoller(slotId);
        cleanupWebRtcPreview(slotId);
        updateSlot(slotId, {
            showPreview: true,
            previewActive: true,
            previewLoading: true,
            previewError: null,
            previewImageDataUrl: null,
                previewCapturedAt: null,
            previewWebRtcActive: false,
        });

        const webRtcStarted = await startSlotWebRtcPreview(slotId);
        if (webRtcStarted) return;

        cleanupWebRtcPreview(slotId);
        await startSlotFramePreview(slotId);
    }

    async function stopSlotPreview(slotId: string, options?: { clearFrame?: boolean }) {
        clearPreviewRestart(slotId);
        clearPreviewPoller(slotId);
        cleanupWebRtcPreview(slotId);

        if (appointment?.id && token) {
            await stopAppointmentAgentPreview(token, appointment.id, { cabinetDeviceId: slotId }).catch(() => null);
        }

        updateSlot(slotId, {
            previewActive: false,
            previewLoading: false,
            previewError: null,
            showPreview: false,
            previewWebRtcActive: false,
            ...(options?.clearFrame === false ? {} : { previewImageDataUrl: null, previewCapturedAt: null }),
        });
    }

    function toggleSlotExpanded(slotId: string) {
        const nextOpen = !Boolean(expandedSlots[slotId]);
        setExpandedSlots((prev) => ({ ...prev, [slotId]: nextOpen }));

        const slot = slots.find((item) => item.id === slotId);
        if (!slot) return;

        if (!nextOpen) {
            void stopSlotPreview(slotId);
            return;
        }

        if (slot.videoDeviceId) {
            void startSlotPreview(slotId);
        }
    }

    async function startRecording(slotId: string, options?: { auto?: boolean }) {
        if (!appointment?.id || !token || isCompleted) {
            setAlert({ variant: 'error', message: 'Потрібна авторизація або прийом уже завершено' });
            return;
        }

        const slot = slots.find((item) => item.id === slotId);
        if (!slot || slot.recording || slot.uploading) return;
        if (!slot.hasMedia) {
            if (!options?.auto) {
                setAlert({ variant: 'error', message: 'Для цього джерела не налаштовано пару камера + мікрофон.' });
            }
            return;
        }

        updateSlot(slotId, { uploading: true });
        try {
            await startAppointmentAgentRecording(token, appointment.id, { cabinetDeviceId: slotId });
            setExpandedSlots((prev) => ({ ...prev, [slotId]: true }));
            updateSlot(slotId, {
                recording: true,
                uploading: false,
                showPreview: true,
                previewLoading: Boolean(slot.videoDeviceId),
                previewError: null,
                previewImageDataUrl: null,
                previewCapturedAt: null,
                recordingState: 'start_requested',
                recordingStateLabel: getRecordingStateLabel('start_requested'),
                recordingStateAt: new Date().toISOString(),
            });
            if (slot.videoDeviceId) {
                void startSlotPreview(slotId);
            }
            if (!options?.auto) {
                setAlert({ variant: 'success', message: 'Команду старту запису надіслано' });
            }
        } catch (err) {
            updateSlot(slotId, { recording: false, uploading: false, showPreview: false, previewActive: false, previewLoading: false });
            if (!options?.auto) {
                setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося почати запис' });
            }
        }
    }

    async function stopRecording(slotId: string) {
        if (!appointment?.id || !token) return;
        const slot = slots.find((item) => item.id === slotId);
        if (!slot || slot.uploading || !slot.recording) return;

        updateSlot(slotId, {
            uploading: true,
            recordingState: 'stop_requested',
            recordingStateLabel: getRecordingStateLabel('stop_requested'),
            recordingStateAt: new Date().toISOString(),
        });
        try {
            await stopAppointmentAgentRecording(token, appointment.id, { cabinetDeviceId: slotId });
            await stopSlotPreview(slotId);
            updateSlot(slotId, {
                recording: false,
                uploading: false,
                showPreview: false,
                previewActive: false,
                previewLoading: false,
                previewImageDataUrl: null,
                previewCapturedAt: null,
            });
        } catch (err) {
            updateSlot(slotId, { uploading: false });
            setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося зупинити запис' });
        }
    }

    async function finalizeAppointment() {
        if (!appointment?.id || !token) return;

        const treatmentPlanItems = normalizeListText(treatmentPlanText);
        const recommendationItems = normalizeListText(recommendationText);
        const medicationItems = normalizeListText(medicationText);

        if (!consultationConclusion.trim()) {
            setAlert({ variant: 'error', message: 'Заповни консультативний висновок' });
            return;
        }

        setFinishing(true);
        try {
            const result = await completeDoctorAppointment(token, appointment.id, {
                consultationConclusion: consultationConclusion.trim(),
                treatmentPlanItems,
                recommendationItems,
                medicationItems,
                email: consultationEmail.trim() || undefined,
                nextVisitDate: createdFollowUpDate,
            });

            setAppointment(result.appointment);
            setAlert({ variant: 'success', message: result.message || 'Прийом завершено' });
            window.setTimeout(() => {
                navigate('/doctor/appointments-week');
            }, 650);
        } catch (err) {
            setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося завершити прийом' });
        } finally {
            setFinishing(false);
        }
    }

    function finishAppointment() {
        if (hasAnyUploading || finishing) return;
        if (hasAnyRecording) {
            finishAfterUploadsRef.current = true;
            slots.filter((slot) => slot.recording).forEach((slot) => stopRecording(slot.id));
            return;
        }
        void finalizeAppointment();
    }

    async function submitFollowUpBooking() {
        if (!token || !appointment?.id) return;
        if (!followUpDoctorId || !followUpServiceId || !selectedDate || !selectedTime) {
            setAlert({ variant: 'error', message: 'Оберіть лікаря, послугу, дату і час повторного візиту' });
            return;
        }

        setFollowUpSubmitting(true);
        try {
            const result = await createDoctorFollowUpAppointment(token, appointment.id, {
                doctorId: followUpDoctorId,
                serviceId: followUpServiceId,
                appointmentDate: `${selectedDate}T${selectedTime}`,
                cabinetId: selectedCabinetId || undefined,
                email: consultationEmail.trim() || undefined,
            });

            const nextDate = result.appointment?.appointmentDate || `${selectedDate}T${selectedTime}`;
            setCreatedFollowUpDate(nextDate);
            setAlert({ variant: 'success', message: result.message || 'Пацієнта записано на наступний візит' });
        } catch (err) {
            setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося створити повторний запис' });
        } finally {
            setFollowUpSubmitting(false);
        }
    }

    if (!isDoctor) {
        return (
            <div className="page-shell doctor-appointment-detail">
                <div className="container doctor-appointment-detail__container">
                    <section className="doctor-appointment-detail__card">
                        <h1 className="doctor-appointment-detail__title">ПРИЙОМ</h1>
                        <div className="doctor-appointment-detail__state">Ця сторінка доступна тільки для лікаря.</div>
                    </section>
                </div>
            </div>
        );
    }



    function renderDentalSnapshotCards(items: DentalSnapshotItem[], emptyText: string, canManage = true) {
        if (!items.length) {
            return <div className="doctor-appointment-detail__empty-note">{emptyText}</div>;
        }

        return (
            <div className="doctor-appointment-detail__snapshot-list doctor-appointment-detail__snapshot-list--clean">
                {items.map((snapshot) => {
                    const draft = dentalDrafts[snapshot.id] || {
                        title: snapshot.title || '',
                        description: snapshot.description || '',
                        targetValue: targetValueFromSnapshot(snapshot),
                    };

                    const snapshotLocked = Boolean(snapshot.title || snapshot.description);
                    const imageUrl = snapshot.hasFile ? dentalImageUrls[snapshot.id] : '';
                    const hasImage = Boolean(imageUrl);
                    const canEditSnapshot = canManage && !snapshotLocked && !isCompleted;
                    const canDeleteSnapshot = canManage && !isCompleted;

                    return (
                        <article
                            key={snapshot.id}
                            className={`doctor-appointment-detail__snapshot-record ${
                                hasImage ? '' : 'doctor-appointment-detail__snapshot-record--text-only'
                            }`}
                        >
                            {hasImage ? (
                                <a
                                    href={imageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="doctor-appointment-detail__snapshot-record-image"
                                >
                                    <img src={imageUrl} alt={snapshot.title || 'Dental snapshot'} />
                                </a>
                            ) : null}

                            <div className="doctor-appointment-detail__snapshot-record-body">
                                <div className="doctor-appointment-detail__snapshot-record-top">
                                    <div>
                                        <span>{snapshot.doctorName || 'Лікар не вказаний'}</span>
                                        {snapshot.title ? <strong>{snapshot.title}</strong> : null}
                                    </div>

                                    <time>{formatDateTime(snapshot.capturedAt || snapshot.createdAt)}</time>
                                </div>

                                {canEditSnapshot ? (
                                    <div className="doctor-appointment-detail__snapshot-inline-editor">
                                        <label className="doctor-appointment-detail__field doctor-appointment-detail__field--soft">
                                            <span>Область</span>
                                            <select
                                                value={draft.targetValue}
                                                onChange={(event) =>
                                                    updateDentalDraft(snapshot.id, {
                                                        targetValue: event.target.value,
                                                    })
                                                }
                                            >
                                                {dentalTargetOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="doctor-appointment-detail__field doctor-appointment-detail__field--soft">
                                            <span>Підпис</span>
                                            <input
                                                value={draft.title}
                                                onChange={(event) =>
                                                    updateDentalDraft(snapshot.id, {
                                                        title: event.target.value,
                                                    })
                                                }
                                                placeholder="Короткий підпис"
                                            />
                                        </label>

                                        <details className="doctor-appointment-detail__description-toggle">
                                            <summary>{draft.description ? 'Редагувати опис' : '+ Додати опис'}</summary>

                                            <label className="doctor-appointment-detail__field doctor-appointment-detail__field--soft doctor-appointment-detail__field--wide">
                                                <textarea
                                                    value={draft.description}
                                                    onChange={(event) =>
                                                        updateDentalDraft(snapshot.id, {
                                                            description: event.target.value,
                                                        })
                                                    }
                                                    placeholder="Додатковий контекст за потреби"
                                                />
                                            </label>

                                            {draft.description ? (
                                                <button
                                                    type="button"
                                                    className="doctor-appointment-detail__mini-delete-btn"
                                                    onClick={() =>
                                                        updateDentalDraft(snapshot.id, {
                                                            description: '',
                                                        })
                                                    }
                                                >
                                                    Прибрати опис
                                                </button>
                                            ) : null}
                                        </details>

                                        <div className="doctor-appointment-detail__snapshot-record-actions">
                                            <button
                                                type="button"
                                                className="doctor-appointment-detail__ghost-btn doctor-appointment-detail__save-snapshot-btn"
                                                onClick={() => void saveDentalSnapshot(snapshot)}
                                                disabled={dentalSavingId === snapshot.id || !draft.title.trim()}
                                            >
                                                {dentalSavingId === snapshot.id ? (
                                                    <span className="doctor-appointment-detail__btn-spinner" />
                                                ) : null}
                                                Зберегти
                                            </button>

                                            {canDeleteSnapshot ? (
                                                <button
                                                    type="button"
                                                    className="doctor-appointment-detail__danger-btn"
                                                    onClick={() => void removeDentalSnapshot(snapshot.id)}
                                                    disabled={dentalDeletingId === snapshot.id}
                                                >
                                                    {dentalDeletingId === snapshot.id ? 'Видалення…' : 'Видалити'}
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="doctor-appointment-detail__snapshot-readonly-clean">
                                        <div>
                                            <span>Область</span>
                                            <strong>{dentalTargetLabel(snapshot)}</strong>
                                        </div>

                                        {snapshot.description ? <p>{snapshot.description}</p> : null}
                                    </div>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="page-shell doctor-appointment-detail">
            <div className="container doctor-appointment-detail__container">
                <section className="doctor-appointment-detail__card">
                    {alert ? <AlertToast message={alert.message} variant={alert.variant} onClose={() => setAlert(null)} /> : null}

                    <h1 className="doctor-appointment-detail__title">ПРИЙОМ</h1>

                    {loading ? (
                        <>
                            <div className="doctor-appointment-detail__meta doctor-appointment-detail__meta--skeleton">
                                {Array.from({ length: 3 }).map((_, index) => (
                                    <div key={`meta-skeleton-${index}`} className="doctor-appointment-detail__skeleton-card" />
                                ))}
                            </div>
                            <div className="doctor-appointment-detail__panel doctor-appointment-detail__panel--skeleton" />
                            <div className="doctor-appointment-detail__panel doctor-appointment-detail__panel--skeleton" />
                        </>
                    ) : !appointment ? (
                        <div className="doctor-appointment-detail__state">Запис не знайдено</div>
                    ) : (
                        <>
                            <div className="doctor-appointment-detail__meta">
                                <div>
                                    <span>Пацієнт</span>
                                    <strong>{fullName(appointment)}</strong>
                                </div>
                                <div>
                                    <span>Дата та час</span>
                                    <strong>{formatDateTime(appointment.appointmentDate)}</strong>
                                </div>
                                <div>
                                    <span>Кабінет</span>
                                    <strong>{appointment.cabinet?.name || appointment.cabinetName || 'Не вказано'}</strong>
                                </div>
                            </div>

                            {isCompleted ? (
                                <div className="doctor-appointment-detail__state doctor-appointment-detail__state--done">
                                    Прийом уже завершено. Повторно відкривати його для редагування не можна.
                                </div>
                            ) : null}

                            <div className="doctor-appointment-detail__panel">
                                <div className="doctor-appointment-detail__section-head">
                                    <div>
                                        <h2>Відеозапис</h2>
                                    </div>
                                </div>

                                <div className="doctor-appointment-detail__video-list">
                                    {slots.length === 0 ? (
                                        <div className="doctor-appointment-detail__state">Немає джерел запису для цього кабінету.</div>
                                    ) : (
                                        slots.map((slot) => {
                                            const expanded = Boolean(expandedSlots[slot.id]);
                                            return (
                                                <div key={slot.id} className="doctor-appointment-detail__video-item">
                                                    <div className="doctor-appointment-detail__video-item-top">
                                                        <div className="doctor-appointment-detail__video-item-meta">
                                                            <strong>{slot.name}</strong>
                                                            <span>{slot.startMode === 'AUTO_ON_VISIT_START' ? 'Автозапуск' : 'Ручний запуск'}</span>
                                                        </div>

                                                        <div className="doctor-appointment-detail__video-item-actions">
                                                            <span className={`doctor-appointment-detail__status-dot ${slot.recording ? 'is-active' : ''} ${slot.uploading ? 'is-uploading' : ''}`} />
                                                            <span className={`doctor-appointment-detail__status-label ${slot.recording ? 'is-recording' : ''} ${slot.uploading ? 'is-uploading' : ''}`}>
                                                                {slot.recordingStateLabel || (slot.uploading ? 'Обробка' : slot.recording ? 'Йде запис' : 'Готово')}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className={`doctor-appointment-detail__toggle ${expanded ? 'is-open' : ''}`}
                                                                onClick={() => toggleSlotExpanded(slot.id)}
                                                                aria-label={expanded ? 'Сховати прев’ю' : 'Показати прев’ю'}
>
                                                                <span className="doctor-appointment-detail__toggle-icon" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className={`doctor-appointment-detail__recording-state doctor-appointment-detail__recording-state--${getRecordingStateTone(slot.recordingState)}`}>
                                                        <div>
                                                            <strong>{slot.recordingStateLabel}</strong>
                                                            <span>
                                                                {slot.recordingStateAt ? formatDateTime(slot.recordingStateAt) : 'Очікування подій від Capture Agent'}
                                                            </span>
                                                        </div>

                                                        <div className="doctor-appointment-detail__recording-state-meta">
                                                            {formatBytes(slot.recordingBytes) ? <span>{formatBytes(slot.recordingBytes)}</span> : null}
                                                            {slot.recordingHash ? <span>SHA-256: {slot.recordingHash.slice(0, 12)}…</span> : null}
                                                            {slot.recordingTimeline.length ? <span>{slot.recordingTimeline.length} подій</span> : null}
                                                        </div>
                                                    </div>


                                                    <div className={`doctor-appointment-detail__preview-panel ${expanded ? 'is-open' : ''}`}>
                                                        <div className="doctor-appointment-detail__preview-inner">
                                                            <video
                                                                ref={(element) => {
                                                                    previewVideoRefs.current[slot.id] = element;
                                                                }}
                                                                className="doctor-appointment-detail__preview"
                                                                autoPlay
                                                                muted
                                                                playsInline
                                                                style={{ display: slot.previewWebRtcActive ? undefined : 'none' }}
                                                            />
                                                            {!slot.previewWebRtcActive && slot.previewImageDataUrl ? (
                                                                <img
                                                                    ref={(element) => {
                                                                        previewRefs.current[slot.id] = element;
                                                                    }}
                                                                    className="doctor-appointment-detail__preview"
                                                                    src={slot.previewImageDataUrl}
                                                                    alt={`Live preview ${slot.name}`}
                                                                />
                                                            ) : null}
                                                            {!slot.previewWebRtcActive && !slot.previewImageDataUrl ? (
                                                                <div className="doctor-appointment-detail__preview-placeholder">
                                                                    {slot.previewLoading ? 'Завантаження прев’ю…' : slot.previewError || 'Натисніть стрілку, щоб показати прев’ю.'}
                                                                </div>
                                                            ) : null}
                                                            {slot.previewCapturedAt ? (
                                                                <span className="doctor-appointment-detail__preview-time">
                                                                    {slot.previewWebRtcActive ? 'WebRTC preview' : `Кадр: ${formatDateTime(slot.previewCapturedAt)}`}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </div>

                                                    {slot.startMode === 'MANUAL' ? (
                                                        <div className="doctor-appointment-detail__button-row">
                                                            {!slot.recording ? (
                                                                <button
                                                                    type="button"
                                                                    className="doctor-appointment-detail__ghost-btn"
                                                                    onClick={() => void startRecording(slot.id)}
                                                                    disabled={slot.uploading || isCompleted || !slot.hasMedia}
                                                                >
                                                                    {slot.uploading ? <span className="doctor-appointment-detail__btn-spinner" /> : null}
                                                                    {slot.uploading ? slot.recordingStateLabel || 'Обробка...' : 'Почати запис'}
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    className="doctor-appointment-detail__danger-btn"
                                                                    onClick={() => stopRecording(slot.id)}
                                                                    disabled={slot.uploading || isCompleted}
                                                                >
                                                                    Зупинити запис
                                                                </button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="doctor-appointment-detail__auto-note">
                                                            {slot.recording ? slot.recordingStateLabel || 'Автозапис активний' : slot.hasMedia ? 'Очікуємо автозапуск' : 'Немає доступного пристрою'}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            <div className="doctor-appointment-detail__panel doctor-appointment-detail__dental-panel">
                                <div className="doctor-appointment-detail__section-head">
                                    <div>
                                        <h2>Зубна карта пацієнта</h2>

                                    </div>

                                </div>

                                <div className="doctor-appointment-detail__dental-workspace-tabs">
                                    <button
                                        type="button"
                                        className={dentalWorkspaceTab === 'formula' ? 'is-active' : ''}
                                        onClick={() => setDentalWorkspaceTab('formula')}
                                    >
                                        Формула
                                    </button>

                                    <button
                                        type="button"
                                        className={dentalWorkspaceTab === 'history' ? 'is-active' : ''}
                                        onClick={() => setDentalWorkspaceTab('history')}
                                    >
                                        Скріншоти / історія
                                    </button>
                                </div>

                                {dentalWorkspaceTab === 'formula' ? (
                                    <div className="doctor-appointment-detail__formula-workspace">
                                        <div className="doctor-appointment-detail__formula-toolbar">
                                            <div>

                                                <span>
            {dentalFormulaChangedTeeth.length
                ? `Змінено зуби під час цього прийому: ${dentalFormulaChangedTeeth.join(', ')}`
                : 'Змін у формулі під час цього прийому поки немає.'}
        </span>
                                            </div>

                                            <span className="doctor-appointment-detail__formula-autosave-note">
        Формула автоматично зберігається для пацієнта на цьому пристрої.
    </span>
                                        </div>

                                        <DentalFormulaEditor
                                            value={dentalFormula}
                                            onChange={handleDentalFormulaChange}
                                            readOnly={isCompleted}
                                            embedded
                                            changedTeeth={dentalFormulaChangedTeeth}
                                            onToothSelect={(toothNumber) =>
                                                setSelectedDentalTarget({
                                                    targetType: 'TOOTH',
                                                    label: `Зуб ${toothNumber}`,
                                                    toothNumber,
                                                })
                                            }
                                        />
                                        <details className="doctor-appointment-detail__formula-history-dropdown">
                                            <summary>Історія змін зубної формули</summary>

                                            {dentalFormulaHistory.length ? (
                                                <div className="doctor-appointment-detail__formula-history-list">
                                                    {dentalFormulaHistory.map((entry) => (
                                                        <div key={entry.id} className="doctor-appointment-detail__formula-history-row">
                                                            <div>
                                                                <strong>{formatDateTime(entry.savedAt)}</strong>
                                                                <p>
                                                                    {entry.changedTeeth.length
                                                                        ? `Змінені зуби: ${entry.changedTeeth.join(', ')}`
                                                                        : 'Без зафіксованих змінених зубів'}
                                                                </p>
                                                            </div>

                                                            <span className="doctor-appointment-detail__formula-history-count">
                        {entry.changedTeeth.length}
                    </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="doctor-appointment-detail__empty-note">
                                                    Історія змін ще порожня.
                                                </div>
                                            )}
                                        </details>
                                    </div>
                                ) : (
                                    <div className="doctor-appointment-detail__history-workspace">
                                        <div className="doctor-appointment-detail__dental-layout">
                                            <div className="doctor-appointment-detail__dental-map">
                                                <div className="doctor-appointment-detail__jaw-actions">
                                                    <button
                                                        type="button"
                                                        className={selectedDentalTarget.targetType === 'MOUTH' ? 'is-selected' : ''}
                                                        onClick={() =>
                                                            setSelectedDentalTarget({
                                                                targetType: 'MOUTH',
                                                                label: 'Уся ротова порожнина',
                                                                jaw: 'WHOLE',
                                                            })
                                                        }
                                                    >
                                                        Уся ротова порожнина
                                                        <span>{dentalChart?.mouthHistory.length || 0}</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className={selectedDentalTarget.targetType === 'JAW' && selectedDentalTarget.jaw === 'UPPER' ? 'is-selected' : ''}
                                                        onClick={() =>
                                                            setSelectedDentalTarget({
                                                                targetType: 'JAW',
                                                                label: 'Верхня щелепа',
                                                                jaw: 'UPPER',
                                                            })
                                                        }
                                                    >
                                                        Верхня щелепа
                                                        <span>{dentalChart?.upperJawHistory.length || 0}</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className={selectedDentalTarget.targetType === 'JAW' && selectedDentalTarget.jaw === 'LOWER' ? 'is-selected' : ''}
                                                        onClick={() =>
                                                            setSelectedDentalTarget({
                                                                targetType: 'JAW',
                                                                label: 'Нижня щелепа',
                                                                jaw: 'LOWER',
                                                            })
                                                        }
                                                    >
                                                        Нижня щелепа
                                                        <span>{dentalChart?.lowerJawHistory.length || 0}</span>
                                                    </button>
                                                </div>

                                                <div className="doctor-appointment-detail__tooth-grid" aria-label="Зубна карта 32 зуби">
                                                    {DENTAL_TEETH_ROWS.map((row, rowIndex) => (
                                                        <div className="doctor-appointment-detail__tooth-row" key={`row-${rowIndex}`}>
                                                            {row.map((toothNumber) => {
                                                                const tooth = dentalChart?.teeth.find((item) => item.number === toothNumber);
                                                                const isSelected = selectedDentalTarget.targetType === 'TOOTH' && selectedDentalTarget.toothNumber === toothNumber;
                                                                const formulaChanged = dentalFormulaChangedTeeth.includes(toothNumber);

                                                                return (
                                                                    <button
                                                                        type="button"
                                                                        key={toothNumber}
                                                                        className={`doctor-appointment-detail__tooth ${isSelected ? 'is-selected' : ''} ${tooth?.snapshotCount ? 'has-history' : ''} ${formulaChanged ? 'has-formula-change' : ''}`}
                                                                        onClick={() =>
                                                                            setSelectedDentalTarget({
                                                                                targetType: 'TOOTH',
                                                                                label: `Зуб ${toothNumber}`,
                                                                                toothNumber,
                                                                            })
                                                                        }
                                                                    >
                                                                        <span>{toothNumber}</span>
                                                                        {tooth?.snapshotCount ? <em>{tooth.snapshotCount}</em> : null}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="doctor-appointment-detail__snapshot-editor">
                                            <div className="doctor-appointment-detail__dental-history-head">
                                                <h3>Усі записи по зубній карті</h3>
                                                <span>{dentalChart?.snapshots.length || 0}</span>
                                            </div>

                                            {!isCompleted ? (
                                                <div className="doctor-appointment-detail__snapshot-create">
                                                    <label className="doctor-appointment-detail__field">
                                                        <span>Область</span>
                                                        <select
                                                            value={newDentalDraft.targetValue}
                                                            onChange={(event) =>
                                                                setNewDentalDraft((prev) => ({
                                                                    ...prev,
                                                                    targetValue: event.target.value,
                                                                }))
                                                            }
                                                        >
                                                            {dentalTargetOptions.map((option) => (
                                                                <option key={option.value} value={option.value}>
                                                                    {option.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>

                                                    <label className="doctor-appointment-detail__field">
                                                        <span>Підпис</span>
                                                        <input
                                                            value={newDentalDraft.title}
                                                            onChange={(event) =>
                                                                setNewDentalDraft((prev) => ({
                                                                    ...prev,
                                                                    title: event.target.value,
                                                                }))
                                                            }
                                                            placeholder="Наприклад: глибокий карієс"
                                                        />
                                                    </label>

                                                    <label className="doctor-appointment-detail__field doctor-appointment-detail__field--wide">
                                                        <textarea
                                                            value={newDentalDraft.description}
                                                            onChange={(event) =>
                                                                setNewDentalDraft((prev) => ({
                                                                    ...prev,
                                                                    description: event.target.value,
                                                                }))
                                                            }
                                                            placeholder="Що видно на знімку, контекст, рішення лікаря"
                                                        />
                                                    </label>

                                                    <div className="doctor-appointment-detail__upload-box doctor-appointment-detail__field--wide">
                                                        <span>Фото / знімок</span>

                                                        <input
                                                            ref={newDentalImageInputRef}
                                                            type="file"
                                                            accept="image/*"
                                                            onChange={handleNewDentalImageChange}
                                                            hidden
                                                        />

                                                        <div className="doctor-appointment-detail__upload-actions">
                                                            <button
                                                                type="button"
                                                                className="doctor-appointment-detail__ghost-btn"
                                                                onClick={() => newDentalImageInputRef.current?.click()}
                                                            >
                                                                {newDentalImageFile ? 'Замінити файл' : 'Завантажити фото'}
                                                            </button>

                                                            <button
                                                                type="button"
                                                                className="doctor-appointment-detail__ghost-btn"
                                                                onClick={() => void captureWebsiteScreenshot()}
                                                            >
                                                                Знімок екрана
                                                            </button>

                                                            {newDentalImageFile ? (
                                                                <button
                                                                    type="button"
                                                                    className="doctor-appointment-detail__danger-btn"
                                                                    onClick={clearNewDentalImage}
                                                                >
                                                                    Прибрати файл
                                                                </button>
                                                            ) : null}
                                                        </div>

                                                        <small className="doctor-appointment-detail__upload-note">
                                                            {newDentalImageFile ? `Вибрано: ${newDentalImageFile.name}` : 'Фото не обов’язкове.'}
                                                        </small>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        className="doctor-appointment-detail__ghost-btn"
                                                        onClick={() => void createDentalNote()}
                                                        disabled={dentalSavingId === 'new'}
                                                    >
                                                        {dentalSavingId === 'new' ? <span className="doctor-appointment-detail__btn-spinner" /> : null}
                                                        Зберегти запис
                                                    </button>
                                                </div>
                                            ) : null}

                                            <section className="doctor-appointment-detail__snapshot-section">
                                                <div className="doctor-appointment-detail__snapshot-section-head">
                                                    <h3>Поточний візит ({currentVisitSnapshots.length})</h3>
                                                </div>

                                                {renderDentalSnapshotCards(
                                                    currentVisitSnapshots,
                                                    'У поточному візиті записів ще немає.',
                                                    true,
                                                )}
                                            </section>

                                            <section className="doctor-appointment-detail__snapshot-section">
                                                <div className="doctor-appointment-detail__snapshot-section-head">
                                                    <h3>Попередні візити ({previousVisitSnapshots.length})</h3>
                                                </div>

                                                {renderDentalSnapshotCards(
                                                    previousVisitSnapshots,
                                                    'У попередніх візитах записів ще немає.',
                                                    false,
                                                )}
                                            </section>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="doctor-appointment-detail__panel">
                                <div className="doctor-appointment-detail__section-head">
                                    <div>
                                        <h2>Консультативний висновок</h2>
                                        <p>Лікар заповнює висновок, план лікування, рекомендації та перелік ліків.</p>
                                    </div>
                                </div>

                                <div className="doctor-appointment-detail__form-grid">
                                    <label className="doctor-appointment-detail__field doctor-appointment-detail__field--wide">
                                        <span>Висновок</span>
                                        <textarea
                                            value={consultationConclusion}
                                            onChange={(event) => setConsultationConclusion(event.target.value)}
                                            placeholder="Опиши суть консультативного висновку"
                                            disabled={isCompleted}
                                        />
                                    </label>

                                    <label className="doctor-appointment-detail__field doctor-appointment-detail__field--wide">
                                        <span>План лікування</span>
                                        <textarea
                                            value={treatmentPlanText}
                                            onChange={(event) => setTreatmentPlanText(event.target.value)}
                                            placeholder={`1. ...\n2. ...`}
                                            disabled={isCompleted}
                                        />
                                    </label>

                                    <label className="doctor-appointment-detail__field doctor-appointment-detail__field--wide">
                                        <span>Рекомендації</span>
                                        <textarea
                                            value={recommendationText}
                                            onChange={(event) => setRecommendationText(event.target.value)}
                                            placeholder={`1. ...\n2. ...`}
                                            disabled={isCompleted}
                                        />
                                    </label>

                                    <label className="doctor-appointment-detail__field doctor-appointment-detail__field--wide">
                                        <span>Ліки / препарати</span>
                                        <textarea
                                            value={medicationText}
                                            onChange={(event) => setMedicationText(event.target.value)}
                                            placeholder={`1. ...\n2. ...`}
                                            disabled={isCompleted}
                                        />
                                    </label>

                                </div>
                            </div>

                            <div className="doctor-appointment-detail__panel">
                                <div className="doctor-appointment-detail__section-head">
                                    <div>
                                        <h2>Записати на наступний візит</h2>
                                        <p>Можна записати до себе або до іншого лікаря без онлайн-оплати.</p>
                                    </div>
                                    {createdFollowUpDate ? (
                                        <div className="doctor-appointment-detail__next-visit-badge">
                                            Наступний візит: {formatDateTime(createdFollowUpDate)}
                                        </div>
                                    ) : null}
                                </div>

                                {resourcesLoading ? (
                                    <div className="doctor-appointment-detail__follow-up-skeleton">
                                        <div className="doctor-appointment-detail__skeleton-line" />
                                        <div className="doctor-appointment-detail__skeleton-line" />
                                        <div className="doctor-appointment-detail__skeleton-line" />
                                    </div>
                                ) : (
                                    <>
                                        <div className="doctor-appointment-detail__booking-grid">
                                            <label className="doctor-appointment-detail__field">
                                                <span>Лікар</span>
                                                <select
                                                    value={followUpDoctorId}
                                                    onChange={(event) => setFollowUpDoctorId(event.target.value)}
                                                    disabled={isCompleted}
                                                >
                                                    <option value="">Оберіть лікаря</option>
                                                    {doctors.map((doctor) => (
                                                        <option key={doctor.userId || doctor.id} value={doctor.userId || doctor.id}>
                                                            {doctorLabel(doctor)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>

                                            <label className="doctor-appointment-detail__field">
                                                <span>Послуга</span>
                                                <select
                                                    value={followUpServiceId}
                                                    onChange={(event) => setFollowUpServiceId(event.target.value)}
                                                    disabled={isCompleted}
                                                >
                                                    <option value="">Оберіть послугу</option>
                                                    {services.map((service) => (
                                                        <option key={service.id} value={service.id}>
                                                            {serviceLabel(service)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>

                                        {followUpDoctorId && followUpServiceId ? (
                                            <div className="doctor-appointment-detail__calendar-card">
                                                {!selectedDate ? (
                                                    <>
                                                        <div className="doctor-appointment-detail__calendar-top">
                                                            <h3>Календар</h3>
                                                            <div className="doctor-appointment-detail__month-nav">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setMonth((prev) => shiftMonthKey(prev, -1))}
                                                                    disabled={isBeforeCurrentMonth(month) || isCompleted}
                                                                >
                                                                    ‹
                                                                </button>
                                                                <span>{getMonthLabel(month)}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setMonth((prev) => shiftMonthKey(prev, 1))}
                                                                    disabled={isCompleted}
                                                                >
                                                                    ›
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="doctor-appointment-detail__weekday-row">
                                                            {weekdayLabels.map((label) => (
                                                                <div key={label}>{label}</div>
                                                            ))}
                                                        </div>

                                                        {loadingMonth ? (
                                                            <div className="doctor-appointment-detail__calendar-skeleton-grid">
                                                                {Array.from({ length: 35 }).map((_, index) => (
                                                                    <div key={`day-skeleton-${index}`} className="doctor-appointment-detail__calendar-skeleton-cell" />
                                                                ))}
                                                            </div>
                                                        ) : calendarCells.length ? (
                                                            <div className="doctor-appointment-detail__month-grid">
                                                                {calendarCells.map((cell) =>
                                                                    cell.kind === 'empty' ? (
                                                                        <div key={cell.key} className="doctor-appointment-detail__day doctor-appointment-detail__day--empty" />
                                                                    ) : (
                                                                        <button
                                                                            key={cell.key}
                                                                            type="button"
                                                                            className={[
                                                                                'doctor-appointment-detail__day',
                                                                                cell.day.date === selectedDate ? 'is-selected' : '',
                                                                                !cell.day.isWorking ? 'is-off' : cell.day.freeSlots > 0 ? 'is-free' : 'is-busy',
                                                                            ].join(' ')}
                                                                            onClick={() => {
                                                                                if (!cell.day.isWorking || cell.day.freeSlots <= 0) return;
                                                                                setSelectedDate(cell.day.date);
                                                                            }}
                                                                            disabled={!cell.day.isWorking || cell.day.freeSlots <= 0 || isCompleted}
                                                                        >
                                                                            <span>{cell.day.date.slice(-2)}</span>
                                                                            <small>{cell.day.freeSlots}/{cell.day.totalSlots}</small>
                                                                        </button>
                                                                    ),
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="doctor-appointment-detail__state">На цей період вільних дат немає.</div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <div className="doctor-appointment-detail__slots-wrap">
                                                        <div className="doctor-appointment-detail__slots-head">
                                                            <strong>{formatDateOnly(selectedDate)}</strong>
                                                            <button
                                                                type="button"
                                                                className="doctor-appointment-detail__ghost-btn"
                                                                onClick={() => {
                                                                    setSelectedDate('');
                                                                    setSelectedTime('');
                                                                    setSelectedCabinetId(null);
                                                                }}
                                                                disabled={isCompleted}
                                                            >
                                                                Назад до календаря
                                                            </button>
                                                        </div>

                                                        {loadingDay ? (
                                                            <div className="doctor-appointment-detail__slots-skeleton-grid">
                                                                {Array.from({ length: 16 }).map((_, index) => (
                                                                    <div key={`slot-skeleton-${index}`} className="doctor-appointment-detail__calendar-skeleton-cell doctor-appointment-detail__calendar-skeleton-cell--slot" />
                                                                ))}
                                                            </div>
                                                        ) : !dayData?.isWorking ? (
                                                            <div className="doctor-appointment-detail__state">У цей день лікар не працює або день заблоковано.</div>
                                                        ) : freeSlots.length ? (
                                                            <div className="doctor-appointment-detail__slots-grid">
                                                                {freeSlots.map((slot) => (
                                                                    <button
                                                                        key={slot.time}
                                                                        type="button"
                                                                        className={`doctor-appointment-detail__slot ${selectedTime === slot.time ? 'is-selected' : ''}`}
                                                                        onClick={() => {
                                                                            setSelectedTime(slot.time);
                                                                            setSelectedCabinetId(slot.cabinetId || null);
                                                                        }}
                                                                        disabled={isCompleted}
                                                                    >
                                                                        <span>{slot.time}</span>
                                                                        {slot.cabinetName ? <small>{parseDbI18nValue(slot.cabinetName)}</small> : null}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="doctor-appointment-detail__state">На цю дату вільного часу немає.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : null}

                                        <div className="doctor-appointment-detail__button-row doctor-appointment-detail__button-row--right">
                                            <button
                                                type="button"
                                                className="doctor-appointment-detail__primary-btn"
                                                onClick={() => void submitFollowUpBooking()}
                                                disabled={followUpSubmitting || isCompleted || !followUpDoctorId || !followUpServiceId || !selectedDate || !selectedTime}
                                            >
                                                {followUpSubmitting ? <span className="doctor-appointment-detail__btn-spinner" /> : null}
                                                {followUpSubmitting ? 'Створення...' : 'Записати на візит'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="doctor-appointment-detail__finish-row">
                                <button
                                    type="button"
                                    className="doctor-appointment-detail__finish-btn"
                                    onClick={finishAppointment}
                                    disabled={isCompleted || hasAnyUploading || finishing}
                                >
                                    {finishing ? <span className="doctor-appointment-detail__btn-spinner" /> : null}
                                    {finishing ? 'Завершення...' : 'Завершити прийом'}
                                </button>
                            </div>

                            {isCompleted ? (
                                <div className="doctor-appointment-detail__button-row doctor-appointment-detail__button-row--center">
                                    <button type="button" className="doctor-appointment-detail__ghost-btn" onClick={() => navigate('/doctor/appointments-week')}>
                                        Повернутися до розкладу
                                    </button>
                                </div>
                            ) : null}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
