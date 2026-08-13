import path from 'path';
import fs from 'fs';

export type ProfileMode = 'dev' | 'prod';

export function getProfileMode(userDataPath: string): ProfileMode {
  try {
    const modeFile = path.join(userDataPath, 'profile-mode.json');
    const raw = fs.readFileSync(modeFile, 'utf-8').trim();
    if (raw === 'prod') return 'prod';
    return 'dev';
  } catch {
    return 'dev';
  }
}

export function setProfileMode(userDataPath: string, mode: ProfileMode): void {
  fs.writeFileSync(path.join(userDataPath, 'profile-mode.json'), mode, 'utf-8');
}

export function productionWorkspacePath(userDataPath: string): string {
  return path.join(userDataPath, 'production');
}

export function promoteToProduction(
  userDataPath: string,
  sourceProfile: string,
): { success: boolean; copiedMods: number; copiedFiles: number; error?: string } {
  const target = productionWorkspacePath(userDataPath);
  fs.mkdirSync(target, { recursive: true });

  let copiedMods = 0;
  let copiedFiles = 0;

  const copyDir = (src: string, dst: string) => {
    if (!fs.existsSync(src)) return;
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        copyDir(s, d);
      } else if (entry.isFile()) {
        fs.copyFileSync(s, d);
        if (entry.name.endsWith('.jar')) copiedMods++;
        else copiedFiles++;
      }
    }
  };

  copyDir(sourceProfile, target);
  return { success: true, copiedMods, copiedFiles };
}
