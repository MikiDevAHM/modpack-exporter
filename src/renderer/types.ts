export interface AppConfig {
  pack_name: string;
  version: string;
  minecraft_version: string;
  fabric_loader_version: string;
  lite_pack_name: string;
  lite_version: string;
  github_repo: string;
  github_branch: string;
  modrinth_id: string;
  modrinth_url: string;
  lite_modrinth_id: string;
  lite_modrinth_url: string;
  include_folders: string[];
  include_files: string[];
  [key: string]: unknown;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface ModChange {
  type: 'added' | 'removed' | 'updated';
  name: string;
}

export interface CommitCard {
  sha: string;
  message: string;
  author: { login: string; avatar_url: string; html_url: string };
  date: string;
  url: string;
  modChanges: ModChange[];
  configChanged: boolean;
  files: string[];
  detailsLoaded: boolean;
}

export interface IssueLabel {
  name: string;
  color: string; // hex without leading #
}

export interface Issue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  user: { login: string; avatar_url: string };
  labels: IssueLabel[];
}

export interface ModrinthProfile {
  name: string;
  path: string;
  launcherPath: string;
}

export interface ModpackInfo {
  config: AppConfig | null;
  exportState: { version: string; timestamp: string } | null;
}

export interface SyncStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  lastPull: string | null;
}

export interface ExportOptions {
  version: string;
  isLite: boolean;
  isRelease: boolean;
  packName: string;
  exportDir?: string;
}

export interface ExportResult {
  success: boolean;
  output_path?: string;
  mc_version?: string;
  loader_version?: string;
  stats?: { total: number; resolved: number; embedded: number };
  changes?: { added: string[]; removed: string[]; updated: string[] };
  error?: string;
}

export interface DeviceCodeInfo {
  user_code: string;
  verification_uri: string;
  expires_in: number;
}

export interface AuthStartResult {
  success: boolean;
  token?: string;
  user?: GitHubUser | null;
  error?: string;
}

export interface AuthCheckResult {
  success: boolean;
  authenticated: boolean;
  user?: GitHubUser;
  error?: string;
}

declare global {
  interface Window {
    electron: {
      platform: string;
      auth: {
        start: () => Promise<AuthStartResult>;
        logout: () => Promise<{ success: boolean; error?: string }>;
        check: () => Promise<AuthCheckResult>;
        onDeviceCode: (handler: (info: DeviceCodeInfo) => void) => void;
        offDeviceCode: () => void;
      };
      settings: {
        get: (key: string) => Promise<string | null>;
        set: (key: string, val: string) => Promise<void>;
        getAll: () => Promise<Record<string, string>>;
      };
      config: {
        read: () => Promise<{ success: boolean; data?: AppConfig; error?: string }>;
        write: (data: unknown) => Promise<{ success: boolean; error?: string }>;
        readExportState: () => Promise<{ success: boolean; data?: { version: string; timestamp: string } | null }>;
      };
      github: {
        getUser: () => Promise<{ success: boolean; data?: GitHubUser; error?: string }>;
        getCommits: (o: { owner: string; repo: string; branch: string }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
        getCommitFiles: (o: { owner: string; repo: string; sha: string }) => Promise<{ success: boolean; data?: { files: string[]; modChanges: ModChange[]; configChanged: boolean }; error?: string }>;
        getIssues: (o: { owner: string; repo: string }) => Promise<{ success: boolean; data?: Issue[]; error?: string }>;
      };
      git: {
        pull: () => Promise<{ success: boolean; output?: string; error?: string }>;
        push: (o: { message: string }) => Promise<{ success: boolean; output?: string; error?: string }>;
        status: () => Promise<{ success: boolean; data?: SyncStatus; error?: string }>;
        stagedFiles: () => Promise<{ success: boolean; data?: string[] }>;
      };
      python: { syncMods: () => Promise<{ success: boolean; data?: any; error?: string }> };
      export: { run: (o: ExportOptions) => Promise<ExportResult> };
      modpack: {
        info: () => Promise<{ success: boolean; data?: ModpackInfo; error?: string }>;
        detectRoot: () => Promise<{ success: boolean; path: string | null }>;
        deepScan: () => Promise<{ success: boolean; path: string | null; driveRoot: string | null; error?: string }>;
        abortScan: () => Promise<{ success: boolean }>;
        listProfiles: () => Promise<{ success: boolean; data: ModrinthProfile[]; error?: string }>;
        setRootFromProfile: (path: string) => Promise<{ success: boolean }>;
        setRoot: (p: string) => Promise<{ success: boolean }>;
        getRoot: () => Promise<{ success: boolean; path: string | null }>;
        onRootFound: (handler: (data: { path: string }) => void) => void;
        offRootFound: () => void;
        onScanProgress: (handler: (data: { message: string }) => void) => void;
        offScanProgress: () => void;
      };
      app: {
        openExternal: (url: string) => Promise<void>;
        selectDirectory: () => Promise<string | null>;
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
    };
  }
}
