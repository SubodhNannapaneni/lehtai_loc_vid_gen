import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadModel } from './downloads.ts';
import { models } from '../shared/catalog.ts';
import type { DownloadState } from '../shared/catalog.ts';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function folder() { const path = await mkdtemp(join(tmpdir(), 'frame-weights-test-')); folders.push(path); return path; }
const model = { ...models[1], weights: [{ repo: 'Comfy-Org/test', file: 'tiny.safetensors', folder: 'diffusion_models' }] };
it('streams weight bytes to the model folder and skips completed files on retry', async () => {
  const root = await folder();
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3', 'content-type': 'application/octet-stream' } }));
  const updates: DownloadState[] = [];
  await downloadModel(model, root, state => updates.push(state), undefined, request);
  expect([...await readFile(join(root, 'models', 'diffusion_models', 'tiny.safetensors'))]).toEqual([1, 2, 3]);
  expect(updates.at(-1)?.status).toBe('ready');
  await downloadModel(model, root, () => {}, undefined, request);
  expect(request).toHaveBeenCalledTimes(1);
});
it('cleans partial files and never marks an incomplete transfer ready', async () => {
  const root = await folder();
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { 'content-length': '5' } }));
  const update = vi.fn();
  await expect(downloadModel(model, root, update, undefined, request)).rejects.toThrow('Incomplete');
  expect(await readdir(join(root, 'models', 'diffusion_models'))).toEqual([]);
  expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
});
it('surfaces access errors instead of saving error pages as model weights', async () => {
  const root = await folder();
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('Access denied', { status: 401 }));
  await expect(downloadModel(model, root, () => {}, undefined, request)).rejects.toThrow('401');
  expect(await readdir(join(root, 'models', 'diffusion_models'))).toEqual([]);
});
