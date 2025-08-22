declare module 'electron-updater' {
  export interface UpdateInfo { version: string; releaseNotes?: string | any; }
  export interface ProgressInfo { percent?: number; transferred?: number; total?: number; bytesPerSecond?: number; }
  export const autoUpdater: {
    autoDownload: boolean;
    checkForUpdates(): Promise<{ updateInfo: UpdateInfo } | null>;
    downloadUpdate(): Promise<void>;
    quitAndInstall(): void;
    on(event: 'error', cb: (err: Error) => void): void;
    on(event: 'update-available', cb: (info: UpdateInfo) => void): void;
    on(event: 'update-not-available', cb: (info: UpdateInfo) => void): void;
    on(event: 'download-progress', cb: (p: ProgressInfo) => void): void;
    on(event: 'update-downloaded', cb: (info: UpdateInfo) => void): void;
  };
}