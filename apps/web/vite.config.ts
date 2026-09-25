import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy all /api/* requests to the unified API server (apps/api on port 3456).
    // This allows the web app to call canonical /api/v1/* routes without CORS issues.
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
      },
    },
  },
});
