import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { totalmem } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { models } from '../shared/catalog.ts';
import type { Bootstrap, DownloadState, Job, ModelId } from '../shared/catalog.ts';
import { generationSchema } from '../shared/validation.ts';
import { comfyClient } from './comfy.ts';
import { downloadModel } from './downloads.ts';

export type AppConfig = {
  runtime: 'mock' | 'comfyui';
  dataDir: string;
  comfyRoot?: string;
  comfyUrl?: string;
  workflowDir?: string;
  allowDownloads?: boolean;
  hfToken?: string;
  now?: () => number;
  request?: typeof fetch;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function readJson(path: string) { return JSON.parse(readFileSync(path, 'utf8')); }
function persist(path: string, value: unknown) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}
function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function validImage(file: Express.Multer.File) {
  return (file.mimetype === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    || (file.mimetype === 'image/jpeg' && file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255);
}

export function createApp(config: AppConfig) {
  const app = express();
  const now = config.now ?? Date.now;
  const data = resolve(config.dataDir, config.runtime);
  const jobsDir = join(data, 'jobs');
  mkdirSync(jobsDir, { recursive: true });
  const client = config.runtime === 'comfyui'
    ? comfyClient(config.comfyUrl ?? 'http://127.0.0.1:8188', resolve(config.workflowDir ?? 'workflows'), config.request)
    : undefined;
  const states = new Map<ModelId, DownloadState>();
  const jobs = new Map<string, Job>();
  for (const filename of readdirSync(jobsDir).filter(name => name.endsWith('.json'))) {
    const job = readJson(join(jobsDir, filename)) as Job;
    if (!job.id || !job.parameters || !['mock', 'comfyui'].includes(job.runtime)) throw new Error(`Invalid job file: ${filename}`);
    if (job.status === 'queued' && job.runtime === 'comfyui' && !job.promptId) {
      job.status = 'failed';
      job.message = 'Server restarted during submission. Check ComfyUI queue before retrying.';
    }
    jobs.set(job.id, job);
  }
  for (const model of models) {
    let state: DownloadState = { status: 'not-installed', progress: 0, message: 'Not downloaded' };
    try {
      state = readJson(join(data, `${model.id}.json`)) as DownloadState;
      if (state.status === 'downloading' && config.runtime !== 'mock') {
        state = { status: 'failed', progress: 0, message: 'Download interrupted by restart. Retry to restart incomplete files.' };
      }
    } catch (error) { if (!isMissing(error)) throw error; }
    states.set(model.id, state);
  }
  const saveJob = (job: Job) => {
    persist(join(jobsDir, `${job.id}.json`), job);
    jobs.set(job.id, job);
    return job;
  };
  const saveState = (id: ModelId, state: DownloadState) => {
    persist(join(data, `${id}.json`), state);
    states.set(id, state);
  };
  function modelState(id: ModelId) {
    let state = states.get(id)!;
    if (config.runtime === 'mock' && state.status === 'downloading') {
      const progress = Math.min(100, Math.floor((now() - state.startedAt!) / 30));
      state = { ...state, progress, status: progress === 100 ? 'ready' : 'downloading', message: progress === 100 ? 'Mock model prepared · no weights downloaded' : 'Simulating model setup · no network download' };
      if (progress === 100) saveState(id, state);
    }
    return state;
  }
  async function refresh(job: Job) {
    if (job.status === 'completed' || job.status === 'failed') return job;
    if (job.runtime === 'mock') {
      const progress = Math.min(100, Math.floor((now() - job.createdAt) / 70));
      return saveJob({
        ...job, progress, status: progress === 100 ? 'completed' : progress < 12 ? 'queued' : 'running',
        message: progress === 100 ? 'Mock complete. This is a storyboard, not an AI-generated video.' : progress < 35 ? 'Preparing a simulated scene…' : progress < 75 ? 'Simulating denoising…' : 'Finishing mock storyboard…',
      });
    }
    if (!job.promptId) return job;
    // Transport failures remain API errors, not a fabricated model failure.
    const updated = await client!.refresh(job);
    const latest = jobs.get(job.id)!;
    if (latest.status === 'completed' || latest.status === 'failed') return latest;
    return saveJob(updated);
  }

  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const host = req.headers.host?.split(':')[0];
    if (!host || !['localhost', '127.0.0.1', '['].includes(host)) return next(new HttpError(403, 'Local requests only.'));
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`
      && !['http://127.0.0.1:5173', 'http://localhost:5173'].includes(req.headers.origin)) {
      return next(new HttpError(403, 'Cross-origin requests are not allowed.'));
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/bootstrap', (_req, res) => {
    const result: Bootstrap = {
      runtime: config.runtime,
      platform: process.platform === 'darwin' && process.arch === 'arm64' ? 'Apple Silicon' : `${process.platform} · ${process.arch}`,
      memoryGB: Math.round(totalmem() / 1024 ** 3),
      downloadsEnabled: config.runtime === 'mock' || Boolean(config.allowDownloads && config.comfyRoot),
      models: models.map(model => ({ ...model, download: modelState(model.id) })),
    };
    res.json(result);
  });
  app.post('/api/models/:id/download', (req, res) => {
    const model = models.find(m => m.id === req.params.id);
    if (!model) throw new HttpError(404, 'Unknown model.');
    if (modelState(model.id).status === 'downloading') return res.status(202).json(modelState(model.id));
    if (config.runtime === 'comfyui') {
      if (!config.allowDownloads || !config.comfyRoot) throw new HttpError(403, 'Set COMFYUI_ROOT and ALLOW_MODEL_DOWNLOADS=true on the server first.');
      if (req.body?.acknowledged !== true) throw new HttpError(400, 'Confirm the model license, disk requirements and workflow compatibility first.');
      if (model.gated && !config.hfToken) throw new HttpError(400, 'LTX weights require license approval and HF_TOKEN on the server.');
    }
    const initial: DownloadState = { status: 'downloading', progress: 0, startedAt: now(), message: config.runtime === 'mock' ? 'Simulated download · no weights fetched' : 'Starting weight download…' };
    saveState(model.id, initial);
    if (config.runtime === 'comfyui') {
      void downloadModel(model, config.comfyRoot!, state => saveState(model.id, state), config.hfToken, config.request).catch(error => {
        console.error('Model download failed:', error);
        saveState(model.id, { status: 'failed', progress: 0, message: error instanceof Error ? error.message : String(error) });
      });
    }
    res.status(202).json(initial);
  });

  app.get('/api/jobs', async (_req, res) => {
    const sorted = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
    res.json(await Promise.all(sorted.map(refresh)));
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 12, fieldSize: 16000 } });
  app.post('/api/jobs', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'lastImage', maxCount: 1 }]), async (req, res) => {
    const parameters = generationSchema.parse(req.body);
    const fileMap = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const files = Object.values(fileMap).flat();
    if (files.some(file => !validImage(file))) throw new HttpError(400, 'Only valid PNG and JPEG image files are accepted (up to 10 MB).');
    if (parameters.mode !== 'text' && !fileMap.image?.length) throw new HttpError(400, 'A starting reference image is required.');
    if (parameters.mode === 'frames' && !fileMap.lastImage?.length) throw new HttpError(400, 'An ending reference image is required.');
    if ((parameters.mode === 'text' && files.length) || (parameters.mode !== 'frames' && fileMap.lastImage)) throw new HttpError(400, 'Reference images do not match the selected input mode.');
    if (modelState(parameters.modelId).status !== 'ready') throw new HttpError(409, 'Prepare or download this model before generating.');
    await Promise.all([...jobs.values()].filter(job => job.status === 'queued' || job.status === 'running').map(refresh));
    if ([...jobs.values()].filter(job => job.status === 'queued' || job.status === 'running').length >= 3) throw new HttpError(409, 'Queue is full. Wait for a job to finish.');
    if (parameters.seed === -1) parameters.seed = Math.floor(Math.random() * 2147483648);
    let job: Job = saveJob({
      id: crypto.randomUUID(), createdAt: now(), runtime: config.runtime, parameters,
      status: 'queued', progress: 0, message: config.runtime === 'mock' ? 'Added to mock queue' : 'Submitting to ComfyUI…',
    });
    if (client) {
      try {
        const promptId = await client.submit(parameters, files);
        job = saveJob({ ...job, promptId, message: 'Submitted to ComfyUI.' });
      } catch (error) {
        saveJob({ ...job, status: 'failed', message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    res.status(202).json(job);
  });
  app.get('/api/jobs/:id/recipe', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) throw new HttpError(404, 'Job not found.');
    res.attachment(`leht-frame-${job.id}.json`).json(job);
  });
  app.get('/api/jobs/:id/video', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job?.output || job.runtime !== 'comfyui' || !client) throw new HttpError(404, 'No rendered video is available for this job.');
    const response = await client.video(job.output, req.headers.range);
    res.status(response.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!response.body) throw new Error('ComfyUI returned an empty video response.');
    await pipeline(Readable.from(response.body), res);
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API endpoint not found.')));
  app.use(express.static(resolve('dist')));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ') });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON body.' });
    console.error('API error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected server error. Check server logs.' });
  });
  return app;
}
