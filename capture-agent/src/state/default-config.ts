export type AgentConfiguredPair = {
  pairKey: string;
  displayName: string;
  videoDeviceId: string;
  audioDeviceId: string;
  snapshotHotkey?: string;
};

export type AgentConfig = {
  backendUrl: string;
  cabinetCode: string;
  wsPath: string;
  heartbeatSeconds: number;
  agentKey: string;
  agentToken: string;
  agentId: string;
  agentName: string;
  transportKey: string;
  activePairKey: string;
  configuredPairs: AgentConfiguredPair[];
  snapshotHotkey: string;
};

export const defaultConfig: AgentConfig = {
  backendUrl: process.env.ORADENT_CAPTURE_BACKEND_URL || 'http://localhost:3000',
  cabinetCode: '',
  wsPath: process.env.ORADENT_CAPTURE_WS_PATH || '/capture-agent/ws',
  heartbeatSeconds: Number(process.env.ORADENT_CAPTURE_HEARTBEAT_SECONDS || 15),
  agentKey: '',
  agentToken: '',
  agentId: '',
  agentName: process.env.ORADENT_CAPTURE_AGENT_NAME || 'Oradent Capture Agent',
  transportKey: process.env.CAPTURE_AGENT_TRANSPORT_KEY || process.env.ORADENT_CAPTURE_TRANSPORT_KEY || '',
  activePairKey: '',
  configuredPairs: [],
  snapshotHotkey: 'F8',
};
