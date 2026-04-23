declare module 'ws' {
  class WebSocket {
    static readonly OPEN: number;
    readyState: number;
    bufferedAmount?: number;
    constructor(url: string, options?: Record<string, unknown>);
    on(event: string, listener: (...args: any[]) => void): void;
    close(code?: number, reason?: string): void;
    send(data: string | Buffer | Uint8Array | ArrayBuffer): void;
    removeAllListeners(): void;
  }

  namespace WebSocket {
    type RawData = string | Buffer | Uint8Array | ArrayBuffer | Buffer[];
  }

  export default WebSocket;
}
