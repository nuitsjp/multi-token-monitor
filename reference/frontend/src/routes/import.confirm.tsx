import { createFileRoute } from '@tanstack/react-router';
import { ImportConfirm } from '../usecases/import-notes/ImportConfirm.tsx';
export const Route = createFileRoute('/import/confirm')({ component: ImportConfirm });
