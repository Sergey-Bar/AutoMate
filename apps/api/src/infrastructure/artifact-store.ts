import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredArtifact {
  id: string;
  key: string;
  contentType: string;
  byteSize: number;
  digest: string;
  retention: 'standard' | 'quarantine' | 'legal_hold';
}

function resolveArtifactPath(root: string, key: string): string {
  if (path.isAbsolute(key) || key.includes('..') || key.includes('\\'))
    throw new Error('Artifact key must be relative');
  const target = path.resolve(root, key);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw new Error('Artifact path escapes root');
  return target;
}

export class LocalArtifactStore {
  constructor(private readonly root: string) {}

  async put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    retention?: StoredArtifact['retention'];
  }): Promise<StoredArtifact> {
    if (path.isAbsolute(input.key) || input.key.includes('..') || input.key.includes('\\'))
      throw new Error('Artifact key must be relative');
    const id = randomUUID();
    const key = `${id}/${input.key}`;
    const target = resolveArtifactPath(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, input.bytes, { mode: 0o600 });
    await rename(temporary, target);
    return {
      id,
      key,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      digest: createHash('sha256').update(input.bytes).digest('hex'),
      retention: input.retention ?? 'standard',
    };
  }

  async read(artifact: StoredArtifact): Promise<Uint8Array> {
    const bytes = await readFile(resolveArtifactPath(this.root, artifact.key));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== artifact.digest) throw new Error('Artifact digest mismatch');
    return bytes;
  }
}
