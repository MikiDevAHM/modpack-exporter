import { defineConfig } from 'vite';
import { builtinModules } from 'module';

export default defineConfig({
  resolve: { conditions: ['node'] },
  build: {
    rollupOptions: {
      external: [
        'electron',
        'electron-store',
        'electron-squirrel-startup',
        'js-yaml',
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
      ],
    },
  },
});
