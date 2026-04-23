import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { AgentConfig, AgentConfiguredPair, defaultConfig } from '../state/default-config';

function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'agent-config.json');
}

function ensureDirectoryExists(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeReadConfigFile(): Partial<AgentConfig> {
  try {
    const filePath = getConfigFilePath();
    if (!fs.existsSync(filePath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<AgentConfig>;
  } catch {
    return {};
  }
}

function persistConfig(config: AgentConfig): AgentConfig {
  const filePath = getConfigFilePath();
  ensureDirectoryExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

function trimString(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim();
}

function normalizeConfiguredPairs(value: unknown): AgentConfiguredPair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const entry = item as Partial<AgentConfiguredPair>;
      return {
        pairKey: trimString(entry.pairKey),
        displayName: trimString(entry.displayName),
        videoDeviceId: trimString(entry.videoDeviceId),
        audioDeviceId: trimString(entry.audioDeviceId),
      };
    })
    .filter((item) => item.pairKey && item.videoDeviceId && item.audioDeviceId)
    .reduce<AgentConfiguredPair[]>((acc, item) => {
      if (acc.some((existing) => existing.pairKey === item.pairKey)) {
        return acc;
      }
      acc.push(item);
      return acc;
    }, []);
}

function buildConfig(payload?: Partial<AgentConfig>): AgentConfig {
  const previous = safeReadConfigFile();
  const source = {
    ...defaultConfig,
    ...previous,
    ...payload,
  } as AgentConfig;

  return {
    backendUrl: trimString(source.backendUrl, defaultConfig.backendUrl),
    cabinetCode: trimString(source.cabinetCode).toUpperCase(),
    wsPath: trimString(source.wsPath, defaultConfig.wsPath) || defaultConfig.wsPath,
    heartbeatSeconds: Math.max(5, Number(source.heartbeatSeconds || defaultConfig.heartbeatSeconds || 15)),
    agentKey: trimString(source.agentKey),
    agentToken: trimString(source.agentToken),
    agentId: trimString(source.agentId),
    agentName: trimString(source.agentName, defaultConfig.agentName),
    transportKey: trimString((source as AgentConfig).transportKey, defaultConfig.transportKey) || defaultConfig.transportKey,
    activePairKey: trimString(source.activePairKey),
    configuredPairs: normalizeConfiguredPairs(source.configuredPairs),
  };
}

export function getConfig(): AgentConfig {
  return persistConfig(buildConfig());
}

export function saveConfig(payload: Partial<AgentConfig>): AgentConfig {
  return persistConfig(buildConfig(payload));
}
