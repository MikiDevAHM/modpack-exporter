// Post-make hook for electron-forge's MakerZIP output.
//
// MakerZIP zips the packaged app directory as-is, which means every file ends
// up nested inside a wrapper folder named after the packaged dir (e.g.
// "orb-modpack-exporter-win32-x64/"). This script re-packages that zip so the
// .exe and all supporting files sit at the root of the archive instead, and
// renames the archive to a fixed, platform-agnostic name.
//
// Usage (invoked by forge.config.ts as a child process):
//   node post-make-hook.js <zipPath> [outputDir]

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const FINAL_ZIP_NAME = 'ORB Modpack Exporter.zip';

/** True once `dir` looks like the real app root (has an .exe or a resources/ folder). */
function looksLikeAppRoot(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hasExe = entries.some(e => e.isFile() && e.name.toLowerCase().endsWith('.exe'));
  const hasResources = entries.some(e => e.isDirectory() && e.name === 'resources');
  return hasExe || hasResources;
}

/**
 * Restructures a MakerZIP output so every file sits at the root of the archive,
 * and writes it out as FINAL_ZIP_NAME next to the original. Deletes the original
 * platform-specific zip once the new one is written.
 */
function restructureZip(zipPath, outputDir) {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`post-make-hook: zip not found at ${zipPath}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const tempDir = path.join(outputDir, `.restructure-tmp-${path.basename(zipPath, '.zip')}`);
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // 1. Extract the generated zip into a scratch folder. Done by hand (rather
    //    than AdmZip's extractAllTo) so every parent directory is created before
    //    its file is written, and no chmod call is ever made on Windows.
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      const entryPath = path.join(tempDir, entry.entryName);
      if (entry.isDirectory) {
        fs.mkdirSync(entryPath, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(entryPath), { recursive: true });
      fs.writeFileSync(entryPath, entry.getData());
    }

    // 2 & 3. If everything lives inside a single wrapping subfolder (e.g.
    //    "orb-modpack-exporter-win32-x64/"), descend into it and promote its
    //    contents up to tempDir's root. Repeats in case of multiple levels of
    //    single-folder wrapping; stops as soon as the .exe/resources/ are found,
    //    or as soon as the folder no longer contains exactly one item.
    let contentRoot = tempDir;
    while (!looksLikeAppRoot(contentRoot)) {
      const entries = fs.readdirSync(contentRoot, { withFileTypes: true });
      if (entries.length !== 1 || !entries[0].isDirectory()) break;
      contentRoot = path.join(contentRoot, entries[0].name);
    }

    // 4. Move everything from contentRoot up to tempDir's root (the .exe, DLLs,
    //    and resources/ all travel with it since they're siblings inside
    //    contentRoot). No-op if contentRoot is already tempDir.
    if (contentRoot !== tempDir) {
      for (const entry of fs.readdirSync(contentRoot, { withFileTypes: true })) {
        fs.renameSync(path.join(contentRoot, entry.name), path.join(tempDir, entry.name));
      }
      // Remove the now-empty wrapper folder chain back up to (but not including) tempDir.
      let wrapper = contentRoot;
      while (wrapper !== tempDir) {
        const parent = path.dirname(wrapper);
        try { fs.rmdirSync(wrapper); } catch { /* not empty / already gone — ignore */ }
        wrapper = parent;
      }
    }

    if (!looksLikeAppRoot(tempDir)) {
      console.warn(`[post-make-hook] warning: no .exe or resources/ found at the flattened root of ${zipPath} — the restructured zip may be incomplete.`);
    }

    // 5. Build the final, platform-agnostic zip with everything at its root.
    const finalZipPath = path.join(outputDir, FINAL_ZIP_NAME);
    if (fs.existsSync(finalZipPath)) {
      fs.rmSync(finalZipPath, { force: true });
    }
    const outZip = new AdmZip();
    outZip.addLocalFolder(tempDir);
    outZip.writeZip(finalZipPath);

    // 6. Delete the original platform-specific zip.
    fs.rmSync(zipPath, { force: true });

    console.log(`[post-make-hook] restructured "${path.basename(zipPath)}" -> "${FINAL_ZIP_NAME}"`);
  } finally {
    // 7. Clean up the temp extraction folder.
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Allow running as a standalone script: `node post-make-hook.js <zipPath> [outputDir]`
if (require.main === module) {
  const [, , zipPathArg, outputDirArg] = process.argv;
  if (!zipPathArg) {
    console.error('Usage: node post-make-hook.js <zipPath> [outputDir]');
    process.exit(1);
  }
  const resolvedZipPath = path.resolve(zipPathArg);
  const resolvedOutputDir = outputDirArg ? path.resolve(outputDirArg) : path.dirname(resolvedZipPath);
  restructureZip(resolvedZipPath, resolvedOutputDir);
}

module.exports = restructureZip;
