import {
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import WebSocket, { Server } from 'ws';
import { CaptureAgentService } from './capture-agent.service';

@WebSocketGateway({
    path: '/capture-agent/ws',
})
export class CaptureAgentGateway
    implements OnGatewayConnection, OnGatewayDisconnect
{
    private readonly logger = new Logger(CaptureAgentGateway.name);
    private readonly clientAgentMap = new WeakMap<WebSocket, string>();

    constructor(private readonly captureAgentService: CaptureAgentService) {}

    private send(client: WebSocket, payload: Record<string, unknown>) {
        if (client.readyState !== WebSocket.OPEN) {
            return;
        }

        client.send(JSON.stringify(payload));
    }

    private parseIp(request?: IncomingMessage): string | null {
        const forwardedForHeader = request?.headers['x-forwarded-for'];
        if (typeof forwardedForHeader === 'string') {
            return forwardedForHeader.split(',')[0]?.trim() || null;
        }

        if (Array.isArray(forwardedForHeader)) {
            return forwardedForHeader[0]?.trim() || null;
        }

        return request?.socket?.remoteAddress || null;
    }

    private async processMessage(client: WebSocket, raw: WebSocket.RawData) {
        const agentId = this.clientAgentMap.get(client);
        if (!agentId) {
            this.send(client, {
                type: 'agent.error',
                payload: { message: 'Агента не ідентифіковано' },
            });
            client.close(1008, 'Unknown agent');
            return;
        }

        try {
            const parsed = JSON.parse(raw.toString()) as {
                type?: string;
                payload?: Record<string, unknown>;
            };

            const messageType = parsed.type || '';

            if (messageType === 'agent.hello') {
                await this.captureAgentService.processHello(agentId, {
                    agentName:
                        typeof parsed.payload?.agentName === 'string'
                            ? parsed.payload.agentName
                            : undefined,
                    cabinetId:
                        typeof parsed.payload?.cabinetId === 'string'
                            ? parsed.payload.cabinetId
                            : undefined,
                    appVersion:
                        typeof parsed.payload?.appVersion === 'string'
                            ? parsed.payload.appVersion
                            : undefined,
                    devices: Array.isArray(parsed.payload?.devices)
                        ? (parsed.payload?.devices as Array<{
                              kind?: string;
                              deviceId?: string;
                              label?: string | null;
                          }>)
                        : undefined,
                });

                this.send(client, {
                    type: 'agent.ready',
                    payload: {
                        message: 'Агента успішно синхронізовано з backend',
                    },
                });
                return;
            }

            if (messageType === 'agent.heartbeat') {
                await this.captureAgentService.touchHeartbeat(agentId);
                this.send(client, {
                    type: 'agent.heartbeat.ack',
                    payload: {
                        serverTime: new Date().toISOString(),
                    },
                });
                return;
            }

            if (messageType === 'agent.devices.sync') {
                await this.captureAgentService.syncDevices(
                    agentId,
                    Array.isArray(parsed.payload?.devices)
                        ? (parsed.payload.devices as Array<{
                              kind?: string;
                              deviceId?: string;
                              label?: string | null;
                          }>)
                        : [],
                );
                this.send(client, {
                    type: 'agent.devices.synced',
                    payload: {
                        message: 'Список пристроїв синхронізовано',
                    },
                });
                return;
            }

            this.send(client, {
                type: 'agent.unhandled',
                payload: {
                    message: `Команда ${messageType || 'unknown'} ще не обробляється backend-ом`,
                },
            });
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown websocket error';
            if (agentId) {
                await this.captureAgentService.markError(agentId, errorMessage);
            }
            this.send(client, {
                type: 'agent.error',
                payload: {
                    message: errorMessage,
                },
            });
        }
    }

    async handleConnection(client: WebSocket, ...args: unknown[]) {
        const request = args[0] as IncomingMessage | undefined;

        try {
            const rawAgentToken = request?.headers['x-agent-token'];
            const agentToken = Array.isArray(rawAgentToken)
                ? rawAgentToken[0]
                : rawAgentToken;

            const agent = await this.captureAgentService.validateAgentToken(agentToken);
            this.clientAgentMap.set(client, agent.id);
            await this.captureAgentService.markConnected(agent.id, this.parseIp(request));

            this.logger.log(
                `Capture agent connected: ${agent.name} (${agent.id})`,
            );

            this.send(client, {
                type: 'server.connected',
                payload: {
                    agentId: agent.id,
                    message: 'Backend websocket зʼєднання встановлено',
                },
            });

            client.on('message', (raw) => {
                void this.processMessage(client, raw);
            });
        } catch (error) {
            const errorMessage =
                error instanceof UnauthorizedException
                    ? error.message
                    : error instanceof Error
                      ? error.message
                      : 'Unauthorized capture agent';
            this.logger.warn(`Capture agent rejected: ${errorMessage}`);
            client.close(1008, errorMessage);
        }
    }

    async handleDisconnect(client: WebSocket) {
        const agentId = this.clientAgentMap.get(client);
        if (!agentId) {
            return;
        }

        await this.captureAgentService.markDisconnected(agentId);
        this.logger.log(`Capture agent disconnected: ${agentId}`);
    }
}
