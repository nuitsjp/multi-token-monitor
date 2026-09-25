import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig(({ command, mode }) => {
  const mock = mode === 'mock';
  const mockFile = local('./src/mocks/notes.ts');
  const apiTarget = process.env.AIDD_API_URL ?? 'http://127.0.0.1:3000';
  if (command === 'build' && mock) throw new Error('配布ビルドでモックは使用できません。');
  if (mock && !existsSync(mockFile))
    throw new Error(
      '対象系列のモックを src/mocks/notes.ts に作成してください。実処理への自動フォールバックはしません。',
    );
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
    define: { __MOCK__: JSON.stringify(mock) },
    resolve: {
      alias: {
        '@contracts': local('../contracts'),
        '@notes-access': mock ? mockFile : local('./src/features/notes/access.ts'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, ws: true },
        '/events': { target: apiTarget, changeOrigin: true, ws: true },
        '/health': { target: apiTarget, changeOrigin: true, ws: true },
      },
    },
    build: { outDir: 'dist', target: 'es2022', sourcemap: false, emptyOutDir: true },
  };
});
