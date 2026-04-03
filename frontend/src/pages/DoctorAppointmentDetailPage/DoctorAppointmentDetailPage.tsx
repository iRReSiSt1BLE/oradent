import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import AlertToast from '../../widgets/AlertToast/AlertToast';
import { completeAppointmentRecording, getAppointmentById } from '../../shared/api/appointmentApi';
import type { AppointmentItem } from '../../shared/api/appointmentApi';
import { getVideosByAppointment, streamVideoWithPassword, uploadVideo } from '../../shared/api/videoApi';
import type { VideoRecord } from '../../shared/api/videoApi';
import { getToken, getTokenPayload, getUserRole } from '../../shared/utils/authStorage';
import './DoctorAppointmentDetailPage.scss';

type MediaDeviceOption = {
    id: string;
    label: string;
};

type RecorderSlotState = {
    id: number;
    videoDeviceId: string;
    audioDeviceId: string;
    recording: boolean;
    uploading: boolean;
    showPreview: boolean;
};

function fullName(a: AppointmentItem | null) {
    if (!a?.patient) return 'Пацієнт не вказаний';
    return `${a.patient.lastName} ${a.patient.firstName}${a.patient.middleName ? ` ${a.patient.middleName}` : ''}`;
}

function formatDate(value: string | null) {
    if (!value) return 'Дата не вказана';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('ua-UA');
}

