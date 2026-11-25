import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DownloadState, Model } from '../shared/catalog.ts';

export async function downloadModel(
  model: Model,
  root: string,
  update: (state: DownloadState) => void,
  token?: string,
  request: typeof fetch = fetch,
) {
  for (const [index, weight] of model.weights.entries()) {
    const folder = join(root, 'models', weight.folder);
    await mkdir(folder, { recursive: true });
    const target = join(folder, basename(weight.file));
    try {
      const existing = await stat(target);
      if (existing.size > 0) continue;
      throw new Error(`Empty weight file at ${target}; remove it before retrying.`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const partial = `${target}.frame-part`;
    const response = await request(`https://huggingface.co/${weight.repo}/resolve/main/${weight.file}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(6 * 60 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Weight download failed (${response.status}). For gated models, approve the license and set HF_TOKEN. File: ${basename(weight.file)}`);
    }
    if (/(text\/|application\/json)/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error(`Expected model weights, received ${response.headers.get('content-type')}.`);
    }
    const expected = Number(response.headers.get('content-length')) || 0;
    let received = 0;
    let lastUpdate = 0;
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (Date.now() - lastUpdate > 500) {
          lastUpdate = Date.now();
          update({
            status: 'downloading',
            progress: Math.floor(((index + (expected ? received / expected : 0)) / model.weights.length) * 100),
            message: `${index + 1}/${model.weights.length} · ${basename(weight.file)} · ${(received / 1e9).toFixed(2)} GB${expected ? ` / ${(expected / 1e9).toFixed(2)} GB` : ''}`,
          });
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.from(response.body), progress, createWriteStream(partial, { flags: 'w' }));
      if (!received || (expected && received !== expected)) throw new Error('Incomplete weight download; retry to restart this file.');
      await rename(partial, target);
    } catch (error) {
      try { await unlink(partial); } catch (cleanupError) {
        if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) {
          throw new AggregateError([error, cleanupError], 'Download failed and its partial file could not be removed.');
        }
      }
      throw error;
    }
  }
  update({ status: 'ready', progress: 100, message: 'Weight files present. Workflow/MPS compatibility must still be verified.' });
}
