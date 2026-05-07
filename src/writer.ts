import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExportResult } from './types.js';

export async function writeExport(result: ExportResult, outputDir = 'exports'): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const date = result.exportedAt.slice(0, 10);
  const filename = `twitter-${result.kind}-${date}.json`;
  const outputPath = resolve(outputDir, filename);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return outputPath;
}
