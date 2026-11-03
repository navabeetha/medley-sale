export interface PushLine { localRef: string; localSha: string; remoteRef: string; remoteSha: string }
export function parsePushLines(text: string): PushLine[];
export function refusedRefs(lines: PushLine[]): { ref: string; reason: string }[];
export function revListArgs(line: PushLine): string[] | null;