function pickSupportedMimeType() {
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const type of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

function createSlot(id: number, videoDeviceId: string, audioDeviceId: string): RecorderSlotState {
    return {
        id,
        videoDeviceId,
        audioDeviceId,
        recording: false,
        uploading: false,
        showPreview: false,
    };
}

export default function DoctorAppointmentDetailPage() {
    const { id } = useParams();
    const role = getUserRole();
    const payload = getTokenPayload();
    const token = getToken();
    const doctorUserId = payload?.sub || null;
    const isDoctor = role === 'DOCTOR';

    const [appointment, setAppointment] = useState<AppointmentItem | null>(null);
    const [loading, setLoading] = useState(true);

    const [videoDevices, setVideoDevices] = useState<MediaDeviceOption[]>([]);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceOption[]>([]);
    const [slots, setSlots] = useState<RecorderSlotState[]>([]);

    const [videos, setVideos] = useState<VideoRecord[]>([]);
    const [videoPassword, setVideoPassword] = useState('');
    const [openedVideoUrls, setOpenedVideoUrls] = useState<Record<string, string>>({});

    const [successMessage, setSuccessMessage] = useState('');
    const [error, setError] = useState('');

    const slotSeqRef = useRef(1);
    const previewRefs = useRef<Record<number, HTMLVideoElement | null>>({});
    const streamsRef = useRef<Record<number, MediaStream | null>>({});
    const recordersRef = useRef<Record<number, MediaRecorder | null>>({});
    const chunksRef = useRef<Record<number, BlobPart[]>>({});
    const startedAtRef = useRef<Record<number, Date | null>>({});
    const endedAtRef = useRef<Record<number, Date | null>>({});

    const isMyAppointment = useMemo(() => {
        if (!appointment || !doctorUserId) return false;
        return appointment.doctorId === doctorUserId;
    }, [appointment, doctorUserId]);

    const hasAnyRecording = useMemo(() => slots.some((s) => s.recording), [slots]);
    const hasAnyUploading = useMemo(() => slots.some((s) => s.uploading), [slots]);

    useEffect(() => {
        async function loadAppointment() {
            if (!id || !isDoctor || !doctorUserId) {
                setLoading(false);
                return;
            }

            try {
                const item = await getAppointmentById(id);
                setAppointment(item);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Не вдалося завантажити запис');
            } finally {
                setLoading(false);
            }
        }

        void loadAppointment();
    }, [id, isDoctor, doctorUserId]);

    useEffect(() => {
        async function bootstrapDevices() {
            try {
                const temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                temp.getTracks().forEach((t) => t.stop());
            } catch {}

            try {
                const list = await navigator.mediaDevices.enumerateDevices();

                const videosList = list
                    .filter((d) => d.kind === 'videoinput')
                    .map((d, i) => ({
                        id: d.deviceId,
                        label: d.label || `Камера ${i + 1}`,
                    }));

                const audiosList = list
                    .filter((d) => d.kind === 'audioinput')
                    .map((d, i) => ({
                        id: d.deviceId,
                        label: d.label || `Мікрофон ${i + 1}`,
                    }));

                setVideoDevices(videosList);
                setAudioDevices(audiosList);

                const defaultVideo = videosList[0]?.id || '';
                const defaultAudio = audiosList[0]?.id || '';

                setSlots((prev) => {
                    if (prev.length > 0) {
                        return prev.map((s) => ({
                            ...s,
                            videoDeviceId: s.videoDeviceId || defaultVideo,
                            audioDeviceId: s.audioDeviceId || defaultAudio,
                        }));
                    }

                    return [createSlot(slotSeqRef.current, defaultVideo, defaultAudio)];
                });
            } catch {
                setError('Не вдалося отримати список пристроїв');
            }
        }

        void bootstrapDevices();
    }, []);

    useEffect(() => {
        if (!appointment?.id || !token) return;
        void refreshVideos();
    }, [appointment?.id, token]);

    useEffect(() => {
        return () => {
            Object.values(recordersRef.current).forEach((rec) => {
                if (rec && rec.state !== 'inactive') rec.stop();
            });

            Object.values(streamsRef.current).forEach((stream) => {
                if (stream) stream.getTracks().forEach((t) => t.stop());
            });

            Object.values(openedVideoUrls).forEach((url) => URL.revokeObjectURL(url));
        };
    }, [openedVideoUrls]);

    async function refreshVideos() {
        if (!appointment?.id || !token) return;

        try {
            const res = await getVideosByAppointment(token, appointment.id);
            setVideos(res.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити відео прийому');
        }
    }

    function updateSlot(slotId: number, patch: Partial<RecorderSlotState>) {
        setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, ...patch } : s)));
    }

    function attachStreamToPreview(slotId: number, stream: MediaStream) {
        const videoEl = previewRefs.current[slotId];
        if (!videoEl) return;
        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        void videoEl.play().catch(() => null);
    }

    function addSlot() {
        if (slots.length >= 5) return;
        const defaultVideo = videoDevices[0]?.id || '';
        const defaultAudio = audioDevices[0]?.id || '';
        slotSeqRef.current += 1;
        setSlots((prev) => [...prev, createSlot(slotSeqRef.current, defaultVideo, defaultAudio)]);
    }

    function removeSlot(slotId: number) {
        const slot = slots.find((s) => s.id === slotId);
        if (!slot || slot.recording || slot.uploading) return;

        setSlots((prev) => prev.filter((s) => s.id !== slotId));
        delete previewRefs.current[slotId];
        delete chunksRef.current[slotId];
        delete startedAtRef.current[slotId];
        delete endedAtRef.current[slotId];

        if (streamsRef.current[slotId]) {
            streamsRef.current[slotId]?.getTracks().forEach((t) => t.stop());
            delete streamsRef.current[slotId];
        }
        delete recordersRef.current[slotId];
    }

    async function startRecording(slotId: number) {
        if (!appointment?.id || !token) {
            setError('Потрібна авторизація');
            return;
        }

        const slot = slots.find((s) => s.id === slotId);
        if (!slot || slot.recording || slot.uploading) return;

        setError('');

        try {
            if (streamsRef.current[slotId]) {
                streamsRef.current[slotId]?.getTracks().forEach((t) => t.stop());
                streamsRef.current[slotId] = null;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: slot.videoDeviceId ? { exact: slot.videoDeviceId } : undefined,
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30, max: 30 },
                },
                audio: slot.audioDeviceId ? { deviceId: { exact: slot.audioDeviceId } } : true,
            });

            streamsRef.current[slotId] = stream;
            chunksRef.current[slotId] = [];
            startedAtRef.current[slotId] = new Date();
            endedAtRef.current[slotId] = null;

            updateSlot(slotId, { recording: true, showPreview: true });
            requestAnimationFrame(() => attachStreamToPreview(slotId, stream));

            const mimeType = pickSupportedMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    if (!chunksRef.current[slotId]) chunksRef.current[slotId] = [];
                    chunksRef.current[slotId].push(event.data);
                }
            };

            recorder.onerror = () => {
                updateSlot(slotId, { recording: false, showPreview: false });
                setError('Помилка запису відео. Спробуй іншу камеру або мікрофон.');
            };

            recorder.onstop = async () => {
                const blob = new Blob(chunksRef.current[slotId] || [], { type: mimeType || 'video/webm' });
                endedAtRef.current[slotId] = new Date();

                const streamToStop = streamsRef.current[slotId];
                if (streamToStop) {
                    streamToStop.getTracks().forEach((t) => t.stop());
                    streamsRef.current[slotId] = null;
                }

                const videoElInner = previewRefs.current[slotId];
                if (videoElInner) {
                    videoElInner.srcObject = null;
                    videoElInner.src = '';
                }

                updateSlot(slotId, { recording: false, showPreview: false });

                if (blob.size === 0) {
                    setError('Отримано порожнє відео. Спробуй іншу камеру або перезапусти DroidCam.');
                    return;
                }

                await uploadSlotRecording(slotId, blob);
            };

            recordersRef.current[slotId] = recorder;
            recorder.start(1000);
        } catch (err) {
            updateSlot(slotId, { recording: false, showPreview: false });
            setError(err instanceof Error ? err.message : 'Не вдалося почати запис');
        }
    }

    function stopRecording(slotId: number) {
        const slot = slots.find((s) => s.id === slotId);
        if (!slot || !slot.recording) return;

        const recorder = recordersRef.current[slotId];
        if (!recorder || recorder.state === 'inactive') return;
        recorder.stop();
    }

    async function uploadSlotRecording(slotId: number, blob: Blob) {
        if (!appointment?.id || !token) return;

        updateSlot(slotId, { uploading: true });

        try {
            const file = new File([blob], `appointment-${appointment.id}-slot-${slotId}.webm`, {
                type: blob.type || 'video/webm',
                lastModified: Date.now(),
            });

            const formData = new FormData();
            formData.append('video', file);
            formData.append('appointmentId', appointment.id);

            if (startedAtRef.current[slotId]) formData.append('startedAt', startedAtRef.current[slotId]!.toISOString());
            if (endedAtRef.current[slotId]) formData.append('endedAt', endedAtRef.current[slotId]!.toISOString());

            await uploadVideo(token, formData);
            setSuccessMessage('Відео успішно завантажено');
            await refreshVideos();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завантажити відео');
        } finally {
            updateSlot(slotId, { uploading: false });
        }
    }

    async function finishRecording() {
        if (!appointment?.id || !token) return;
        if (hasAnyRecording || hasAnyUploading) return;

        try {
            const result = await completeAppointmentRecording(token, appointment.id);
            setAppointment(result.appointment);
            await refreshVideos();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося завершити запис');
        }
    }

    async function openDecryptedVideo(videoId: string) {
        if (!token) {
            setError('Потрібна авторизація');
            return;
        }

        if (!videoPassword.trim()) {
            setError('Введи пароль від акаунту для перегляду');
            return;
        }

        try {
            const blob = await streamVideoWithPassword(token, videoId, videoPassword.trim());
            const url = URL.createObjectURL(blob);

            setOpenedVideoUrls((prev) => {
                if (prev[videoId]) URL.revokeObjectURL(prev[videoId]);
                return { ...prev, [videoId]: url };
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Не вдалося відкрити відео');
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
                    {error && <AlertToast message={error} variant="error" onClose={() => setError('')} />}
                    {successMessage && (
                        <AlertToast message={successMessage} variant="success" onClose={() => setSuccessMessage('')} />
                    )}

                    {loading ? (
                        <div className="doctor-appointment-detail__state">Завантаження...</div>
                    ) : !appointment ? (
                        <div className="doctor-appointment-detail__state">Запис не знайдено</div>
                    ) : !isMyAppointment ? (
                        <div className="doctor-appointment-detail__state">Цей запис не належить поточному лікарю.</div>
                    ) : (
                        <>
                            <h1 className="doctor-appointment-detail__title">ПРИЙОМ</h1>

                            <div className="doctor-appointment-detail__meta">
                                <div>
                                    <span>Пацієнт</span>
                                    <strong>{fullName(appointment)}</strong>
                                </div>
                                <div>
                                    <span>Телефон</span>
                                    <strong>{appointment.patient?.phone || 'Не вказано'}</strong>
                                </div>
                                <div>
                                    <span>Дата та час</span>
                                    <strong>{formatDate(appointment.appointmentDate)}</strong>
                                </div>
                                <div>
                                    <span>Статус</span>
                                    <strong>{appointment.recordingCompleted ? 'Запис завершено' : appointment.status}</strong>
                                </div>
                            </div>

                            <div className="doctor-appointment-detail__video-block">
                                <div className="doctor-appointment-detail__video-head">
                                    <h2>Відеозапис прийому</h2>
                                    <button type="button" onClick={addSlot} disabled={slots.length >= 5 || hasAnyUploading}>
                                        Додати камеру
                                    </button>
                                </div>

                                <div className="doctor-appointment-detail__slots">
                                    {slots.map((slot) => (
                                        <div key={slot.id} className="doctor-appointment-detail__slot">
                                            <div className="doctor-appointment-detail__slot-top">
                                                <strong>Камера {slot.id}</strong>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSlot(slot.id)}
                                                    disabled={slots.length === 1 || slot.recording || slot.uploading}
                                                >
                                                    Видалити
                                                </button>
                                            </div>

                                            <div className="doctor-appointment-detail__device-row">
                                                <label className="doctor-appointment-detail__field">
                                                    <span>Камера</span>
                                                    <select
                                                        value={slot.videoDeviceId}
                                                        onChange={(e) => updateSlot(slot.id, { videoDeviceId: e.target.value })}
                                                        disabled={slot.recording || slot.uploading}
                                                    >
                                                        {videoDevices.length === 0 ? (
                                                            <option value="">Камери не знайдено</option>
                                                        ) : (
                                                            videoDevices.map((d) => (
                                                                <option key={d.id} value={d.id}>
                                                                    {d.label}
                                                                </option>
                                                            ))
                                                        )}
                                                    </select>
                                                </label>

                                                <label className="doctor-appointment-detail__field">
                                                    <span>Мікрофон</span>
                                                    <select
                                                        value={slot.audioDeviceId}
                                                        onChange={(e) => updateSlot(slot.id, { audioDeviceId: e.target.value })}
                                                        disabled={slot.recording || slot.uploading}
                                                    >
                                                        {audioDevices.length === 0 ? (
                                                            <option value="">Мікрофони не знайдено</option>
                                                        ) : (
                                                            audioDevices.map((d) => (
                                                                <option key={d.id} value={d.id}>
                                                                    {d.label}
                                                                </option>
                                                            ))
                                                        )}
                                                    </select>
                                                </label>
                                            </div>

                                            <video
                                                ref={(el) => {
                                                    previewRefs.current[slot.id] = el;
                                                }}
                                                className={`doctor-appointment-detail__preview ${slot.showPreview ? '' : 'is-hidden'}`}
                                                playsInline
                                                autoPlay
                                                muted
                                                onLoadedMetadata={(e) => {
                                                    void e.currentTarget.play().catch(() => null);
                                                }}
                                            />

                                            <div className="doctor-appointment-detail__video-actions">
                                                {!slot.recording ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => startRecording(slot.id)}
                                                        disabled={slot.uploading || appointment.recordingCompleted}
                                                    >
                                                        Почати запис
                                                    </button>
                                                ) : (
                                                    <button type="button" onClick={() => stopRecording(slot.id)} disabled={slot.uploading}>
                                                        Зупинити запис
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="doctor-appointment-detail__finish-row">
                                    <button
                                        type="button"
                                        onClick={finishRecording}
                                        disabled={hasAnyRecording || hasAnyUploading || Boolean(appointment.recordingCompleted)}
                                    >
                                        Завершити запис
                                    </button>
                                </div>
                            </div>

                            {appointment.recordingCompleted && (
                                <div className="doctor-appointment-detail__history">
                                    <h2>Розшифровані відео візиту</h2>

                                    <label className="doctor-appointment-detail__field">
                                        <span>Пароль від акаунту</span>
                                        <input
                                            type="password"
                                            value={videoPassword}
                                            onChange={(e) => setVideoPassword(e.target.value)}
                                            placeholder="Введи пароль для доступу до відео"
                                        />
                                    </label>

                                    {videos.length === 0 ? (
                                        <div className="doctor-appointment-detail__state">Відео ще не завантажувалися.</div>
                                    ) : (
                                        <div className="doctor-appointment-detail__video-list">
                                            {videos.map((v) => (
                                                <div key={v.id} className="doctor-appointment-detail__video-item">
                                                    <div className="doctor-appointment-detail__video-item-head">
                                                        <strong>{new Date(v.createdAt).toLocaleString('ua-UA')}</strong>
                                                        <button type="button" onClick={() => openDecryptedVideo(v.id)}>
                                                            Відкрити
                                                        </button>
                                                    </div>

                                                    {openedVideoUrls[v.id] && (
                                                        <video
                                                            className="doctor-appointment-detail__history-player"
                                                            src={openedVideoUrls[v.id]}
                                                            controls
                                                            playsInline
                                                        />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
