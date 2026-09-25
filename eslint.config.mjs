import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default tseslint.config({ ignores: ['dist/**', 'frontend/dist/**', 'frontend/src/routeTree.gen.ts', 'node_modules/**', '.e2e-results/**', 'playwright-report/**', 'release/**'] }, js.configs.recommended, ...tseslint.configs.recommended, { languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } }, { files: ['frontend/src/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks }, rules: { ...reactHooks.configs.recommended.rules } });
