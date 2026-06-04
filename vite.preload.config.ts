import { defineConfig } from 'vite';
import { builtinModules } from 'module';

export default defineConfig({
  resolve: { conditions: ['node'] },
  build: {
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
      ],
    },
  },
});
