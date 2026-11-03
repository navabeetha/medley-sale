export interface Finding { file: string; line: number; rule: string }
export function scanText(file: string, text: string): Finding[];
export function scanPaths(paths: string[]): Finding[];
