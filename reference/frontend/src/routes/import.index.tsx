import { createFileRoute } from '@tanstack/react-router';
import { ImportInput } from '../usecases/import-notes/ImportInput.tsx';
export const Route = createFileRoute('/import/')({ component: ImportInput });
