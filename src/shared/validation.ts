import { z } from 'zod';
import { models } from './catalog.ts';

export const generationSchema = z.object({
  modelId: z.enum(['ltx-2.5', 'wan-2.2']),
  mode: z.enum(['text', 'image', 'frames']),
  prompt: z.string().trim().min(3, 'Describe your scene in at least 3 characters.').max(4000),
  negativePrompt: z.string().max(2000).default(''),
  width: z.coerce.number().int().min(256).max(1280).refine(n => n % 32 === 0, 'Width must be a multiple of 32.'),
  height: z.coerce.number().int().min(256).max(1280).refine(n => n % 32 === 0, 'Height must be a multiple of 32.'),
  frames: z.coerce.number().int().min(17).max(241),
  fps: z.coerce.number().int().min(8).max(30),
  steps: z.coerce.number().int().min(1).max(60),
  guidance: z.coerce.number().min(0).max(15),
  seed: z.coerce.number().int().min(-1).max(2147483647),
}).superRefine((value, ctx) => {
  const model = models.find(m => m.id === value.modelId)!;
  if (!model.modes.includes(value.mode)) {
    ctx.addIssue({ code: 'custom', path: ['mode'], message: 'This model does not support this input mode.' });
  }
  const divisor = value.modelId === 'ltx-2.5' ? 8 : 4;
  if ((value.frames - 1) % divisor !== 0) {
    ctx.addIssue({ code: 'custom', path: ['frames'], message: `Frame count must be ${divisor}n + 1.` });
  }
});
