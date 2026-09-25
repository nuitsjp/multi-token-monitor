import { createFileRoute } from '@tanstack/react-router';
import { ImportDialogue } from '../usecases/import-notes/ImportDialogue.tsx';
export const Route = createFileRoute('/import')({ component: ImportDialogue });
