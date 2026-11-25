import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Generation, Job } from '../shared/catalog.ts';

const bindingSchema = z.object({ node: z.string().min(1), input: z.string().min(1) });
const fields = ['prompt', 'negativePrompt', 'width', 'height', 'frames', 'fps', 'steps', 'guidance', 'seed', 'image', 'lastImage'] as const;
const workflowSchema = z.object({
  prompt: z.record(z.string(), z.object({
    class_type: z.string(),
    inputs: z.record(z.string(), z.unknown()),
  }).passthrough()),
  bindings: z.partialRecord(z.enum(fields), z.union([bindingSchema, z.array(bindingSchema).min(1)])),
});

export type Workflow = z.infer<typeof workflowSchema>;

export function bindWorkflow(raw: unknown, parameters: Generation, images: Record<string, string>) {
  const workflow = workflowSchema.parse(raw);
  const required = ['prompt', 'width', 'height', 'frames', 'fps', 'steps', 'guidance', 'seed'];
  if (parameters.negativePrompt) required.push('negativePrompt');
  if (parameters.mode !== 'text') required.push('image');
  if (parameters.mode === 'frames') required.push('lastImage');
  for (const field of required) {
    if (!workflow.bindings[field as keyof Workflow['bindings']]) {
      throw new Error(`Workflow is missing the "${field}" binding. See README workflow setup.`);
    }
  }
  for (const [field, targets] of Object.entries(workflow.bindings)) {
    const value = field in images ? images[field] : parameters[field as keyof Generation];
    if (value === undefined) throw new Error(`No value supplied for workflow binding "${field}".`);
    for (const target of Array.isArray(targets) ? targets : [targets]) {
      const node = workflow.prompt[target.node];
      if (!node || !(target.input in node.inputs)) throw new Error(`Invalid workflow binding ${target.node}.${target.input}.`);
      node.inputs[target.input] = value;
    }
  }
  return workflow.prompt;
}

export function comfyClient(base: string, workflowDir: string, request: typeof fetch = fetch) {
  const url = new URL(base);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') {
    throw new Error('COMFYUI_URL must be a local http:// address.');
  }
  async function call(path: string, init?: RequestInit) {
    const response = await request(new URL(path, url), { ...init, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`ComfyUI ${path} failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
    return response;
  }
  return {
    async submit(parameters: Generation, files: Express.Multer.File[]) {
      const raw: unknown = JSON.parse(await readFile(join(workflowDir, `${parameters.modelId}.${parameters.mode}.json`), 'utf8'));
      // Check the graph before uploading potentially large reference images.
      bindWorkflow(raw, parameters, { image: '__pending__', lastImage: '__pending__' });
      const images: Record<string, string> = {};
      for (const file of files) {
        const form = new FormData();
        form.append('image', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), `${crypto.randomUUID()}.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`);
        form.append('type', 'input');
        const result = z.object({ name: z.string(), subfolder: z.string().optional() }).parse(await (await call('/upload/image', { method: 'POST', body: form })).json());
        images[file.fieldname] = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
      }
      const prompt = bindWorkflow(raw, parameters, images);
      const response = await call('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, client_id: crypto.randomUUID() }),
      });
      return z.object({ prompt_id: z.string() }).parse(await response.json()).prompt_id;
    },
    async refresh(job: Job): Promise<Job> {
      if (!job.promptId) throw new Error('ComfyUI job has no prompt ID.');
      const history: unknown = await (await call(`/history/${encodeURIComponent(job.promptId)}`)).json();
      const parsed = z.record(z.string(), z.object({
        status: z.object({ completed: z.boolean().optional(), status_str: z.string().optional(), messages: z.array(z.unknown()).optional() }).optional(),
        outputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      })).parse(history);
      const entry = parsed[job.promptId];
      if (!entry) return { ...job, status: 'running', progress: 10, message: 'Queued or rendering in ComfyUI. Detailed progress is available in ComfyUI.' };
      if (entry.status?.status_str === 'error') {
        return { ...job, status: 'failed', message: `ComfyUI execution failed: ${JSON.stringify(entry.status.messages ?? []).slice(0, 800)}` };
      }
      if (!entry.status?.completed) return job;
      const outputSchema = z.array(z.object({ filename: z.string(), subfolder: z.string().default(''), type: z.string().default('output') }));
      for (const node of Object.values(entry.outputs ?? {})) {
        for (const key of ['videos', 'gifs', 'images']) {
          if (!node[key]) continue;
          const output = outputSchema.parse(node[key]).find(o => /\.(mp4|webm)$/i.test(o.filename));
          if (output) return { ...job, status: 'completed', progress: 100, message: 'Your video is ready.', output };
        }
      }
      return { ...job, status: 'failed', message: 'Workflow completed without an MP4/WebM output. Add a video-saving output node.' };
    },
    async video(output: NonNullable<Job['output']>, range?: string) {
      const query = new URLSearchParams(output);
      return call(`/view?${query}`, { headers: range ? { Range: range } : {} });
    },
  };
}
