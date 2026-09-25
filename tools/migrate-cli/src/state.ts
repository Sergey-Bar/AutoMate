import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface MigrationCheckpoint {
  planFingerprint: string;
  completedWaves: string[];
  rowDigests: Record<string, string>;
  artifactTransfers: Record<string, string>;
  vaultTransfers: Record<string, string>;
}

export class MigrationStateStore {
  constructor(private readonly filePath: string) {}

  read(): MigrationCheckpoint {
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as MigrationCheckpoint;
    } catch {
      return { planFingerprint: '', completedWaves: [], rowDigests: {}, artifactTransfers: {}, vaultTransfers: {} };
    }
  }

  write(checkpoint: MigrationCheckpoint): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}
