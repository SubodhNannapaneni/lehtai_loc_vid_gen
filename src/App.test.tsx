// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { models } from './shared/catalog.ts';
import type { Bootstrap, Job } from './shared/catalog.ts';
import { api } from './api.ts';

vi.mock('./api.ts', () => ({ api: vi.fn() }));
const status: Bootstrap = {
  runtime: 'mock', platform: 'Apple Silicon', memoryGB: 48, downloadsEnabled: true,
  models: models.map(model => ({ ...model, download: { status: 'ready', progress: 100, message: 'Mock ready' } })),
};
function mockApi() {
  vi.mocked(api).mockImplementation(async path => {
    if (path === '/bootstrap') return structuredClone(status);
    if (path === '/jobs') return [];
    throw new Error(`Unexpected API request: ${path}`);
  });
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('switches model capabilities and validates image input before sending a job', async () => {
  mockApi();
  render(<App />);
  await screen.findByText('Mock model ready');
  fireEvent.click(screen.getByRole('button', { name: /First \+ last frame/ }));
  expect(screen.getByLabelText('Ending reference image')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Wan 2.2/ }));
  expect(screen.queryByRole('button', { name: /First \+ last frame/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Image to video' }));
  fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: 'A cinematic landscape' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate mock scene' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Add a starting reference image');
  expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === '/jobs' && init?.method === 'POST')).toHaveLength(0);
});
it('submits the selected controls as multipart data and labels mock output honestly', async () => {
  mockApi();
  const base = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === '/jobs' && init?.method === 'POST') {
      const body = init.body as FormData;
      expect(body.get('prompt')).toBe('A slow sunrise');
      expect(body.get('modelId')).toBe('ltx-2.5');
      return { id: 'test-job', createdAt: Date.now(), runtime: 'mock', status: 'queued', progress: 0, parameters: {}, message: 'Mock queue' } as Job;
    }
    return base(path, init);
  });
  render(<App />);
  await screen.findByText('Mock model ready');
  fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: 'A slow sunrise' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate mock scene' }));
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path, init]) => path === '/jobs' && init?.method === 'POST')).toBe(true));
  expect(screen.getByText(/Mock results are recipes and storyboards/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Setup & guide/ }));
  expect(screen.getByRole('heading', { name: 'Connect your own ComfyUI.' })).toBeInTheDocument();
});
