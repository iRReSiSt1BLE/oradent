import { useEffect, useRef, useState } from 'react';
import { uploadVideo } from '../../shared/api/videoApi';

type VideoDevice = {
    deviceId: string;
    label: string;
};

export default function AppointmentPage() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef<string | null>(null);

    const [devices, setDevices] = useState<VideoDevice[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');
    const [isCameraOn, setIsCameraOn] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState('Камера вимкнена');
    const [lastUploadMessage, setLastUploadMessage] = useState('');

    useEffect(() => {
        initDevices();

        return () => {
            stopCamera();
        };
    }, []);

    async function initDevices() {
        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();

            const videoDevices = allDevices
                .filter((d) => d.kind === 'videoinput')
                .map((d, i) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Камера ${i + 1}`,
                }));

            setDevices(videoDevices);

            if (videoDevices.length > 0) {
                setSelectedDeviceId(videoDevices[0].deviceId);
            }

            setStatus(videoDevices.length > 0 ? 'Камеру можна увімкнути' : 'Камери не знайдено');
        } catch (error) {
            console.error(error);
            setStatus('Не вдалося отримати список камер');
        }
    }

    function clearVideoPreview() {
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }

    function stopCamera() {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }

        clearVideoPreview();
        setIsCameraOn(false);
    }

    async function startCamera() {
        try {
            if (!selectedDeviceId) {
                setStatus('Спочатку обери камеру');
                return;
            }

            stopCamera();

            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: { exact: selectedDeviceId },
                },
                audio: true,
            });

            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }

            setIsCameraOn(true);
            setStatus('Камера увімкнена');
        } catch (error) {
            console.error(error);
            setStatus('Не вдалося увімкнути камеру');
        }
    }

    async function handleChangeCamera(deviceId: string) {
        setSelectedDeviceId(deviceId);

        if (isCameraOn) {
            try {
                stopCamera();

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        deviceId: { exact: deviceId },
                    },
                    audio: true,
                });

                streamRef.current = stream;

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }

                setIsCameraOn(true);
                setStatus('Камеру змінено');
            } catch (error) {
                console.error(error);
                setStatus('Не вдалося переключити камеру');
            }
        }
    }

    function startRecording() {
        if (!streamRef.current) {
            setStatus('Спочатку увімкни камеру');
            return;
        }

        try {
            chunksRef.current = [];
            startedAtRef.current = new Date().toISOString();

            const recorder = new MediaRecorder(streamRef.current, {
                mimeType: 'video/webm',
            });

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            recorder.onstop = async () => {
                const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                const file = new File([blob], `appointment-video-${Date.now()}.webm`, {
                    type: 'video/webm',
                });

                const formData = new FormData();
                formData.append('video', file);
                formData.append('appointmentId', 'test');
                formData.append('startedAt', startedAtRef.current || new Date().toISOString());
                formData.append('endedAt', new Date().toISOString());

                try {
                    setStatus('Завантаження відео на сервер...');
                    const result = await uploadVideo(formData);
                    setLastUploadMessage(result.message || 'Відео успішно завантажено');
                    setStatus('Відео успішно завантажено');
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : 'Помилка під час завантаження відео';
                    console.error(error);
                    setStatus(message);
                }
            };

            mediaRecorderRef.current = recorder;
            recorder.start();

            setIsRecording(true);
            setLastUploadMessage('');
            setStatus('Запис триває...');
        } catch (error) {
            console.error(error);
            setStatus('Не вдалося почати запис');
        }
    }

    function stopRecording() {
        if (!mediaRecorderRef.current) {
            return;
        }

        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
        setIsRecording(false);
    }

    return (
        <div>
            <h1>Appointment</h1>
            <p>Status: {status}</p>

            <div style={{ marginBottom: '12px' }}>
                <label htmlFor="camera-select">Камера: </label>
                <select
                    id="camera-select"
                    value={selectedDeviceId}
                    onChange={(e) => handleChangeCamera(e.target.value)}
                >
                    {devices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                            {device.label}
                        </option>
                    ))}
                </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
                <button onClick={startCamera} disabled={isCameraOn || !selectedDeviceId}>
                    Увімкнути камеру
                </button>
                <button onClick={stopCamera} disabled={!isCameraOn || isRecording}>
                    Вимкнути камеру
                </button>
            </div>

            <div style={{ marginBottom: '12px' }}>
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{
                        width: '500px',
                        background: '#000',
                        display: 'block',
                    }}
                />
            </div>

            <div style={{ marginBottom: '12px' }}>
                <button onClick={startRecording} disabled={!isCameraOn || isRecording}>
                    Почати запис
                </button>
                <button onClick={stopRecording} disabled={!isRecording}>
                    Завершити запис
                </button>
            </div>

            <p>{lastUploadMessage}</p>
        </div>
    );
}