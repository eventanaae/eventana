import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      output: {
        // Split a stable vendor chunk so React doesn't re-download every deploy,
        // and isolate the large bilingual i18n dictionary into its own cached
        // chunk. Function form matches by module id (robust across Rollup
        // versions) instead of the fragile relative-path array form.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]src[\\/]i18n\./.test(id)) return 'i18n';
          return undefined;
        },
      },
    },
  },
});
