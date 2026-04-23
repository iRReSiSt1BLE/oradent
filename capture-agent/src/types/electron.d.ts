declare module 'electron' {
  export const app: {
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): void;
    quit(): void;
    getPath(name: string): string;
    getAppPath(): string;
  };

  export class BrowserWindow {
    constructor(options?: Record<string, unknown>);
    static getAllWindows(): BrowserWindow[];
    isDestroyed(): boolean;
    loadFile(filePath: string): Promise<void>;
    webContents: {
      send(channel: string, payload: unknown): void;
    };
  }


  export const clipboard: {
    writeText(text: string): void;
  };

  export const ipcMain: {
    handle(channel: string, listener: (...args: any[]) => any): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on(channel: string, listener: (...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
  };

  export const session: {
    defaultSession: {
      setPermissionCheckHandler(handler: (...args: any[]) => boolean): void;
      setPermissionRequestHandler(handler: (...args: any[]) => void): void;
    };
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: unknown): void;
  };
}

declare namespace Electron {
  type IpcRendererEvent = unknown;
}
