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
  /** Set to 'true' once the versions repo has been cloned AND the first full pull
   *  has completed. Gates the first-run initialization flow so it retries on the
   *  next launch if the user quits mid-setup. */
  initialSetupComplete: string;
  /** Optional custom Modrinth App data folder (parent of profiles/), for portable
   *  or non-default installs the fixed %APPDATA%/ModrinthApp scan won't find. */
  modrinthPath: string;
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
    initialSetupComplete: '',
    modrinthPath: '',
  },
});
