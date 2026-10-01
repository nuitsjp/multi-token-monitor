import { render, screen } from '@testing-library/react';
import { it, expect } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { Home } from '../../../frontend/src/routes/index.tsx';

it('トップページにHomeの見出しを表示する', () => {
  // Arrange
  const name = 'Home';

  // Act
  render(
    <MantineProvider>
      <Home />
    </MantineProvider>,
  );

  // Assert
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(name);
});
