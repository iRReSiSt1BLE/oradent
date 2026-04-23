import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    completeDoctorAppointment,
    startAppointmentAgentPreview,
    getAppointmentAgentPreviewFrame,
    startAppointmentAgentRecording,
    stopAppointmentAgentPreview,
    stopAppointmentAgentRecording,
    createDoctorFollowUpAppointment,
    getDoctorAppointmentById,
    getManualAvailabilityDay,
    getManualAvailabilityMonth,
    updateAppointmentVisitFlowStatus,
    type AppointmentCabinetDevice,
    type AppointmentItem,
    type ManualAvailabilityDayResponse,
    type ManualAvailabilityMonthDay,
} from '../../shared/api/appointmentApi';
import { getPublicDoctors, type PublicDoctorItem } from '../../shared/api/doctorApi';
import { getActivePublicServices, type ClinicService } from '../../shared/api/servicesApi';
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
    previewImageDataUrl: string | null;
    previewCapturedAt: string | null;
    previewError: string | null;
};

type AlertState = {
    variant: 'success' | 'error' | 'info';
    message: string;
} | null;

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

    const previewRefs = useRef<Record<string, HTMLVideoElement | HTMLImageElement | null>>({});
    const streamsRef = useRef<Record<string, MediaStream | null>>({});
    const recordersRef = useRef<Record<string, MediaRecorder | null>>({});
    const previewPollersRef = useRef<Record<string, number | null>>({});
    const previewInFlightRef = useRef<Record<string, boolean>>({});
    const autoStartedRef = useRef<Set<string>>(new Set());
    const finishAfterUploadsRef = useRef(false);

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

    function clearPreviewPoller(slotId: string) {
        const timerId = previewPollersRef.current[slotId];
        if (typeof timerId === 'number') {
            window.clearInterval(timerId);
        }
        delete previewPollersRef.current[slotId];
        delete previewInFlightRef.current[slotId];
    }

    async function startSlotPreview(slotId: string) {
        if (!appointment?.id || !token) return;

        const slot = slots.find((item) => item.id === slotId);
        if (!slot?.videoDeviceId) {
            updateSlot(slotId, { previewActive: false, previewLoading: false, previewError: 'Для цього джерела не налаштовано камеру.' });
            return;
        }

        clearPreviewPoller(slotId);
        updateSlot(slotId, {
            showPreview: true,
            previewActive: true,
            previewLoading: true,
            previewError: null,
        });

        try {
            await startAppointmentAgentPreview(token, appointment.id, { cabinetDeviceId: slotId });
        } catch (error) {
            updateSlot(slotId, {
                previewActive: false,
                previewLoading: false,
                previewError: error instanceof Error ? error.message : 'Не вдалося запустити live-preview.',
            });
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
                    updateSlot(slotId, {
                        previewLoading: false,
                        previewError: null,
                        previewImageDataUrl: frame.preview.imageDataUrl,
                        previewCapturedAt: frame.preview.capturedAt,
                    });
                }
            } catch (error) {
                updateSlot(slotId, {
                    previewLoading: false,
                    previewError: error instanceof Error ? error.message : 'Не вдалося отримати кадр preview.',
                });
            } finally {
                previewInFlightRef.current[slotId] = false;
            }
        };

        await poll();
        previewPollersRef.current[slotId] = window.setInterval(() => {
            void poll();
        }, 250);
    }

    async function stopSlotPreview(slotId: string, options?: { clearFrame?: boolean }) {
        clearPreviewPoller(slotId);

        if (appointment?.id && token) {
            await stopAppointmentAgentPreview(token, appointment.id, { cabinetDeviceId: slotId }).catch(() => null);
        }

        updateSlot(slotId, {
            previewActive: false,
            previewLoading: false,
            previewError: null,
            showPreview: false,
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

        if (slot.recording && slot.videoDeviceId) {
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
                setAlert({ variant: 'error', message: 'Для цього джерела не налаштовано пару камера + мікрофон на capture agent.' });
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
            });
            if (slot.videoDeviceId) {
                void startSlotPreview(slotId);
            }
            if (!options?.auto) {
                setAlert({ variant: 'success', message: 'Команду старту запису надіслано до capture agent' });
            }
        } catch (err) {
            updateSlot(slotId, { recording: false, uploading: false, showPreview: false, previewActive: false, previewLoading: false });
            if (!options?.auto) {
                setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося почати запис через capture agent' });
            }
        }
    }

    async function stopRecording(slotId: string) {
        if (!appointment?.id || !token) return;
        const slot = slots.find((item) => item.id === slotId);
        if (!slot || slot.uploading || !slot.recording) return;

        updateSlot(slotId, { uploading: true });
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
            setAlert({ variant: 'error', message: err instanceof Error ? err.message : 'Не вдалося зупинити запис через capture agent' });
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
                                        <p>{appointment.cabinet?.devices?.length ? 'Запис цього прийому виконує локальний capture agent у кабінеті.' : 'Для цього кабінету джерела запису не налаштовано.'}</p>
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
                                                                {slot.uploading ? 'Завантаження' : slot.recording ? 'Йде запис' : 'Готово'}
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

                                                    <div className={`doctor-appointment-detail__preview-panel ${expanded ? 'is-open' : ''}`}>
                                                        <div className="doctor-appointment-detail__preview-inner">
                                                            {slot.showPreview ? (
                                                                <video
                                                                    ref={(element) => {
                                                                        previewRefs.current[slot.id] = element;
                                                                    }}
                                                                    className="doctor-appointment-detail__preview"
                                                                    playsInline
                                                                    autoPlay
                                                                    muted
                                                                />
                                                            ) : (
                                                                <div className="doctor-appointment-detail__preview-placeholder">
                                                                    Запис веде локальний capture agent. Live-preview на цій сторінці не показується.
                                                                </div>
                                                            )}
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
                                                                    {slot.uploading ? 'Завантаження...' : 'Почати запис'}
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
                                                            {slot.recording ? 'Автозапис активний' : slot.hasMedia ? 'Очікуємо автозапуск' : 'Немає доступного пристрою'}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
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

                                    <label className="doctor-appointment-detail__field doctor-appointment-detail__field--wide">
                                        <span>Email для надсилання висновку</span>
                                        <input
                                            type="email"
                                            value={consultationEmail}
                                            onChange={(event) => setConsultationEmail(event.target.value)}
                                            placeholder="patient@example.com"
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
