import { describe, expect, it, vi } from 'vitest';
import { bindWorkflow, comfyClient } from './comfy.ts';
import type { Workflow } from './comfy.ts';
import type { Generation, Job } from '../shared/catalog.ts';

const parameters: Generation = {
  modelId: 'wan-2.2', mode: 'text', prompt: 'A misty forest', negativePrompt: '',
  width: 768, height: 512, frames: 81, fps: 24, steps: 20, guidance: 5, seed: 42,
};
function graph(): Workflow {
  return {
    prompt: { '1': { class_type: 'ExampleNode', inputs: { text: '', width: 1, height: 1, length: 1, fps: 1, steps: 1, cfg: 1, seed: 1 } } },
    bindings: {
      prompt: { node: '1', input: 'text' }, width: { node: '1', input: 'width' },
      height: { node: '1', input: 'height' }, frames: { node: '1', input: 'length' },
      fps: { node: '1', input: 'fps' }, steps: { node: '1', input: 'steps' },
      guidance: { node: '1', input: 'cfg' }, seed: { node: '1', input: 'seed' },
    },
  };
}
describe('ComfyUI adapter contract', () => {
  it('binds user controls and refuses missing or stale graph inputs', () => {
    expect(bindWorkflow(graph(), parameters, {})['1'].inputs).toMatchObject({ text: parameters.prompt, length: 81, cfg: 5, seed: 42 });
    const missing = graph();
    delete missing.bindings.seed;
    expect(() => bindWorkflow(missing, parameters, {})).toThrow('seed');
    expect(() => bindWorkflow(graph(), { ...parameters, mode: 'image' }, {})).toThrow('image');
    const stale = graph();
    stale.bindings.seed = { node: 'nonexistent', input: 'seed' };
    expect(() => bindWorkflow(stale, parameters, {})).toThrow('Invalid workflow binding');
  });
  it('fans out a control to multiple nodes and binds references', () => {
    const workflow = graph();
    workflow.prompt['2'] = { class_type: 'OtherSampler', inputs: { seed: 0, image: '', end_image: '' } };
    workflow.bindings.seed = [{ node: '1', input: 'seed' }, { node: '2', input: 'seed' }];
    workflow.bindings.image = { node: '2', input: 'image' };
    workflow.bindings.lastImage = { node: '2', input: 'end_image' };
    const prompt = bindWorkflow(workflow, { ...parameters, mode: 'frames' }, { image: 'start.png', lastImage: 'end.png' });
    expect(prompt['2'].inputs).toEqual({ seed: 42, image: 'start.png', end_image: 'end.png' });
  });
  it('reads a real video output and reports execution or output failures explicitly', async () => {
    const request = vi.fn<typeof fetch>();
    const client = comfyClient('http://127.0.0.1:8188', 'workflows', request);
    const job: Job = { id: 'local-id', promptId: 'remote-id', createdAt: 0, runtime: 'comfyui', parameters, status: 'queued', progress: 0, message: '' };
    request.mockResolvedValueOnce(Response.json({ 'remote-id': { status: { completed: true }, outputs: { '8': { gifs: [{ filename: 'clip.mp4', subfolder: 'video', type: 'output' }] } } } }));
    expect(await client.refresh(job)).toMatchObject({ status: 'completed', output: { filename: 'clip.mp4' } });
    request.mockResolvedValueOnce(Response.json({ 'remote-id': { status: { status_str: 'error', messages: ['Out of memory'] } } }));
    expect(await client.refresh(job)).toMatchObject({ status: 'failed', message: expect.stringContaining('Out of memory') });
    request.mockResolvedValueOnce(Response.json({ 'remote-id': { status: { completed: true }, outputs: {} } }));
    expect(await client.refresh(job)).toMatchObject({ status: 'failed', message: expect.stringContaining('without an MP4') });
  });
  it('rejects nonlocal runtime destinations', () => {
    expect(() => comfyClient('https://remote.example', 'workflows')).toThrow('local http');
  });
});
