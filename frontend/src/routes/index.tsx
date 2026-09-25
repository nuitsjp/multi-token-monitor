import { createFileRoute } from '@tanstack/react-router';
import { Container, Title } from '@mantine/core';
export const Route = createFileRoute('/')({ component: Home });
export function Home() {
  return (
    <Container component="main" py="xl">
      <Title order={1}>Token Monitor Analytics</Title>
    </Container>
  );
}
