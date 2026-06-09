import Store from 'electron-store';

export interface StoreSchema {
  githubToken: string;
  modpackRoot: string;
  exportDir: string;
  lastPullTime: string;
  lastExportTime: string;
  lastScanDriveRoot: string;
  discordWebhook: string;
  modrinthProjectId: string;
}

export const store = new Store<StoreSchema>({
  defaults: {
    githubToken: '',
    modpackRoot: '',
    exportDir: '',
    lastPullTime: '',
    lastExportTime: '',
    lastScanDriveRoot: '',
    discordWebhook: '',
    modrinthProjectId: 'O5wGsyGR',
  },
});
