import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import {
    buildDoctorAvatarUrl,
    createDoctorSpecialty,
    getDoctorById,
    getDoctorSpecialties,
    removeDoctorAvatar,
    requestDoctorEmailVerification,
    updateDoctor,
    uploadDoctorAvatar,
    type DoctorItem,
    type DoctorSpecialtyItem,
} from '../../shared/api/doctorApi';
import { getPhoneVerificationStatus, startPhoneVerification } from '../../shared/api/phoneVerificationApi';
import { getToken, getUserRole } from '../../shared/utils/authStorage';
import TelegramQrCard from '../../shared/ui/TelegramQrCard/TelegramQrCard';
import { useI18n } from '../../shared/i18n/I18nProvider';
import {
    parseDoctorInfoLocalized,
    pickDoctorInfoByLanguage,
    serializeDoctorInfoLocalized,
} from '../../shared/i18n/doctorInfo';
import './DoctorDetailPage.scss';
import {pickDoctorSpecialtyByLanguage} from "../../shared/i18n/doctorSpecialty.ts";

const OUTPUT_SIZE = 640;
const MOVE_STEP = 18;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const EMAIL_COOLDOWN_MS = 3 * 60 * 1000;

function detectPreferredSize(): 'sm' | 'md' | 'lg' {
    const dpr = window.devicePixelRatio || 1;
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    const effectiveType = connection?.effectiveType || '';
    if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'sm';
    if (effectiveType === '3g') return 'md';
    if (dpr >= 2) return 'lg';
    return 'md';
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
    return value.trim();
}

