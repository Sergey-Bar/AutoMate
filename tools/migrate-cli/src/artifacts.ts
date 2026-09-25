import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ArtifactInventoryEntry {
  logicalPath: string;
  byteSize: number;
  digest: string;
}

export async function inventoryArtifacts(root: string, logicalRoot = root): Promise<ArtifactInventoryEntry[]> {
  const output: ArtifactInventoryEntry[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const bytes = await readFile(fullPath);
        output.push({
          logicalPath: path.relative(logicalRoot, fullPath).replaceAll('\\', '/'),
          byteSize: (await stat(fullPath)).size,
          digest: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  }
  await walk(root);
  return output.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
}
