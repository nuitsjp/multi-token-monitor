import { Container, Text, Title } from '@mantine/core';

export function NotImplemented({ title }: { title: string }) {
  return (
    <Container component="main" size="xl" py="xl">
      <Title order={1} size="h2" fw={600} mb="md">
        {title}
      </Title>
      <Text className="muted">This page is not implemented yet.</Text>
    </Container>
  );
}
