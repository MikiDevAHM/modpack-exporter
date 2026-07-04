import type { ForgeConfig, ForgeMakeResult } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { execFileSync } from 'child_process';
import path from 'path';

// electron-forge's MakerZIP output nests everything inside a wrapper folder
// (e.g. "orb-modpack-exporter-win32-x64/"). post-make-hook.js re-packages the
// zip so the .exe and all supporting files sit at the archive root, and
// renames it to a fixed, platform-agnostic name. Run as a separate script
// (rather than required in-process) so a crash there can't take down the
// rest of the forge make/publish pipeline.
const POST_MAKE_HOOK_SCRIPT = path.join(__dirname, 'post-make-hook.js');
const FINAL_ZIP_NAME = 'ORB Modpack Exporter.zip';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ['core.py', 'export_runner.py', 'sync_mods.py', 'config.yaml', 'portable-git'],
    executableName: 'orb-modpack-exporter',
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'OR-Beyond',
        name: 'modpack-exporter',
      },
      prerelease: false,
      draft: false,
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
  hooks: {
    postMake: async (_forgeConfig, makeResults: ForgeMakeResult[]) => {
      for (const result of makeResults) {
        result.artifacts = result.artifacts.map(artifactPath => {
          if (!artifactPath.toLowerCase().endsWith('.zip')) return artifactPath;

          const outputDir = path.dirname(artifactPath);

          // Pass the zip path and output directory to the script as CLI args.
          execFileSync(process.execPath, [POST_MAKE_HOOK_SCRIPT, artifactPath, outputDir], {
            stdio: 'inherit',
          });

          // post-make-hook.js always writes the restructured archive as
          // FINAL_ZIP_NAME next to the original and deletes the original zip.
          return path.join(outputDir, FINAL_ZIP_NAME);
        });
      }

      return makeResults;
    },
  },
};

export default config;
