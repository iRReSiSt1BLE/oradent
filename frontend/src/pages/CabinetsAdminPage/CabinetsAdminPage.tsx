import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    createCabinet,
    deleteCabinet,
    getCabinetDoctorsOptions,
    getCabinetServicesOptions,
    getCabinets,
    toggleCabinetActive,
    updateCabinet,
    type CabinetDeviceStartMode,
    type CabinetDoctorOption,
    type CabinetItem,
    type CabinetServiceOption,
} from '../../shared/api/cabinetApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import { useI18n } from '../../shared/i18n/I18nProvider';
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

function emptyDevice(): CabinetDeviceForm {
    return {
        key: uid(),
        name: '',
        cameraDeviceId: '',
        cameraLabel: '',
        microphoneDeviceId: '',
        microphoneLabel: '',
        startMode: 'MANUAL',
    };
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
    const [form, setForm] = useState<CabinetFormState>(createEmptyForm());
    const [saving, setSaving] = useState(false);
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

    const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const microphoneStreamRef = useRef<MediaStream | null>(null);
    const microphoneAudioContextRef = useRef<AudioContext | null>(null);
    const microphoneAnimationRef = useRef<number | null>(null);

    const selectedCabinet = useMemo(
        () => cabinets.find((item) => item.id === selectedCabinetId) || null,
        [cabinets, selectedCabinetId],
    );

    const filteredCabinets = useMemo(() => {
        const query = normalizeComparableText(search);
        return cabinets.filter((cabinet) => {
            if (onlyActive && !cabinet.isActive) return false;
            if (!query) return true;
            const text = normalizeComparableText([
                parseDbI18nValue(cabinet.name, language),
                parseDbI18nValue(cabinet.description, language) || '',
                ...cabinet.services.map((item) => parseDbI18nValue(item.name, language)),
                ...cabinet.doctorAssignments.map((item) => doctorFullName(item.doctor)),
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

    function openCreateModal() {
        stopCameraTest();
        stopMicrophoneTest();
        setModalMode('create');
        setEditingCabinetId(null);
        setForm(createEmptyForm());
        setNameEditorLanguage('ua');
        setDescriptionEditorLanguage('ua');
        setDeviceEditorLanguages({});
        setModalOpen(true);
        void refreshBrowserDevices(!deviceAccessGranted);
    }

    function openEditModal(cabinet: CabinetItem) {
        stopCameraTest();
        stopMicrophoneTest();
        setModalMode('edit');
        setEditingCabinetId(cabinet.id);
        const nextForm = mapCabinetToForm(cabinet);
        setForm(nextForm);
        setNameEditorLanguage('ua');
        setDescriptionEditorLanguage('ua');
        setDeviceEditorLanguages(Object.fromEntries(nextForm.devices.map((item) => [item.key, 'ua'])));
        setModalOpen(true);
        void refreshBrowserDevices(!deviceAccessGranted);
    }

    function closeModal() {
        stopCameraTest();
        stopMicrophoneTest();
        setModalOpen(false);
        setEditingCabinetId(null);
        setForm(createEmptyForm());
        setNameEditorLanguage('ua');
        setDescriptionEditorLanguage('ua');
        setDeviceEditorLanguages({});
    }

    function toggleCabinetSelection(cabinetId: string) {
        setSelectedCabinetId((prev) => (prev === cabinetId ? null : cabinetId));
    }

    function updateDevice(key: string, patch: Partial<CabinetDeviceForm>) {
        setForm((prev) => ({
            ...prev,
            devices: prev.devices.map((device) => (device.key === key ? { ...device, ...patch } : device)),
        }));
    }

    function addDevice() {
        setForm((prev) => ({ ...prev, devices: [...prev.devices, emptyDevice()] }));
    }

    function removeDevice(key: string) {
        stopCameraTest(key);
        stopMicrophoneTest(key);
        setForm((prev) => ({
            ...prev,
            devices: prev.devices.filter((device) => device.key !== key),
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

    function updateDeviceNameTranslation(key: string, languageKey: AppLanguage, value: string) {
        setForm((prev) => ({
            ...prev,
            devices: prev.devices.map((device) =>
                device.key === key
                    ? {
                          ...device,
                          name: updateLocalizedRawValue(device.name, languageKey, value, 'cabinetDeviceNameI18n'),
                      }
                    : device,
            ),
        }));
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

    async function startCameraTest(deviceKey: string) {
        const device = form.devices.find((item) => item.key === deviceKey);
        if (!device?.cameraDeviceId || !navigator.mediaDevices?.getUserMedia) return;

        try {
            stopCameraTest();
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: device.cameraDeviceId } },
                audio: false,
            });
            cameraStreamRef.current = stream;
            setCameraTestingKey(deviceKey);
            requestAnimationFrame(() => {
                if (cameraVideoRef.current) {
                    cameraVideoRef.current.srcObject = stream;
                    void cameraVideoRef.current.play().catch(() => undefined);
                }
            });
        } catch (err: any) {
            setAlert({ variant: 'error', message: err?.message || t('cabinetsAdmin.cameraTestError') });
        }
    }

    function stopCameraTest(targetKey?: string) {
        if (targetKey && cameraTestingKey !== targetKey) return;
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
        if (cameraVideoRef.current) {
            cameraVideoRef.current.pause();
            cameraVideoRef.current.srcObject = null;
        }
        setCameraTestingKey(null);
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

    try {
        setSaving(true);

        const devices = form.devices
            .map((device) => ({
                name: device.name,
                cameraDeviceId: device.cameraDeviceId || undefined,
                cameraLabel:
                    videoInputs.find((item) => item.deviceId === device.cameraDeviceId)?.label ||
                    device.cameraLabel ||
                    undefined,
                microphoneDeviceId: device.microphoneDeviceId || undefined,
                microphoneLabel:
                    audioInputs.find((item) => item.deviceId === device.microphoneDeviceId)?.label ||
                    device.microphoneLabel ||
                    undefined,
                startMode: device.startMode,
            }))
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
            const response = await createCabinet(token, payload);
            const next = [response.cabinet, ...cabinets.filter((item) => item.id !== response.cabinet.id)];
            setCabinets(next);
            setSelectedCabinetId(response.cabinet.id);
            setAlert({ variant: 'success', message: t('cabinetsAdmin.created') });
        } else if (editingCabinetId) {
            const response = await updateCabinet(token, editingCabinetId, payload);
            setCabinets((prev) => prev.map((item) => (item.id === editingCabinetId ? response.cabinet : item)));
            setSelectedCabinetId(response.cabinet.id);
            setAlert({ variant: 'success', message: t('cabinetsAdmin.updated') });
        }
        closeModal();
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
                            <button type="button" className="cabinets-admin-page__primary-btn" onClick={openCreateModal}>
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
                                                <div className="cabinets-admin-page__row-subtitle">{parseDbI18nValue(cabinet.description, language) || getPrimaryLocalizedValue(cabinet.description) || cabinet.description || t('cabinetsAdmin.noDescription')}</div>
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
                <div className="cabinets-admin-page__modal-backdrop" onClick={closeModal}>
                    <div className="cabinets-admin-page__modal" onClick={(event) => event.stopPropagation()}>
                        <div className="cabinets-admin-page__modal-header">
                            <div>
                                <h2>{modalMode === 'create' ? t('cabinetsAdmin.createCabinet') : t('cabinetsAdmin.editCabinet')}</h2>
                                <p>{t('cabinetsAdmin.modalHint')}</p>
                            </div>
                            <button type="button" className="cabinets-admin-page__icon-btn cabinets-admin-page__icon-btn--close" onClick={closeModal} aria-label={t('cabinetsAdmin.close')}>
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

                            <div className="cabinets-admin-page__devices-section">
                                <div className="cabinets-admin-page__devices-head">
                                    <div>
                                        <h3>{t('cabinetsAdmin.deviceConfig')}</h3>
                                        <p>{t('cabinetsAdmin.devicesHint')}</p>
                                    </div>
                                    <div className="cabinets-admin-page__devices-head-actions">
                                        <button type="button" className="cabinets-admin-page__secondary-btn cabinets-admin-page__secondary-btn--equal" onClick={() => void refreshBrowserDevices(true)} disabled={refreshingDevices}>
                                            {refreshingDevices ? (
                                                <span className="cabinets-admin-page__button-loading">
                                                    <span className="cabinets-admin-page__button-spinner" />
                                                    {t('cabinetsAdmin.refreshingDevices')}
                                                </span>
                                            ) : t('cabinetsAdmin.refreshOsDevices')}
                                        </button>
                                        <button type="button" className="cabinets-admin-page__secondary-btn cabinets-admin-page__secondary-btn--equal" onClick={addDevice}>
                                            {t('cabinetsAdmin.addDevice')}
                                        </button>
                                    </div>
                                </div>

                                <div className="cabinets-admin-page__devices-note">{deviceAccessGranted ? t('cabinetsAdmin.osDevicesReady') : t('cabinetsAdmin.osDevicesPermissionHint')}</div>

                                {form.devices.length ? (
                                    <div className="cabinets-admin-page__device-list">
                                        {form.devices.map((device, index) => {
                                            const isCameraTesting = cameraTestingKey === device.key;
                                            const isMicrophoneTesting = microphoneTestingKey === device.key;
                                            return (
                                                <div key={device.key} className="cabinets-admin-page__device-card">
                                                    <div className="cabinets-admin-page__device-head">
                                                        <div>
                                                            <h4>{parseDbI18nValue(device.name, language) || getPrimaryLocalizedValue(device.name) || `${t('cabinetsAdmin.sourceTitle')} ${index + 1}`}</h4>
                                                            <p>{device.startMode === 'AUTO_ON_VISIT_START' ? t('cabinetsAdmin.startMode.AUTO_ON_VISIT_START') : t('cabinetsAdmin.startMode.MANUAL')}</p>
                                                        </div>
                                                        <button type="button" className="cabinets-admin-page__ghost-btn" onClick={() => removeDevice(device.key)}>
                                                            {t('cabinetsAdmin.removeDevice')}
                                                        </button>
                                                    </div>

                                                    <div className="cabinets-admin-page__device-grid">
                                                        <label className="cabinets-admin-page__field cabinets-admin-page__field--full">
                                                            <span>{t('cabinetsAdmin.deviceName')}</span>
                                                            <div className="cabinets-admin-page__translation-tools cabinets-admin-page__translation-tools--compact">
                                                                <div className="cabinets-admin-page__translation-tabs">
                                                                    {translationLanguages.map((item) => (
                                                                        <button
                                                                            key={`${device.key}-tab-${item.key}`}
                                                                            type="button"
                                                                            className={`cabinets-admin-page__translation-tab ${(deviceEditorLanguages[device.key] || 'ua') === item.key ? 'is-active' : ''}`}
                                                                            onClick={() => setDeviceEditorLanguages((prev) => ({ ...prev, [device.key]: item.key }))}
                                                                        >
                                                                            {item.label}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="cabinets-admin-page__translation-btn"
                                                                    onClick={() => void handleTranslateField(`device:${device.key}`, device.name, deviceEditorLanguages[device.key] || 'ua', 'cabinetDeviceNameI18n')}
                                                                    disabled={translatingTarget === `device:${device.key}`}
                                                                >
                                                                    {translatingTarget === `device:${device.key}` ? t('cabinetsAdmin.translating') : t('cabinetsAdmin.autoTranslate')}
                                                                </button>
                                                            </div>
                                                            <input
                                                                type="text"
                                                                value={parseLocalizedEditorValue(device.name)[deviceEditorLanguages[device.key] || 'ua']}
                                                                onChange={(event) => updateDeviceNameTranslation(device.key, deviceEditorLanguages[device.key] || 'ua', event.target.value)}
                                                                placeholder={t('cabinetsAdmin.deviceNamePlaceholder')}
                                                            />
                                                        </label>
                                                        <label className="cabinets-admin-page__field">
                                                            <span>{t('cabinetsAdmin.startModeLabel')}</span>
                                                            <select value={device.startMode} onChange={(event) => updateDevice(device.key, { startMode: event.target.value as CabinetDeviceStartMode })}>
                                                                <option value="AUTO_ON_VISIT_START">{t('cabinetsAdmin.startMode.AUTO_ON_VISIT_START')}</option>
                                                                <option value="MANUAL">{t('cabinetsAdmin.startMode.MANUAL')}</option>
                                                            </select>
                                                        </label>
                                                        <label className="cabinets-admin-page__field">
                                                            <span>{t('cabinetsAdmin.cameraSourceLabel')}</span>
                                                            <select value={device.cameraDeviceId} onChange={(event) => {
                                                                const selected = videoInputs.find((item) => item.deviceId === event.target.value);
                                                                updateDevice(device.key, { cameraDeviceId: event.target.value, cameraLabel: selected?.label || '' });
                                                            }}>
                                                                <option value="">{t('cabinetsAdmin.selectCameraSource')}</option>
                                                                {videoInputs.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>)}
                                                            </select>
                                                        </label>
                                                        <label className="cabinets-admin-page__field">
                                                            <span>{t('cabinetsAdmin.microphoneSourceLabel')}</span>
                                                            <select value={device.microphoneDeviceId} onChange={(event) => {
                                                                const selected = audioInputs.find((item) => item.deviceId === event.target.value);
                                                                updateDevice(device.key, { microphoneDeviceId: event.target.value, microphoneLabel: selected?.label || '' });
                                                            }}>
                                                                <option value="">{t('cabinetsAdmin.withoutMicrophone')}</option>
                                                                {audioInputs.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>)}
                                                            </select>
                                                        </label>
                                                    </div>

                                                    <div className="cabinets-admin-page__device-actions">
                                                        <button type="button" className="cabinets-admin-page__secondary-btn" onClick={() => (isCameraTesting ? stopCameraTest(device.key) : void startCameraTest(device.key))} disabled={!device.cameraDeviceId}>
                                                            {isCameraTesting ? t('cabinetsAdmin.stopCameraTest') : t('cabinetsAdmin.testCamera')}
                                                        </button>
                                                        <button type="button" className="cabinets-admin-page__secondary-btn" onClick={() => (isMicrophoneTesting ? stopMicrophoneTest(device.key) : void startMicrophoneTest(device.key))} disabled={!device.microphoneDeviceId}>
                                                            {isMicrophoneTesting ? t('cabinetsAdmin.stopMicrophoneTest') : t('cabinetsAdmin.testMicrophone')}
                                                        </button>
                                                    </div>

                                                    {isCameraTesting ? (
                                                        <div className="cabinets-admin-page__camera-preview">
                                                            <video ref={cameraVideoRef} autoPlay playsInline muted />
                                                        </div>
                                                    ) : null}

                                                    {isMicrophoneTesting ? (
                                                        <div className="cabinets-admin-page__mic-monitor">
                                                            <div className="cabinets-admin-page__mic-bars" aria-hidden="true">
                                                                {microphoneBars.map((active, barIndex) => (
                                                                    <span key={`${device.key}-bar-${barIndex}`} className={active ? 'is-active' : ''} />
                                                                ))}
                                                            </div>
                                                            <div className="cabinets-admin-page__mic-text">{device.microphoneLabel || t('cabinetsAdmin.withoutMicrophone')}</div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="cabinets-admin-page__devices-empty">{t('cabinetsAdmin.devicesOptionalHint')}</div>
                                )}
                            </div>

                            <div className="cabinets-admin-page__form-actions">
                                <button type="button" className="cabinets-admin-page__secondary-btn" onClick={closeModal}>{t('cabinetsAdmin.cancel')}</button>
                                <button type="submit" className="cabinets-admin-page__primary-btn" disabled={saving}>{saving ? (<span className="cabinets-admin-page__button-loading"><span className="cabinets-admin-page__button-spinner" />{t('cabinetsAdmin.saving')}</span>) : t('cabinetsAdmin.save')}</button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
