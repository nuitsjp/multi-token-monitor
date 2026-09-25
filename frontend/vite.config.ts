import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig(() => {
  const apiTarget = process.env.AIDD_API_URL ?? 'http://127.0.0.1:3000';
  return {
    root: local('.'),
    plugins: [
      tanstackRouter({
        target: 'react',
        routesDirectory: local('./src/routes'),
        generatedRouteTree: local('./src/routeTree.gen.ts'),
        autoCodeSplitting: false,
        enableRouteGeneration: process.env.E2E_MODE !== 'dev',
      }),
      react(),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
    build: { outDir: 'dist', target: 'es2022', sourcemap: false, emptyOutDir: true },
  };
});
