import { app, Menu, nativeImage, Tray } from 'electron';
import type { SyncStatus } from '../shared/domain';

export class StatusTray {
  private readonly tray: Tray;
  private status: SyncStatus = { state: 'needs_setup', lastRun: null, activeJobs: 0 };

  constructor(
    private readonly showWindow: () => void,
    private readonly startSync: () => void,
  ) {
    this.tray = new Tray(nativeImage.createEmpty());
    this.tray.setToolTip('TBM UniCloudConnect');
    this.tray.on('click', showWindow);
    this.render();
  }

  setStatus(status: SyncStatus): void {
    this.status = status;
    this.render();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private render(): void {
    const labels = {
      idle: 'UC',
      syncing: 'UC ↻',
      transcribing: 'UC T',
      error: 'UC !',
      needs_setup: 'UC •',
    } as const;
    this.tray.setTitle(labels[this.status.state]);
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'UniCloudConnect öffnen', click: this.showWindow },
      {
        label: this.status.state === 'syncing' ? 'Synchronisierung läuft …' : 'Jetzt synchronisieren',
        enabled: this.status.state !== 'syncing' && this.status.state !== 'transcribing'
          && this.status.state !== 'needs_setup',
        click: this.startSync,
      },
      { type: 'separator' },
      { label: 'Beenden', click: () => app.quit() },
    ]));
  }
}
