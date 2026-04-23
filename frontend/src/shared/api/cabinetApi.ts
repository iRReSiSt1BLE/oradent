import { http } from './http';

export type CabinetDeviceStartMode = 'AUTO_ON_VISIT_START' | 'MANUAL';

export type CabinetDoctorOption = {
    id: string;
    userId: string | null;
    lastName: string;
    firstName: string;
    middleName: string | null;
    specialty?: string | null;
    specialties?: string[];
    isActive: boolean;
};

export type CabinetServiceSpecialtyOption = {
    id: string;
    name: string;
    order: number;
    isActive: boolean;
};

export type CabinetServiceOption = {
    id: string;
    name: string;
    isActive: boolean;
    categoryId: string;
    durationMinutes: number;
    priceUah: number;
    specialtyIds: string[];
    specialties: CabinetServiceSpecialtyOption[];
    doctorIds?: string[];
};

export type CabinetDeviceItem = {
    id: string;
    name: string;
    cameraDeviceId: string | null;
    cameraLabel: string | null;
    microphoneDeviceId: string | null;
    microphoneLabel: string | null;
    startMode: CabinetDeviceStartMode;
    isActive: boolean;
    sortOrder: number;
};

export type CabinetDoctorAssignment = {
    id: string;
    doctorId: string;
    doctor: CabinetDoctorOption;
};

export type CabinetAgentPair = {
    id: string;
    pairKey: string;
    displayName: string | null;
    videoDeviceId: string;
    videoLabel: string | null;
    audioDeviceId: string;
    audioLabel: string | null;
    isAvailable: boolean;
    sortOrder: number;
};

export type CabinetLinkedAgent = {
    id: string;
    agentKey: string;
    name: string;
    status: string;
    lastSeenAt: string | null;
    wsConnectedAt: string | null;
    appVersion: string | null;
    pairs: CabinetAgentPair[];
};

export type CabinetItem = {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    connectionCode: string;
    agentKey: string | null;
    linkedAgent: CabinetLinkedAgent | null;
    serviceIds: string[];
    services: CabinetServiceOption[];
    devices: CabinetDeviceItem[];
    doctorIds: string[];
    doctorAssignments: CabinetDoctorAssignment[];
    createdAt: string;
    updatedAt: string;
};

export type CabinetSetupSession = {
    id: string;
    connectionCode: string;
    agentKey: string | null;
    agentName: string | null;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    linkedAgent: CabinetLinkedAgent | null;
};


export type CabinetPreviewResponse = {
    preview: {
        pairKey: string;
        imageDataUrl: string;
        mimeType: string;
        capturedAt: string;
    };
};

export type CabinetPayload = {
    name: string;
    description?: string;
    isActive?: boolean;
    serviceIds: string[];
    doctorIds?: string[];
    setupSessionId?: string;
    agentKey?: string;
    devices?: Array<{
        name: string;
        cameraDeviceId?: string;
        cameraLabel?: string;
        microphoneDeviceId?: string;
        microphoneLabel?: string;
        startMode: CabinetDeviceStartMode;
    }>;
};

export async function getCabinets(token: string) {
    return http<{ cabinets: CabinetItem[] }>('/cabinets', {
        method: 'GET',
        token,
    });
}

export async function getCabinetDoctorsOptions(token: string) {
    return http<{ doctors: CabinetDoctorOption[] }>('/cabinets/doctors/options', {
        method: 'GET',
        token,
    });
}

export async function getCabinetServicesOptions(token: string) {
    return http<{ services: CabinetServiceOption[] }>('/cabinets/services/options', {
        method: 'GET',
        token,
    });
}

export async function initCabinetSetupSession(token: string) {
    return http<{ setupSession: CabinetSetupSession }>('/cabinets/setup/init', {
        method: 'POST',
        token,
        body: JSON.stringify({}),
    });
}

export async function getCabinetSetupSession(token: string, setupSessionId: string) {
    return http<{ setupSession: CabinetSetupSession }>(`/cabinets/setup/${setupSessionId}`, {
        method: 'GET',
        token,
    });
}

export async function deleteCabinetSetupSession(token: string, setupSessionId: string) {
    return http<{ ok: boolean; id: string }>(`/cabinets/setup/${setupSessionId}`, {
        method: 'DELETE',
        token,
    });
}

export async function createCabinet(token: string, payload: CabinetPayload) {
    return http<{ cabinet: CabinetItem }>('/cabinets', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}

export async function updateCabinet(token: string, cabinetId: string, payload: CabinetPayload) {
    return http<{ cabinet: CabinetItem }>(`/cabinets/${cabinetId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(payload),
    });
}

export async function toggleCabinetActive(token: string, cabinetId: string) {
    return http<{ cabinet: CabinetItem }>(`/cabinets/${cabinetId}/toggle-active`, {
        method: 'PATCH',
        token,
    });
}

export async function deleteCabinet(token: string, cabinetId: string) {
    return http<{ ok: boolean; id: string }>(`/cabinets/${cabinetId}`, {
        method: 'DELETE',
        token,
    });
}

export async function requestCabinetPreview(token: string, payload: { setupSessionId?: string; cabinetId?: string; pairKey: string }) {
    return http<CabinetPreviewResponse>('/cabinets/preview', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
    });
}
