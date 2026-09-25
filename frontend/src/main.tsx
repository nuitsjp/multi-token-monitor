import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, MantineProvider } from '@mantine/core';
import { RouterProvider } from '@tanstack/react-router';
import '@mantine/core/styles.css';
import './style.css';
import { router } from './app/router.ts';
const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'md',
  fontFamily: 'Inter, "Yu Gothic UI", Meiryo, sans-serif',
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
