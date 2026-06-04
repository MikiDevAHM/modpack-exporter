import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// root MUST point to the directory containing index.html
// Without this, Vite looks in the project root and fails to find index.html
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src/renderer') },
  },
});
