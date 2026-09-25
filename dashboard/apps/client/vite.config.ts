import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';

export default defineConfig({
  plugins: [
    TanStackRouterVite({ routeFileIgnorePattern: '.*__tests__.*' }),
    react(),
    // Upload source maps to Sentry in CI (only when SENTRY_AUTH_TOKEN is present)
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        })]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/artifacts': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React libraries
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor';
          }
          // TanStack ecosystem
          if (id.includes('@tanstack/react-router') || id.includes('@tanstack/react-query') || 
              id.includes('@tanstack/react-table') || id.includes('@tanstack/react-virtual')) {
            return 'tanstack';
          }
          // Animation library
          if (id.includes('framer-motion')) {
            return 'motion';
          }
          // Charting libraries
          if (id.includes('recharts')) {
            return 'charts';
          }
          if (id.includes('@nivo/')) {
            return 'heatmap';
          }
          // Terminal libraries
          if (id.includes('@xterm/')) {
            return 'terminal';
          }
          // Tree component
          if (id.includes('react-arborist')) {
            return 'tree';
          }
          // Internationalization
          if (id.includes('react-i18next') || id.includes('i18next')) {
            return 'i18n';
          }
          // Command palette
          if (id.includes('cmdk')) {
            return 'cmdk';
          }
          // Syntax highlighting
          if (id.includes('shiki')) {
            return 'shiki';
          }
          // Icons library
          if (id.includes('lucide-react')) {
            return 'icons';
          }
          // Sentry
          if (id.includes('@sentry/')) {
            return 'sentry';
          }
          // Other large UI libraries
          if (id.includes('react-compare-slider')) {
            return 'compare-slider';
          }
        },
      },
    },
  },
});
