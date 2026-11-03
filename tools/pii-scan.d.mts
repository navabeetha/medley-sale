export interface Finding { file: string; line: number; rule: string }
export function loadBlockedWords(envValue: string | undefined, fileText: string | undefined): string[];
export function scanText(file: string, text: string, blocked?: string[]): Finding[];
export function scanPaths(paths: string[]): Finding[];
