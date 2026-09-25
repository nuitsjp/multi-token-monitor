/// <reference types="vite/client" />
declare const __MOCK__: boolean;
declare module '@notes-access' {
  export const listNotes: typeof import('./features/notes/access.ts').listNotes;
  export const saveNote: typeof import('./features/notes/access.ts').saveNote;
  export const removeNote: typeof import('./features/notes/access.ts').removeNote;
  export const previewMany: typeof import('./features/notes/access.ts').previewMany;
  export const importMany: typeof import('./features/notes/access.ts').importMany;
  export const watchNotes: typeof import('./features/notes/access.ts').watchNotes;
}
