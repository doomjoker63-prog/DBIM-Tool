import fs from 'node:fs';

/** Write JSON so that a crash or Ctrl+C never leaves a half-written file behind. */
export function writeJsonAtomic(file: string, data: unknown, indent?: number): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, indent));
  fs.renameSync(tmp, file);
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
