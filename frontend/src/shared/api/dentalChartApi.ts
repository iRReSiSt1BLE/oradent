import { API_BASE_URL, http } from './http';

export type DentalTargetType = 'TOOTH' | 'JAW' | 'MOUTH';
export type DentalJaw = 'UPPER' | 'LOWER' | 'WHOLE';

export type DentalSnapshotItem = {
    id: string;
    appointmentId: string | null;
    patientId: string;
    doctorId: string | null;
    doctorName: string | null;
    cabinetId: string | null;
    cabinetDeviceId: string | null;
    pairKey: string | null;
    targetType: DentalTargetType;
    targetId: string | null;
    toothNumber: number | null;
    jaw: DentalJaw | null;
    title: string | null;
    description: string | null;
    mimeType: string | null;
    hasFile: boolean;
    size: number;
    source: 'CAPTURE_AGENT' | 'MANUAL_UPLOAD' | 'NOTE_ONLY';
    capturedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

export type DentalToothItem = {
    number: number;
    targetId: string;
    jaw: 'UPPER' | 'LOWER';
    snapshotCount: number;
    snapshots: DentalSnapshotItem[];
};

export type DentalChartResponse = {
    ok: boolean;
    patient: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        email: string | null;
    };
    activeAppointmentId: string | null;
    teeth: DentalToothItem[];
    mouthHistory: DentalSnapshotItem[];
    upperJawHistory: DentalSnapshotItem[];
    lowerJawHistory: DentalSnapshotItem[];
    snapshots: DentalSnapshotItem[];
};

export type SaveDentalSnapshotPayload = {
    targetType: DentalTargetType;
    targetId?: string | null;
    toothNumber?: number | null;
    jaw?: DentalJaw | null;
    title?: string | null;
    description?: string | null;
    capturedAt?: string | null;
    currentAppointmentId?: string | null;
};

export async function getAppointmentDentalChart(token: string, appointmentId: string) {
    return http<DentalChartResponse>(`/dental-chart/appointment/${appointmentId}`, {
        method: 'GET',
        token,
    });
}

export async function getAppointmentDentalChartWithPassword(token: string, appointmentId: string, password: string) {
    return http<DentalChartResponse>(`/dental-chart/appointment/${appointmentId}/auth`, {
        method: 'POST',
        token,
        body: JSON.stringify({ password }),
    });
}

export async function getMyDentalChart(token: string) {
    return http<DentalChartResponse>('/dental-chart/my', {
        method: 'GET',
        token,
    });
}

export async function createDentalSnapshot(token: string, appointmentId: string, payload: SaveDentalSnapshotPayload, imageFile?: File | null) {
    const formData = new FormData();
    formData.append('targetType', payload.targetType);
    if (payload.targetId) formData.append('targetId', payload.targetId);
    if (typeof payload.toothNumber === 'number') formData.append('toothNumber', String(payload.toothNumber));
    if (payload.jaw) formData.append('jaw', payload.jaw);
    if (payload.title) formData.append('title', payload.title);
    if (payload.description) formData.append('description', payload.description);
    if (payload.capturedAt) formData.append('capturedAt', payload.capturedAt);
    if (imageFile) formData.append('image', imageFile);

    return http<{ ok: boolean; snapshot: DentalSnapshotItem }>(`/dental-chart/appointment/${appointmentId}/snapshots`, {
        method: 'POST',
        token,
        body: formData,
    });
}

export async function updateDentalSnapshot(token: string, snapshotId: string, payload: SaveDentalSnapshotPayload) {
    return http<{ ok: boolean; snapshot: DentalSnapshotItem }>(`/dental-chart/snapshots/${snapshotId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function deleteDentalSnapshot(token: string, snapshotId: string, currentAppointmentId?: string | null) {
    const query = currentAppointmentId ? `?currentAppointmentId=${encodeURIComponent(currentAppointmentId)}` : '';
    return http<{ ok: boolean }>(`/dental-chart/snapshots/${snapshotId}${query}`, {
        method: 'DELETE',
        token,
    });
}

export async function fetchDentalSnapshotFile(token: string, snapshotId: string) {
    const response = await fetch(`${API_BASE_URL}/dental-chart/snapshots/${snapshotId}/file`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        const message = await response.text().catch(() => 'Snapshot loading failed.');
        throw new Error(message || 'Snapshot loading failed.');
    }

    return response.blob();
}
