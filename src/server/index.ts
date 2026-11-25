import { resolve } from 'node:path';
import { createApp } from './app.ts';

const runtime = process.env.RUNTIME ?? 'mock';
if (runtime !== 'mock' && runtime !== 'comfyui') throw new Error('RUNTIME must be mock or comfyui.');
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const app = createApp({
  runtime,
  dataDir: resolve(process.env.DATA_DIR ?? 'data'),
  comfyRoot: process.env.COMFYUI_ROOT,
  comfyUrl: process.env.COMFYUI_URL,
  workflowDir: process.env.WORKFLOW_DIR,
  allowDownloads: process.env.ALLOW_MODEL_DOWNLOADS === 'true',
  hfToken: process.env.HF_TOKEN,
});
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Leht Frame API: http://127.0.0.1:${port} · ${runtime} mode`);
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
