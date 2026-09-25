import { render, screen } from '@testing-library/react';
import { it, expect } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { HttpError } from '../../../frontend/src/shared/errors.ts';
import { ErrorNotice } from '../../../frontend/src/shared/ErrorNotice.tsx';

it('入力エラーを操作の文脈で表示する', () => {
  // Arrange
  const error = new HttpError(400, {
    status: 400,
    errors: { title: ['タイトルを入力してください。'] },
  });

  // Act
  render(
    <MantineProvider>
      <ErrorNotice error={error} />
    </MantineProvider>,
  );

  // Assert
  expect(screen.getByRole('alert')).toHaveTextContent('タイトルを入力してください。');
});

it('入力欄で表示する項目のエラーだけなら表示しない', () => {
  // Arrange
  const error = new HttpError(400, {
    status: 400,
    errors: { Title: ['タイトルを入力してください。'] },
  });

  // Act
  render(
    <MantineProvider>
      <ErrorNotice error={error} fields={['Title']} />
    </MantineProvider>,
  );

  // Assert
  expect(screen.queryByRole('alert')).toBeNull();
});
