import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import type { AppConfig } from './app.ts';
import type { Job } from '../shared/catalog.ts';

const servers: Server[] = [];
const folders: string[] = [];
async function setup(config: Partial<AppConfig> = {}) {
  const dataDir = config.dataDir ?? await mkdtemp(join(tmpdir(), 'frame-api-test-'));
  if (!folders.includes(dataDir)) folders.push(dataDir);
  const app = createApp({ runtime: 'mock', dataDir, ...config });
  const server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return { dataDir, request: (path: string, init?: RequestInit) => fetch(url + path, init) };
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const params = {
  modelId: 'wan-2.2', mode: 'text', prompt: 'A slow cinematic sunrise', negativePrompt: '',
  width: 768, height: 512, frames: 81, fps: 24, steps: 20, guidance: 5, seed: -1,
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

describe('mock studio API', () => {
  it('prepares, renders, exports and restores a mock scene without contacting a runtime', async () => {
    let time = 1000;
    const network = vi.fn<typeof fetch>();
    const app = await setup({ now: () => time, request: network });
    expect((await app.request('/jobs', json(params))).status).toBe(409);
    expect((await app.request('/models/wan-2.2/download', json({}))).status).toBe(202);
    time += 3500;
    expect((await (await app.request('/bootstrap')).json()).models[1].download.status).toBe('ready');
    const response = await app.request('/jobs', json(params));
    expect(response.status).toBe(202);
    const job = await response.json() as Job;
    expect(job.parameters.seed).toBeGreaterThanOrEqual(0);
    time += 8000;
    const completed = await (await app.request('/jobs')).json() as Job[];
    expect(completed[0]).toMatchObject({ status: 'completed', runtime: 'mock', progress: 100 });
    expect(completed[0].output).toBeUndefined();
    expect((await app.request(`/jobs/${job.id}/video`)).status).toBe(404);
    const recipe = await app.request(`/jobs/${job.id}/recipe`);
    expect(recipe.headers.get('content-disposition')).toContain('.json');
    expect(await recipe.json()).toMatchObject({ parameters: { prompt: params.prompt }, runtime: 'mock' });
    const restarted = await setup({ dataDir: app.dataDir, now: () => time });
    expect(await (await restarted.request('/jobs')).json()).toHaveLength(1);
    expect((await (await restarted.request('/bootstrap')).json()).models[1].download.status).toBe('ready');
    expect(network).not.toHaveBeenCalled();
  });

  it('validates model input modes, temporal dimensions and required reference images', async () => {
    let time = 0;
    const app = await setup({ now: () => time });
    await app.request('/models/wan-2.2/download', json({}));
    time = 4000;
    for (const invalid of [
      { ...params, mode: 'frames' },
      { ...params, frames: 80 },
      { ...params, width: 777 },
      { ...params, prompt: ' ' },
      { ...params, seed: 2147483648 },
      { ...params, mode: 'image' },
    ]) expect((await app.request('/jobs', json(invalid))).status).toBe(400);
    const body = new FormData();
    Object.entries({ ...params, mode: 'image' }).forEach(([key, value]) => body.append(key, String(value)));
    body.append('image', new Blob(['not a PNG'], { type: 'image/png' }), 'fake.png');
    expect((await app.request('/jobs', { method: 'POST', body })).status).toBe(400);
    const valid = new FormData();
    Object.entries({ ...params, mode: 'image' }).forEach(([key, value]) => valid.append(key, String(value)));
    // A real 1x1 PNG fixture; no model ever decodes it in mock mode.
    valid.append('image', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V7sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'pixel.png');
    expect((await app.request('/jobs', { method: 'POST', body: valid })).status).toBe(202);
  });

  it('keeps real downloads opt-in, requires license acknowledgement and rejects cross-origin writes', async () => {
    const app = await setup({ runtime: 'comfyui' });
    expect((await app.request('/models/wan-2.2/download', json({ acknowledged: true }))).status).toBe(403);
    expect((await app.request('/models/wan-2.2/download', {
      ...json({}), headers: { 'Content-Type': 'application/json', Origin: 'https://not-local.example' },
    })).status).toBe(403);
    const unlocked = await setup({ runtime: 'comfyui', allowDownloads: true, comfyRoot: app.dataDir });
    expect((await unlocked.request('/models/wan-2.2/download', json({}))).status).toBe(400);
    expect((await unlocked.request('/models/ltx-2.5/download', json({ acknowledged: true }))).status).toBe(400);
    expect((await app.request('/models/unknown/download', json({}))).status).toBe(404);
  });

  it('caps the generation queue without silently dropping jobs', async () => {
    let time = 0;
    const app = await setup({ now: () => time });
    await app.request('/models/wan-2.2/download', json({}));
    time = 4000;
    for (let i = 0; i < 3; i++) expect((await app.request('/jobs', json(params))).status).toBe(202);
    const response = await app.request('/jobs', json(params));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Queue is full') });
    time += 8000;
    expect((await app.request('/jobs', json(params))).status).toBe(202);
  });
});

it('downloads fixture bytes, submits a real-mode graph and proxies its video using a mocked ComfyUI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frame-comfy-test-'));
  folders.push(root);
  const workflowDir = join(root, 'workflows');
  await mkdir(workflowDir);
  await writeFile(join(workflowDir, 'wan-2.2.text.json'), JSON.stringify({
    prompt: { '1': { class_type: 'FixtureOnly', inputs: { prompt: '', width: 0, height: 0, frames: 0, fps: 0, steps: 0, guidance: 0, seed: 0 } } },
    bindings: Object.fromEntries(['prompt', 'width', 'height', 'frames', 'fps', 'steps', 'guidance', 'seed'].map(field => [field, { node: '1', input: field }])),
  }));
  const request = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'huggingface.co') return new Response(new Uint8Array([0, 1, 2]), { headers: { 'content-length': '3' } });
    if (url.pathname === '/prompt') {
      expect(JSON.parse(String(init?.body)).prompt['1'].inputs.prompt).toBe(params.prompt);
      return Response.json({ prompt_id: 'fixture-prompt' });
    }
    if (url.pathname === '/history/fixture-prompt') return Response.json({
      'fixture-prompt': { status: { completed: true }, outputs: { '9': { videos: [{ filename: 'fixture.mp4', subfolder: '', type: 'output' }] } } },
    });
    if (url.pathname === '/view') {
      expect(init?.headers).toMatchObject({ Range: 'bytes=0-2' });
      return new Response(new Uint8Array([3, 4, 5]), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/3', 'content-length': '3' } });
    }
    throw new Error(`Unexpected mock request: ${url}`);
  });
  const app = await setup({ runtime: 'comfyui', dataDir: root, comfyRoot: root, workflowDir, allowDownloads: true, request });
  expect((await app.request('/models/wan-2.2/download', json({ acknowledged: true }))).status).toBe(202);
  await vi.waitFor(async () => {
    const status = await (await app.request('/bootstrap')).json();
    expect(status.models[1].download.status).toBe('ready');
  });
  const response = await app.request('/jobs', json(params));
  expect(response.status).toBe(202);
  const job = await response.json() as Job;
  expect(job.promptId).toBe('fixture-prompt');
  const history = await (await app.request('/jobs')).json() as Job[];
  expect(history[0]).toMatchObject({ status: 'completed', runtime: 'comfyui', output: { filename: 'fixture.mp4' } });
  const video = await app.request(`/jobs/${job.id}/video`, { headers: { Range: 'bytes=0-2' } });
  expect(video.status).toBe(206);
  expect([...new Uint8Array(await video.arrayBuffer())]).toEqual([3, 4, 5]);
});
