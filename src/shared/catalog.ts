export type Mode = 'text' | 'image' | 'frames';
export type ModelId = 'ltx-2.5' | 'wan-2.2';
export type Weight = { repo: string; file: string; folder: string };
export type Model = {
  id: ModelId;
  name: string;
  variant: string;
  description: string;
  modes: Mode[];
  steps: number;
  guidance: number;
  fps: number;
  frames: number;
  gated: boolean;
  source: string;
  warning: string;
  weights: Weight[];
};

export const models: Model[] = [
  {
    id: 'ltx-2.5',
    name: 'LTX 2.5',
    variant: '22B · Distilled',
    description: 'Cinematic detail, connected frames, and synchronized audio.',
    modes: ['text', 'image', 'frames'],
    steps: 8,
    guidance: 1,
    fps: 24,
    frames: 97,
    gated: true,
    source: 'https://docs.comfy.org/tutorials/video/ltx/ltx-2-5',
    warning: 'Large 22B model + 12B encoder. Gated weights; license approval required. INT8 workflow compatibility on MPS must be verified before downloading.',
    weights: [
      { repo: 'Lightricks/LTX-2.5', file: 'diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', folder: 'diffusion_models' },
      { repo: 'Lightricks/LTX-2.5', file: 'text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors', folder: 'text_encoders' },
      { repo: 'Lightricks/LTX-2.5', file: 'vae/ltx-2.5-video-vae-bf16.safetensors', folder: 'vae' },
      { repo: 'Lightricks/LTX-2.5', file: 'vae/ltx-2.5-audio-vae-bf16.safetensors', folder: 'vae' },
      { repo: 'Lightricks/LTX-2.5', file: 'latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors', folder: 'latent_upscale_models' },
    ],
  },
  {
    id: 'wan-2.2',
    name: 'Wan 2.2',
    variant: '5B · TI2V',
    description: 'One versatile model for text and image-to-video exploration.',
    modes: ['text', 'image'],
    steps: 20,
    guidance: 5,
    fps: 24,
    frames: 81,
    gated: false,
    source: 'https://docs.comfy.org/tutorials/video/wan/wan2_2',
    warning: 'Smaller starting point, not a Mac performance guarantee. FP8 encoder support depends on ComfyUI/MPS; use a compatible workflow and encoder if needed.',
    weights: [
      { repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged', file: 'split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors', folder: 'diffusion_models' },
      { repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged', file: 'split_files/vae/wan2.2_vae.safetensors', folder: 'vae' },
      { repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', file: 'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors', folder: 'text_encoders' },
    ],
  },
];

export type DownloadState = {
  status: 'not-installed' | 'downloading' | 'ready' | 'failed';
  progress: number;
  message: string;
  startedAt?: number;
};

export type Generation = {
  modelId: ModelId;
  mode: Mode;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  steps: number;
  guidance: number;
  seed: number;
};

export type Job = {
  id: string;
  createdAt: number;
  runtime: 'mock' | 'comfyui';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  parameters: Generation;
  message: string;
  promptId?: string;
  output?: { filename: string; subfolder: string; type: string };
};

export type Bootstrap = {
  runtime: 'mock' | 'comfyui';
  platform: string;
  memoryGB: number;
  downloadsEnabled: boolean;
  models: (Model & { download: DownloadState })[];
};
