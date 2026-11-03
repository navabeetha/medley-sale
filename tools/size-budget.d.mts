export const BUDGETS: { codeGzip: number; thumb: number; photo: number };
export function checkBudgets(dir: string): { ok: boolean; codeGzipBytes: number; problems: string[] };
