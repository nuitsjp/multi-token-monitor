import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, MantineProvider } from '@mantine/core';
import { RouterProvider } from '@tanstack/react-router';
import '@mantine/core/styles.css';
import './style.css';
import { router } from './app/router.ts';
const theme = createTheme({
  primaryColor: 'violet',
  defaultRadius: 'lg',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "Yu Gothic UI", sans-serif',
  headings: { fontFamily: 'system-ui, -apple-system, "Segoe UI", "Yu Gothic UI", sans-serif' },
  // ダーク基調。7がページ背景、6がカードの面。
  colors: {
    dark: [
      '#e4e5e9',
      '#b4b6bf',
      '#8b8e99',
      '#5d6070',
      '#3a3d48',
      '#2c2e36',
      '#1f2126',
      '#16171b',
      '#111215',
      '#0b0c0e',
    ],
  },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