function formatCooldown(ms: number) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function DoctorDetailPage() {
    const { doctorId } = useParams();
    const token = getToken();
    const role = getUserRole();
    const isAllowed = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const { language } = useI18n();

    const [doctor, setDoctor] = useState<DoctorItem | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [preferredSize, setPreferredSize] = useState<'sm' | 'md' | 'lg'>('md');

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorImageUrl, setEditorImageUrl] = useState('');
    const [editorImage, setEditorImage] = useState<HTMLImageElement | null>(null);
    const [editorScale, setEditorScale] = useState(1);
    const [editorX, setEditorX] = useState(0);
    const [editorY, setEditorY] = useState(0);
    const [frameSize, setFrameSize] = useState(300);

    const [editOpen, setEditOpen] = useState(false);
    const [editLoading, setEditLoading] = useState(false);
    const [emailCodeLoading, setEmailCodeLoading] = useState(false);
    const [phoneVerifyLoading, setPhoneVerifyLoading] = useState(false);
    const loadingSpecialties = false;
    const [creatingSpecialty, setCreatingSpecialty] = useState(false);
    const [editError, setEditError] = useState('');
    const [editMessage, setEditMessage] = useState('');

    const [editForm, setEditForm] = useState({
        lastName: '',
        firstName: '',
        middleName: '',
        email: '',
        phone: '',
        infoBlock: '',
        emailCode: '',
        actorPassword: '',
    });

    const [availableSpecialties, setAvailableSpecialties] = useState<DoctorSpecialtyItem[]>([]);
    const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
    const [specialtyPick, setSpecialtyPick] = useState('');
    const [newSpecialtyName, setNewSpecialtyName] = useState('');

    const [emailCodeRequested, setEmailCodeRequested] = useState(false);
    const [emailCodeForEmail, setEmailCodeForEmail] = useState('');
    const [emailCooldownUntil, setEmailCooldownUntil] = useState(0);
    const [nowTs, setNowTs] = useState(Date.now());

    const [phoneVerificationSessionId, setPhoneVerificationSessionId] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(false);
    const [phoneVerifiedForPhone, setPhoneVerifiedForPhone] = useState('');
    const [telegramBotUrl, setTelegramBotUrl] = useState('');
    const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const dragPointerIdRef = useRef<number | null>(null);
    const dragStartRef = useRef({ x: 0, y: 0, originX: 0, originY: 0 });
    const phonePollingRef = useRef<number | null>(null);

    const normalizedEditEmail = useMemo(() => normalizeEmail(editForm.email), [editForm.email]);
    const normalizedEditPhone = useMemo(() => normalizePhone(editForm.phone), [editForm.phone]);
    const cooldownLeftMs = Math.max(0, emailCooldownUntil - nowTs);
    const cooldownActive = cooldownLeftMs > 0;
    const cooldownKey = doctor ? `doctorDetail.emailCooldown.v2:${doctor.id}` : 'doctorDetail.emailCooldown.v2:anon';
    const localizedInfoBlock = useMemo(
        () => pickDoctorInfoByLanguage(doctor?.infoBlock || '', language),
        [doctor?.infoBlock, language],
    );

    useEffect(() => {
        const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        setPreferredSize(detectPreferredSize());
        const onResize = () => setPreferredSize(detectPreferredSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        async function load() {
            if (!token || !doctorId || !isAllowed) {
                setLoading(false);
                return;
            }

            setLoading(true);
            setError('');

            try {
                const [doctorRes, specialtiesRes] = await Promise.all([
                    getDoctorById(token, doctorId),
                    getDoctorSpecialties(token).catch(() => ({ ok: true, specialties: [] as DoctorSpecialtyItem[] })),
                ]);

                setDoctor(doctorRes.doctor);
                setAvailableSpecialties(specialtiesRes.specialties);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити профіль лікаря');
            } finally {
                setLoading(false);
            }
        }

        void load();

        return () => {
            if (phonePollingRef.current) {
                window.clearInterval(phonePollingRef.current);
            }
        };
    }, [token, doctorId, isAllowed]);

    useEffect(() => {
        return () => {
            if (editorImageUrl) URL.revokeObjectURL(editorImageUrl);
        };
    }, [editorImageUrl]);

    useEffect(() => {
        if (!editorOpen) return;
        const updateFrame = () => {
            const width = frameRef.current?.clientWidth || 300;
            setFrameSize(width);
        };
        updateFrame();
        window.addEventListener('resize', updateFrame);
        return () => window.removeEventListener('resize', updateFrame);
    }, [editorOpen]);

    useEffect(() => {
        if (!emailCodeForEmail) return;
        if (normalizedEditEmail !== emailCodeForEmail) {
            setEmailCodeRequested(false);
            setEditForm((prev) => ({ ...prev, emailCode: '' }));
            setEmailCooldownUntil(0);
        }
    }, [normalizedEditEmail, emailCodeForEmail]);

    useEffect(() => {
        if (!phoneVerifiedForPhone) return;
        if (normalizedEditPhone !== phoneVerifiedForPhone) {
            setPhoneVerified(false);
            setPhoneVerificationSessionId('');
            setTelegramBotUrl('');
            setIsPhoneModalOpen(false);
        }
    }, [normalizedEditPhone, phoneVerifiedForPhone]);

    const avatarSrc = useMemo(() => {
        if (!doctor?.hasAvatar) return '';
        return buildDoctorAvatarUrl(doctor.id, preferredSize, doctor.avatarVersion);
    }, [doctor, preferredSize]);

    const avatarSrcSet = useMemo(() => {
        if (!doctor?.hasAvatar) return '';
        const sm = buildDoctorAvatarUrl(doctor.id, 'sm', doctor.avatarVersion);
        const md = buildDoctorAvatarUrl(doctor.id, 'md', doctor.avatarVersion);
        const lg = buildDoctorAvatarUrl(doctor.id, 'lg', doctor.avatarVersion);
        return `${sm} 160w, ${md} 320w, ${lg} 640w`;
    }, [doctor]);

    const frameMetrics = useMemo(() => {
        if (!editorImage) return { renderW: frameSize, renderH: frameSize, maxX: 0, maxY: 0 };
        const baseScale = Math.max(frameSize / editorImage.width, frameSize / editorImage.height);
        const renderW = editorImage.width * baseScale * editorScale;
        const renderH = editorImage.height * baseScale * editorScale;
        const maxX = Math.max(0, (renderW - frameSize) / 2);
        const maxY = Math.max(0, (renderH - frameSize) / 2);
        return { renderW, renderH, maxX, maxY };
    }, [editorImage, editorScale, frameSize]);

    useEffect(() => {
        if (!editorOpen || !editorImage) return;
        setEditorX((prev) => clamp(prev, -frameMetrics.maxX, frameMetrics.maxX));
        setEditorY((prev) => clamp(prev, -frameMetrics.maxY, frameMetrics.maxY));
    }, [editorOpen, editorImage, frameMetrics.maxX, frameMetrics.maxY]);

    function clampPosition(nextX: number, nextY: number) {
        return {
            x: clamp(nextX, -frameMetrics.maxX, frameMetrics.maxX),
            y: clamp(nextY, -frameMetrics.maxY, frameMetrics.maxY),
        };
    }

    function readCooldownForEmail(email: string) {
        try {
            const raw = window.localStorage.getItem(cooldownKey);
            if (!raw) return 0;
            const parsed = JSON.parse(raw) as { email: string; until: number };
            if (normalizeEmail(parsed.email) === normalizeEmail(email) && parsed.until > Date.now()) {
                return parsed.until;
            }
        } catch {}
        return 0;
    }

    function addSelectedSpecialty(name: string) {
        const prepared = name.trim();
        if (!prepared) return;
        setSelectedSpecialties((prev) => {
            if (prev.some((x) => x.toLowerCase() === prepared.toLowerCase())) return prev;
            return [...prev, prepared];
        });
    }

    function removeSelectedSpecialty(name: string) {
        setSelectedSpecialties((prev) => prev.filter((x) => x !== name));
    }

    async function handleCreateSpecialty() {
        if (!token) return;
        const prepared = newSpecialtyName.trim();
        if (!prepared) return;

        setCreatingSpecialty(true);
        setEditError('');
        setEditMessage('');

        try {
            const res = await createDoctorSpecialty(token, prepared);
            setAvailableSpecialties((prev) => {
                if (prev.some((x) => x.name.toLowerCase() === res.specialty.name.toLowerCase())) return prev;
                return [...prev, res.specialty].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
            });
            addSelectedSpecialty(res.specialty.name);
            setNewSpecialtyName('');
            setEditMessage('Спеціальність додано');
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Не вдалося додати спеціальність');
        } finally {
            setCreatingSpecialty(false);
        }
    }

    async function openEditorWithFile(file: File) {
        if (!file.type.startsWith('image/')) {
            setError('Дозволені лише зображення');
            return;
        }

        const url = URL.createObjectURL(file);
        const img = new Image();
        img.decoding = 'async';

        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Не вдалося прочитати зображення'));
            img.src = url;
        });

        if (editorImageUrl) URL.revokeObjectURL(editorImageUrl);
        setEditorImageUrl(url);
        setEditorImage(img);
        setEditorScale(1);
        setEditorX(0);
        setEditorY(0);
        setEditorOpen(true);
        setError('');
        setMessage('');
    }

    async function openEditorFromCurrentAvatar() {
        if (!doctor || !doctor.hasAvatar) return;

        try {
            const url = buildDoctorAvatarUrl(doctor.id, 'lg', doctor.avatarVersion);
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error('Не вдалося завантажити поточне фото');
            const blob = await response.blob();
            const file = new File([blob], `${doctor.id}-current.webp`, { type: blob.type || 'image/webp' });
            await openEditorWithFile(file);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося відкрити редактор');
        }
    }

    function closeEditor() {
        setEditorOpen(false);
        setEditorScale(1);
        setEditorX(0);
        setEditorY(0);
        setEditorImage(null);
        if (editorImageUrl) {
            URL.revokeObjectURL(editorImageUrl);
            setEditorImageUrl('');
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function openEditModal() {
        if (!doctor) return;

        const until = readCooldownForEmail(doctor.email);
        setEditForm({
            lastName: doctor.lastName,
            firstName: doctor.firstName,
            middleName: doctor.middleName || '',
            email: doctor.email,
            phone: doctor.phone,
            infoBlock: pickDoctorInfoByLanguage(doctor.infoBlock || '', language),
            emailCode: '',
            actorPassword: '',
        });

        const initialSpecs = doctor.specialties && doctor.specialties.length > 0
            ? doctor.specialties
            : doctor.specialty
                ? [doctor.specialty]
                : [];

        setSelectedSpecialties(initialSpecs);
        setSpecialtyPick('');
        setNewSpecialtyName('');

        setEmailCodeRequested(until > Date.now());
        setEmailCodeForEmail(until > Date.now() ? normalizeEmail(doctor.email) : '');
        setEmailCooldownUntil(until > Date.now() ? until : 0);

        setPhoneVerificationSessionId('');
        setPhoneVerified(false);
        setPhoneVerifiedForPhone('');
        setTelegramBotUrl('');
        setIsPhoneModalOpen(false);

        setEditError('');
        setEditMessage('');
        setEditOpen(true);
    }

    function closeEditModal() {
        setEditOpen(false);
        if (phonePollingRef.current) {
            window.clearInterval(phonePollingRef.current);
            phonePollingRef.current = null;
        }
    }

    async function handleRequestEmailCode() {
        if (!token || !doctor) return;
        if (!normalizedEditEmail) return setEditError('Вкажи email');
        if (cooldownActive) return;

        const emailChanged = normalizedEditEmail !== normalizeEmail(doctor.email);
        if (!emailChanged) {
            setEditMessage('Email не змінено, код не потрібен');
            setEditError('');
            return;
        }

        setEmailCodeLoading(true);
        setEditError('');
        setEditMessage('');

        try {
            const result = await requestDoctorEmailVerification(token, normalizedEditEmail);
            const until = Date.now() + EMAIL_COOLDOWN_MS;

            setEmailCodeRequested(true);
            setEmailCodeForEmail(normalizedEditEmail);
            setEmailCooldownUntil(until);

            window.localStorage.setItem(cooldownKey, JSON.stringify({ email: normalizedEditEmail, until }));
            setEditMessage(result.message);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Не вдалося надіслати код');
        } finally {
            setEmailCodeLoading(false);
        }
    }

    async function handleStartPhoneVerification() {
        if (!normalizedEditPhone) return setEditError('Вкажи телефон');
        if (!doctor) return;

        const phoneChanged = normalizedEditPhone !== normalizePhone(doctor.phone);
        if (!phoneChanged) {
            setEditMessage('Телефон не змінено, підтвердження не потрібне');
            setEditError('');
            return;
        }

        setPhoneVerifyLoading(true);
        setEditError('');
        setEditMessage('');

        try {
            const result = await startPhoneVerification(normalizedEditPhone);
            setPhoneVerificationSessionId(result.sessionId);
            setPhoneVerified(false);
            setTelegramBotUrl(result.telegramBotUrl);
            setIsPhoneModalOpen(true);

            if (phonePollingRef.current) window.clearInterval(phonePollingRef.current);

            phonePollingRef.current = window.setInterval(async () => {
                try {
                    const status = await getPhoneVerificationStatus(result.sessionId);

                    if (status.status === 'VERIFIED') {
                        if (phonePollingRef.current) {
                            window.clearInterval(phonePollingRef.current);
                            phonePollingRef.current = null;
                        }
                        setPhoneVerified(true);
                        setPhoneVerifiedForPhone(normalizedEditPhone);
                        setTelegramBotUrl('');
                        setIsPhoneModalOpen(false);
                        setEditMessage('Телефон підтверджено');
                    }

                    if (status.status === 'FAILED' || status.status === 'EXPIRED') {
                        if (phonePollingRef.current) {
                            window.clearInterval(phonePollingRef.current);
                            phonePollingRef.current = null;
                        }
                        setPhoneVerified(false);
                        setEditError('Підтвердження телефону не завершено');
                    }
                } catch (pollErr) {
                    if (phonePollingRef.current) {
                        window.clearInterval(phonePollingRef.current);
                        phonePollingRef.current = null;
                    }
                    setPhoneVerified(false);
                    setEditError(pollErr instanceof Error ? pollErr.message : 'Помилка перевірки телефону');
                }
            }, 2000);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Не вдалося запустити підтвердження телефону');
        } finally {
            setPhoneVerifyLoading(false);
        }
    }

    async function saveProfileEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!token || !doctor) return;

        const nextLastName = editForm.lastName.trim();
        const nextFirstName = editForm.firstName.trim();
        const nextMiddleName = editForm.middleName.trim();
        const nextEmail = normalizedEditEmail;
        const nextPhone = normalizedEditPhone;
        const nextInfoBlock = editForm.infoBlock;
        const prevInfoLocalized = parseDoctorInfoLocalized(doctor.infoBlock || '');
        const prevInfoForCurrentLanguage = prevInfoLocalized[language] || '';
        const nextInfoLocalized = { ...prevInfoLocalized, [language]: nextInfoBlock };
        const nextSpecialties = selectedSpecialties.map((s) => s.trim()).filter(Boolean);

        const prevSpecialties = doctor.specialties && doctor.specialties.length > 0
            ? doctor.specialties
            : doctor.specialty
                ? [doctor.specialty]
                : [];

        const specialtiesChanged =
            nextSpecialties.length !== prevSpecialties.length ||
            nextSpecialties.some((item, index) => item !== prevSpecialties[index]);

        const nameChanged =
            nextLastName !== doctor.lastName ||
            nextFirstName !== doctor.firstName ||
            nextMiddleName !== (doctor.middleName || '');

        const emailChanged = nextEmail !== normalizeEmail(doctor.email);
        const phoneChanged = nextPhone !== normalizePhone(doctor.phone);
        const infoChanged = nextInfoBlock !== prevInfoForCurrentLanguage;

        if (!nameChanged && !emailChanged && !phoneChanged && !infoChanged && !specialtiesChanged) {
            setEditError('Немає змін для збереження');
            return;
        }

        if (nextSpecialties.length === 0) {
            setEditError('Обери хоча б одну спеціальність');
            return;
        }

        if (emailChanged && (!emailCodeRequested || !editForm.emailCode.trim())) {
            setEditError('Для зміни пошти надішли та введи код');
            return;
        }

        if (phoneChanged && (!phoneVerificationSessionId || !phoneVerified)) {
            setEditError('Для зміни телефону пройди підтвердження');
            return;
        }

        if (!editForm.actorPassword.trim()) {
            setEditError('Введи свій пароль для підтвердження');
            return;
        }

        setEditLoading(true);
        setEditError('');
        setEditMessage('');

        try {
            const result = await updateDoctor(token, doctor.id, {
                lastName: nextLastName,
                firstName: nextFirstName,
                middleName: nextMiddleName || undefined,
                specialties: nextSpecialties,
                infoBlock: Object.values(nextInfoLocalized).some((value) => value.trim().length > 0)
                    ? serializeDoctorInfoLocalized(nextInfoLocalized)
                    : undefined,
                email: nextEmail,
                phone: nextPhone,
                emailCode: emailChanged ? editForm.emailCode.trim() : undefined,
                phoneVerificationSessionId: phoneChanged ? phoneVerificationSessionId : undefined,
                actorPassword: editForm.actorPassword.trim(),
            });

            setDoctor(result.doctor);
            window.localStorage.removeItem(cooldownKey);
            setEditOpen(false);
            setMessage(result.message);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Не вдалося оновити лікаря');
        } finally {
            setEditLoading(false);
        }
    }

    function startDrag(e: React.PointerEvent<HTMLDivElement>) {
        if (dragPointerIdRef.current !== null) return;
        dragPointerIdRef.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            originX: editorX,
            originY: editorY,
        };
    }

    function onDrag(e: React.PointerEvent<HTMLDivElement>) {
        if (dragPointerIdRef.current !== e.pointerId) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const next = clampPosition(dragStartRef.current.originX + dx, dragStartRef.current.originY + dy);
        setEditorX(next.x);
        setEditorY(next.y);
    }

    function endDrag(e: React.PointerEvent<HTMLDivElement>) {
        if (dragPointerIdRef.current !== e.pointerId) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragPointerIdRef.current = null;
    }

    function changeZoom(nextScale: number) {
        const scale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
        setEditorScale(scale);
    }

    function moveBy(dx: number, dy: number) {
        const next = clampPosition(editorX + dx, editorY + dy);
        setEditorX(next.x);
        setEditorY(next.y);
    }

    async function handleUploadFromEditor() {
        if (!doctor || !token || !editorImage) return;

        setUploading(true);
        setError('');
        setMessage('');

        try {
            const canvas = document.createElement('canvas');
            canvas.width = OUTPUT_SIZE;
            canvas.height = OUTPUT_SIZE;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context unavailable');

            const ratio = OUTPUT_SIZE / frameSize;
            const outRenderW = frameMetrics.renderW * ratio;
            const outRenderH = frameMetrics.renderH * ratio;
            const outX = (OUTPUT_SIZE - outRenderW) / 2 + editorX * ratio;
            const outY = (OUTPUT_SIZE - outRenderH) / 2 + editorY * ratio;

            ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
            ctx.drawImage(editorImage, outX, outY, outRenderW, outRenderH);

            const blob: Blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    (result) => {
                        if (!result) return reject(new Error('Не вдалося згенерувати файл'));
                        resolve(result);
                    },
                    'image/webp',
                    0.92,
                );
            });

            const finalFile = new File([blob], `${doctor.id}-avatar.webp`, { type: 'image/webp' });
            const res = await uploadDoctorAvatar(token, doctor.id, finalFile);

            setDoctor(res.doctor);
            setMessage(res.message);
            closeEditor();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити аватар');
        } finally {
            setUploading(false);
        }
    }

    async function handleRemoveAvatar() {
        if (!doctor || !token) return;
        setRemoving(true);
        setError('');
        setMessage('');

        try {
            const res = await removeDoctorAvatar(token, doctor.id);
            setDoctor(res.doctor);
            setMessage(res.message);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося видалити аватар');
        } finally {
            setRemoving(false);
        }
    }

    if (!isAllowed) {
        return (
            <div className="page-shell doctor-detail-page">
                <div className="container doctor-detail-page__container">
                    <section className="doctor-detail-page__card">
                        <h1 className="doctor-detail-page__title">ПРОФІЛЬ ЛІКАРЯ</h1>
                        <div className="doctor-detail-page__blocked">Доступно лише для ADMIN та SUPER_ADMIN.</div>
                    </section>
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell doctor-detail-page">
            <div className="container doctor-detail-page__container">
                {error && (
                    <div className="doctor-detail-page__top-alert">
                        <AlertToast message={error} variant="error" onClose={() => setError('')} />
                    </div>
                )}
                {message && (
                    <div className="doctor-detail-page__top-alert">
                        <AlertToast message={message} variant="success" onClose={() => setMessage('')} />
                    </div>
                )}

                <section className="doctor-detail-page__card">
                    {loading || !doctor ? (
                        <div className="doctor-detail-page__blocked">Завантаження...</div>
                    ) : (
                        <>
                            <h1 className="doctor-detail-page__title">
                                {doctor.lastName} {doctor.firstName} {doctor.middleName || ''}
                            </h1>

                            <div className="doctor-detail-page__meta">
                                <p>{doctor.email}</p>
                                <p>{doctor.phone}</p>
                            </div>



                            {localizedInfoBlock && (
                                <div className="doctor-detail-page__info-block">
                                    {localizedInfoBlock}
                                </div>
                            )}

                            <div className="doctor-detail-page__avatar-wrap">
                                {doctor.hasAvatar ? (
                                    <img
                                        className="doctor-detail-page__avatar"
                                        src={avatarSrc}
                                        srcSet={avatarSrcSet}
                                        sizes="(max-width: 640px) 180px, (max-width: 1024px) 240px, 300px"
                                        alt="Аватар лікаря"
                                        loading="eager"
                                        decoding="async"
                                    />
                                ) : (
                                    <div className="doctor-detail-page__avatar-placeholder">Немає фото</div>
                                )}
                            </div>

                            <div className="doctor-detail-page__avatar-actions">
                                <label className="doctor-detail-page__upload">
                                    <span>{uploading ? 'ЗАВАНТАЖЕННЯ...' : 'ЗАВАНТАЖИТИ/ЗАМІНИТИ ФОТО'}</span>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        disabled={uploading || removing}
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            await openEditorWithFile(file);
                                        }}
                                    />
                                </label>

                                <button
                                    type="button"
                                    className="doctor-detail-page__edit-btn"
                                    disabled={!doctor.hasAvatar || uploading || removing}
                                    onClick={openEditorFromCurrentAvatar}
                                >
                                    РЕДАГУВАТИ ФОТО
                                </button>

                                <button
                                    type="button"
                                    className="doctor-detail-page__danger-btn"
                                    disabled={!doctor.hasAvatar || removing || uploading}
                                    onClick={handleRemoveAvatar}
                                >
                                    {removing ? 'ВИДАЛЕННЯ...' : 'ВИДАЛИТИ ФОТО'}
                                </button>

                                <button type="button" className="doctor-detail-page__profile-btn" onClick={openEditModal}>
                                    РЕДАГУВАТИ ПРОФІЛЬ
                                </button>
                            </div>
                        </>
                    )}
                </section>
            </div>

            {editorOpen && editorImage && (
                <div className="doctor-detail-page__modal-backdrop">
                    <div className="doctor-detail-page__modal">
                        <h2>РЕДАКТОР ФОТО</h2>

                        <div
                            ref={frameRef}
                            className="doctor-detail-page__editor-frame"
                            onPointerDown={startDrag}
                            onPointerMove={onDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                        >
                            <img
                                src={editorImageUrl}
                                alt="Попередній перегляд"
                                draggable={false}
                                style={{
                                    width: `${frameMetrics.renderW}px`,
                                    height: `${frameMetrics.renderH}px`,
                                    left: '50%',
                                    top: '50%',
                                    transform: `translate(calc(-50% + ${editorX}px), calc(-50% + ${editorY}px))`,
                                }}
                            />
                        </div>

                        <div className="doctor-detail-page__editor-controls">
                            <button type="button" onClick={() => changeZoom(editorScale - 0.15)} disabled={editorScale <= MIN_ZOOM}>
                                ЗМЕНШИТИ
                            </button>
                            <button type="button" onClick={() => changeZoom(editorScale + 0.15)} disabled={editorScale >= MAX_ZOOM}>
                                ЗБІЛЬШИТИ
                            </button>
                            <button type="button" onClick={() => moveBy(MOVE_STEP, 0)}><svg style={{transform: 'rotate(270deg)'}} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16"><path fill="#000" fill-rule="evenodd" d="m7.979 2.021l3.853 3.854l-.707.707l-2.646-2.646v9.043h-1V3.936L4.832 6.582l-.707-.707z" clip-rule="evenodd"/></svg></button>
                            <button type="button" onClick={() => moveBy(-MOVE_STEP, 0)}><svg style={{transform: 'rotate(90deg)'}} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16"><path fill="#000" fill-rule="evenodd" d="m7.979 2.021l3.853 3.854l-.707.707l-2.646-2.646v9.043h-1V3.936L4.832 6.582l-.707-.707z" clip-rule="evenodd"/></svg></button>
                            <button type="button" onClick={() => moveBy(0, MOVE_STEP)}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16"><path fill="#000" fill-rule="evenodd" d="m7.979 2.021l3.853 3.854l-.707.707l-2.646-2.646v9.043h-1V3.936L4.832 6.582l-.707-.707z" clip-rule="evenodd"/></svg></button>
                            <button type="button" onClick={() => moveBy(0, -MOVE_STEP)}><svg style={{transform: 'rotate(180deg)'}} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16"><path fill="#000" fill-rule="evenodd" d="m7.979 2.021l3.853 3.854l-.707.707l-2.646-2.646v9.043h-1V3.936L4.832 6.582l-.707-.707z" clip-rule="evenodd"/></svg></button>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditorScale(1);
                                    setEditorX(0);
                                    setEditorY(0);
                                }}
                            >
                                СКИНУТИ
                            </button>
                        </div>

                        <div className="doctor-detail-page__modal-actions">
                            <button type="button" onClick={closeEditor} disabled={uploading}>
                                СКАСУВАТИ
                            </button>
                            <button type="button" onClick={handleUploadFromEditor} disabled={uploading}>
                                {uploading ? 'ЗБЕРЕЖЕННЯ...' : 'ЗБЕРЕГТИ ФОТО'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editOpen && (
                <div className="doctor-detail-page__modal-backdrop">
                    <form className="doctor-detail-page__modal doctor-detail-page__modal--profile" onSubmit={saveProfileEdit}>
                        <h2>РЕДАГУВАННЯ ЛІКАРЯ</h2>

                        {editError && <AlertToast message={editError} variant="error" onClose={() => setEditError('')} />}
                        {editMessage && <AlertToast message={editMessage} variant="success" onClose={() => setEditMessage('')} />}

                        <input
                            value={editForm.lastName}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, lastName: e.target.value }))}
                            placeholder="Прізвище"
                            autoComplete="off"
                        />
                        <input
                            value={editForm.firstName}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, firstName: e.target.value }))}
                            placeholder="Ім'я"
                            autoComplete="off"
                        />
                        <input
                            value={editForm.middleName}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, middleName: e.target.value }))}
                            placeholder="По батькові"
                            autoComplete="off"
                        />

                        <div className="doctor-detail-page__specialty-section">
                            <label>СПЕЦІАЛЬНОСТІ</label>

                            <select
                                value={specialtyPick}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setSpecialtyPick(value);
                                    addSelectedSpecialty(value);
                                    setSpecialtyPick('');
                                }}
                                disabled={loadingSpecialties}
                            >
                                <option value="">Обери зі списку</option>
                                {availableSpecialties.map((s) => (
                                    <option key={s.id} value={s.name}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>

                            <div className="doctor-detail-page__specialty-create">
                                <input
                                    value={newSpecialtyName}
                                    onChange={(e) => setNewSpecialtyName(e.target.value)}
                                    placeholder="Нова спеціальність"
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    onClick={handleCreateSpecialty}
                                    disabled={creatingSpecialty || !newSpecialtyName.trim()}
                                >
                                    {creatingSpecialty ? '...' : 'ДОДАТИ'}
                                </button>
                            </div>

                            <div className="doctor-detail-page__chips">
                                {selectedSpecialties.length === 0 ? (
                                    <span className="doctor-detail-page__chips-empty">
            Обери або створи хоча б одну спеціальність
        </span>
                                ) : (
                                    selectedSpecialties.map((specialtyId: string) => {
                                        const specialty = availableSpecialties.find(
                                            (s: DoctorSpecialtyItem) => s.id === specialtyId,
                                        );

                                        const label = specialty
                                            ? pickDoctorSpecialtyByLanguage(
                                            (specialty as any).nameI18n || specialty.name,
                                            language,
                                        ) || specialty.name
                                            : specialtyId;

                                        return (
                                            <button
                                                key={specialtyId}
                                                type="button"
                                                className="doctor-detail-page__chip"
                                                onClick={() => removeSelectedSpecialty(specialtyId)}
                                                title="Прибрати спеціальність"
                                            >
                                                <span>{label}</span>
                                                <span className="doctor-detail-page__chip-x">×</span>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        <textarea
                            value={editForm.infoBlock}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, infoBlock: e.target.value }))}
                            placeholder={'Інфоблок лікаря\nЗ переносами рядків'}
                            rows={5}
                        />

                        <input
                            value={editForm.email}
                            onChange={(e) => {
                                const next = e.target.value;
                                setEditForm((prev) => ({ ...prev, email: next }));
                                setEmailCooldownUntil(readCooldownForEmail(next));
                            }}
                            placeholder="Email"
                            autoComplete="off"
                        />
                        <input
                            value={editForm.phone}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                            placeholder="Телефон"
                            autoComplete="off"
                        />

                        <div className="doctor-detail-page__verify-row">
                            <button
                                type="button"
                                onClick={handleRequestEmailCode}
                                disabled={emailCodeLoading || cooldownActive}
                                title={emailCodeRequested ? 'Надіслати код' : undefined}
                            >
                                {emailCodeLoading
                                    ? 'НАДСИЛАННЯ...'
                                    : cooldownActive
                                        ? `НАДІСЛАНО ${formatCooldown(cooldownLeftMs)}`
                                        : emailCodeRequested
                                            ? 'НАДІСЛАТИ КОД'
                                            : 'НАДІСЛАТИ КОД НА ПОШТУ'}
                            </button>

                            <button
                                type="button"
                                onClick={handleStartPhoneVerification}
                                disabled={
                                    phoneVerifyLoading ||
                                    !normalizedEditPhone ||
                                    (phoneVerified && normalizedEditPhone === phoneVerifiedForPhone)
                                }
                            >
                                {phoneVerifyLoading
                                    ? 'ПІДГОТОВКА...'
                                    : phoneVerified && normalizedEditPhone === phoneVerifiedForPhone
                                        ? 'ТЕЛЕФОН ПІДТВЕРДЖЕНО'
                                        : 'ПІДТВЕРДИТИ ТЕЛЕФОН'}
                            </button>
                        </div>

                        <input
                            value={editForm.emailCode}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, emailCode: e.target.value }))}
                            placeholder="Код підтвердження email"
                            autoComplete="off"
                        />

                        <input
                            type="password"
                            value={editForm.actorPassword}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, actorPassword: e.target.value }))}
                            placeholder="Твій пароль ADMIN/SUPER_ADMIN"
                            autoComplete="new-password"
                        />

                        <div className="doctor-detail-page__verify-status">
                            <span className={emailCodeRequested ? 'ok' : 'pending'}>
                                Email: {emailCodeRequested ? 'код надіслано' : 'код не надіслано'}
                            </span>
                            <span className={phoneVerified ? 'ok' : 'pending'}>
                                Телефон: {phoneVerified ? 'підтверджено' : 'не підтверджено'}
                            </span>
                        </div>

                        <div className="doctor-detail-page__modal-actions">
                            <button type="button" onClick={closeEditModal}>
                                СКАСУВАТИ
                            </button>
                            <button type="submit" disabled={editLoading}>
                                {editLoading ? 'ЗБЕРЕЖЕННЯ...' : 'ЗБЕРЕГТИ'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {isPhoneModalOpen && telegramBotUrl && (
                <div className="doctor-detail-page__modal-backdrop">
                    <div className="doctor-detail-page__modal doctor-detail-page__modal--phone">
                        <h2>ПІДТВЕРДЖЕННЯ ТЕЛЕФОНУ</h2>
                        <TelegramQrCard
                            telegramBotUrl={telegramBotUrl}
                            title="QR ДЛЯ ПІДТВЕРДЖЕННЯ НОВОГО ТЕЛЕФОНУ"
                            subtitle="Скануй QR через Telegram або натисни кнопку переходу."
                        />
                        <button type="button" onClick={() => setIsPhoneModalOpen(false)}>
                            ЗГОРНУТИ
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
