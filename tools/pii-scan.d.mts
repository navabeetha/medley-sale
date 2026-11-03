export interface Finding { file: string; line: number; rule: string }
export function loadBlockedWords(envValue: string | undefined, fileText: string | undefined): string[];
export function scanText(file: string, text: string, blocked?: string[]): Finding[];
export function scanPaths(paths: string[]): Finding[];
export function blockedWordsRequired(argv: string[], env: Record<string, string | undefined>): boolean;
export function blockedWordsProblem(blocked: string[], required: boolean): { fail: boolean; message: string } | null;
