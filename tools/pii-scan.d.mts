export interface Finding { file: string; line: number; rule: string }
export function loadBlockedWords(envValue: string | undefined, fileText: string | undefined): string[];
export function scanText(file: string, text: string, blocked?: string[]): Finding[];
export function scanPaths(paths: string[]): Finding[];
export function blockedWordsRequired(argv: string[], env: Record<string, string | undefined>): boolean;
export function blockedWordsProblem(blocked: string[], required: boolean): { fail: boolean; message: string } | null;
export interface CommitInfo {
  sha: string; authorName: string; authorEmail: string; committerName: string; committerEmail: string; message: string;
}
export const GIT_LOG_FORMAT: string;
export function parseLog(text: string): CommitInfo[];
export function scanCommits(commits: CommitInfo[], blocked?: string[]): Finding[];
export function scanPatchLog(text: string, blocked?: string[]): Finding[];
export function scanRevisions(revArgs: string[], blocked?: string[], cwd?: string): Finding[];
export function applyHistoryAllowlist(findings: Finding[], text: string): Finding[];
