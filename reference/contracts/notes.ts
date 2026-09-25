// 型の正本はC#。mise run contractsで生成したOpenAPI型への別名だけを定義する。
import type { components, paths } from './api.gen.ts';
export type Principal = components['schemas']['Principal'];
export type Note = components['schemas']['Note'];
export type SaveNoteRequest =
  paths['/api/notes/save']['post']['requestBody']['content']['application/json'];
export type SaveNoteResponse =
  paths['/api/notes/save']['post']['responses'][200]['content']['application/json'];
export type BulkInput = components['schemas']['BulkInput'];
export type BulkPreview = components['schemas']['BulkPreview'];
export type BulkResult = components['schemas']['BulkResult'];
export type Session = components['schemas']['SessionOutput'];
export type SignInOutput = components['schemas']['SignInOutput'];
export type SuccessOutput = components['schemas']['SuccessOutput'];
export type RemoveNote = components['schemas']['RemoveNoteInput'];
export type SignInInput = components['schemas']['DemoSignInInput'];
export type ApiProblem = components['schemas']['ProblemDetails'];
export type ValidationProblem = components['schemas']['HttpValidationProblemDetails'];
