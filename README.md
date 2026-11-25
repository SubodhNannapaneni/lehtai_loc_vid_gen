# Leht Frame — local video studio

A purple-themed React + TypeScript workspace for **LTX 2.5** and **Wan 2.2**, with a Node.js
backend. Designed for local use, including Apple Silicon Macs.

**Current release: working mock-first application.** You can select models,
prepare simulated downloads, enter prompts, attach images, adjust parameters,
queue mock generations, and export recipes. Mock results are clearly labeled
storyboards, **not generated video**. No weights or ML runtime are installed by
the app's setup commands.

An optional ComfyUI adapter and real weight downloader are included. Real video
generation requires your own tested ComfyUI instance and API workflow bindings.
This project has **not** been hardware-tested on an M5 Pro/Max; it is not a
one-click, certified Mac inference bundle.

## Quick start (Mac, Windows, or Linux)

1. Install [Node.js 24 LTS](https://nodejs.org/) (minimum 22.18).
2. Download this repository as a ZIP and unzip it. Open Terminal in the project
   folder, or open the folder in VS Code and select **Terminal → New Terminal**.
3. Run:

   ```sh
   npm ci
   npm run dev
   ```

4. Open **http://127.0.0.1:5173**.
5. Choose a model → **Prepare** → write a prompt (or **Try an idea**) →
   **Generate mock scene**.

Preparing takes approximately three seconds; mock generation takes seven.
Image-to-video requires a PNG/JPEG up to 10 MB. LTX's first/last-frame mode
requires two images. Mock mode validates uploads but does not interpret them.
The illustrated desert is a fixed concept storyboard, not a result of your
prompt. Download the settings JSON from the preview or library.

No accounts, API keys, Python, ComfyUI, Ollama, vLLM, or model weights are needed
for mock mode. `npm ci` installs only the application's JavaScript dependencies.
Keep Terminal open while using the app; press Ctrl+C to stop.

### Single-server / sharing the code

Ship the source plus `package-lock.json`; do **not** include `.env`,
`node_modules`, `data`, or downloaded weights. The recipient runs:

```sh
npm ci
npm run build
npm start
```

Then opens **http://127.0.0.1:3001**. The production server serves both the
React build and API. Do not double-click the built HTML file.

## What is implemented

- Two model families with explicit checkpoint variants and capabilities.
- Text prompts, negative prompts, starting images, and LTX first/last frames.
- Aspect ratio, clip length, frame rate, sampling steps, guidance, and seed.
- Model preparation/download states and an explicitly bounded three-job queue.
- Persistent recipes and history (most recent 100 shown); no database required.
- Mock backend, upload validation, error feedback, and restart persistence.
- Opt-in streamed Hugging Face downloads to ComfyUI's model directories.
- ComfyUI image upload, graph input binding, prompt submission, history polling,
  video preview, and video streaming/download.
- In-app model information, compatibility warnings, and setup guide.

No LoRA controls, audio/video reference upload, multishot editing, cancellation,
or real-time ComfyUI step progress are claimed. ComfyUI progress is reported as
queued/rendering/completed; only mock mode simulates percentage progress.

## Why ComfyUI instead of Ollama / vLLM?

[ComfyUI](https://github.com/Comfy-Org/ComfyUI) is free and open-source
(GPL-3.0). Its paid cloud offering is optional; this application uses only a
local HTTP instance. Model licenses are separate from ComfyUI's license.

Ollama is not the video-diffusion backend for these models.
[vLLM-Omni has video-generation pipelines](https://docs.vllm.ai/projects/vllm-omni/en/latest/),
but those are distinct from a regular vLLM language-model server. This project
does not claim those pipelines work on Apple Silicon. The runtime adapter here
targets ComfyUI rather than presenting a nonfunctional Ollama/vLLM switch.

## Real video on Apple Silicon (optional, more setup)

### 1. Install and test ComfyUI first

Use the official [ComfyUI Desktop installer for Apple Silicon](https://www.comfy.org/download).
The desktop application supports Apple Silicon with macOS 13 or later.
Check the current installer requirements before proceeding.

In ComfyUI, open the matching template from **Templates → Video**:

| UI selection | Checkpoint / template target | Inputs exposed here |
| --- | --- | --- |
| LTX 2.5 | Official 22B distilled INT8-convrot workflow | Text, image, first/last images; describe audio in the prompt |
| Wan 2.2 | TI2V **5B**, not the 14B dual-expert version | Text, image; silent video |

Official instructions and download manifests:

- [LTX 2.5 workflows](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5)
- [Wan 2.2 workflows](https://docs.comfy.org/tutorials/video/wan/wan2_2)

**Important Mac limitations:**

- An M5 Pro/Max chip name alone does not establish feasibility. Check unified
  memory, free memory, disk space, precision, and operation support.
- Wan 5B is a smaller starting point, not a speed or memory guarantee.
- The official LTX example contains a large 22B diffusion model and 12B text
  encoder. LTX weights are gated: accept the upstream license and obtain access.
- The download manifest follows the official ComfyUI examples, including an
  INT8-convrot LTX checkpoint and FP8 Wan encoder. These exact quantizations
  are **not verified on MPS by this project**. If your Mac requires another
  encoder or precision, install compatible weights in ComfyUI, update the
  manifest in `src/shared/catalog.ts`, and export the corresponding workflow.
- Do not infer Mac memory requirements from NVIDIA VRAM examples. This project
  deliberately makes no performance promises or automatic memory-fit claims.
- UI sizes are conservative test presets, not upstream native-quality defaults.
  Verify the selected width, height, frame count, and FPS in your graph.
- LTX prompt enhancement is not exposed here; leave it disabled in the exported
  graph. If enabled manually, install its additional encoder yourself.

**Run the template successfully in ComfyUI before integrating it.** If the
template itself does not run, this UI cannot make an incompatible checkpoint
run. This manual compatibility check is why real mode is not one-click yet.

### 2. Configure the studio backend

Copy `.env.example` to `.env`. On a Mac:

```sh
cp .env.example .env
```

Edit it using your actual ComfyUI base/model location and local server port:

```dotenv
RUNTIME=comfyui
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_ROOT=/Users/yourname/Documents/ComfyUI
WORKFLOW_DIR=./workflows
ALLOW_MODEL_DOWNLOADS=true
# Required only for gated LTX weights; keep this server-side:
HF_TOKEN=hf_your_read_token
```

ComfyUI Desktop may use a different local port (often 8000). Use the address
shown by your instance. `COMFYUI_ROOT` must be the writable directory containing
your instance's **models** folder, not the macOS `.app` bundle. Restart the
studio after changing environment variables.

Never put tokens in `VITE_*` variables, client-side code, or a commit.

### 3. Export your ComfyUI API workflows

ComfyUI node IDs and input names differ across templates, versions, and custom
nodes. This project does not fabricate those IDs. For each desired mode:

1. Enable ComfyUI's developer/API export option if necessary.
2. Export a **working API-format prompt** (the node-ID-keyed graph with
   `class_type` and `inputs`; not the visual-editor JSON).
3. Create a `workflows` directory in this project.
4. Wrap the exported graph in `{ "prompt": ..., "bindings": ... }` and save:

   ```text
   workflows/
     ltx-2.5.text.json
     ltx-2.5.image.json
     ltx-2.5.frames.json
     wan-2.2.text.json
     wan-2.2.image.json
   ```

   Only create files for modes you intend to use. A missing file produces an
   explicit API error and a failed job in the library.

Example wrapper structure (**replace the graph and every node ID with yours**):

```json
{
  "prompt": {
    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "old prompt", "clip": ["11", 0] } }
  },
  "bindings": {
    "prompt": { "node": "6", "input": "text" },
    "negativePrompt": { "node": "7", "input": "text" },
    "width": { "node": "12", "input": "width" },
    "height": { "node": "12", "input": "height" },
    "frames": { "node": "12", "input": "length" },
    "fps": { "node": "18", "input": "frame_rate" },
    "steps": { "node": "3", "input": "steps" },
    "guidance": { "node": "3", "input": "cfg" },
    "seed": { "node": "3", "input": "seed" },
    "image": { "node": "14", "input": "image" }
  }
}
```

This abbreviated graph is **not runnable**: retain the entire exported graph,
including its model loaders, links, samplers, and video-saving output.

Bindings for `prompt`, `width`, `height`, `frames`, `fps`, `steps`, `guidance`,
and `seed` are required. `negativePrompt` is required when the field is nonempty.
`image` is required in image/frames mode; `lastImage` is also required in frames
mode. Omit image bindings in a text-only graph. Values replace the target
input, so bind editable scalar inputs, not graph connection inputs.

If a value must change in multiple nodes, use a binding array:

```json
{ "fps": [{ "node": "18", "input": "frame_rate" }, { "node": "21", "input": "fps" }] }
```

Every bound node/input must exist; missing bindings fail rather than silently
ignoring UI settings. For templates with nested subgraphs, export an executable
API graph with addressable inputs, or expose scalar primitive inputs in your
ComfyUI workflow. Ensure the output node saves **MP4 or WebM** and publishes
the file in ComfyUI history (`videos`, `gifs`, or `images` output array). Install
any required custom nodes/FFmpeg in ComfyUI itself.

### 4. Download and generate

Restart with `npm run dev`, or build and use `npm start`.

1. Open **Models** and review the checkpoint information.
2. Click **Download weights** and explicitly acknowledge license, storage,
   and compatibility requirements.
3. The server downloads the diffusion model, encoder, and VAE files (plus the
   LTX upscaler) directly into `COMFYUI_ROOT/models/...`. This can total tens of
   gigabytes. Exact total size is not precomputed.
4. Go to **Create video**, choose the matching model/mode, then generate.

The downloader uses only the catalog's fixed Hugging Face repositories, keeps
tokens on the backend, verifies transfer length when available, writes an
app-owned `.frame-part` file, then renames after completion. Existing nonempty
weight files are reused; **cryptographic integrity is not verified**. Do not
place untrusted files in these folders. On interruption, retry restarts the
incomplete file rather than resuming bytes. Completed files are retained.
Gated access, missing disk space, missing graphs, unsupported nodes, and runtime
errors are surfaced; there is no fallback to fake video or cloud rendering.

If you already installed the weights with ComfyUI, the Download action
recognizes the nonempty files without re-downloading. Readiness means files
were present at that point, not that the model was loaded or validated.
Refresh ComfyUI's model list/restart it if newly downloaded files are not visible.

## Local data and operation

- `data/mock` and `data/comfyui` keep separate model state and job recipes.
- API jobs and model preparation survive restarts. An interrupted real download
  is marked failed; retry restarts incomplete files. Real jobs with saved
  ComfyUI prompt IDs are reconciled via history after restart.
- The UI polls status every 1.2 seconds. ComfyUI must retain its history until
  the app observes completion; video files remain in ComfyUI's output directory.
- This app does not retain uploaded image bytes; ComfyUI retains images sent
  in real mode in its input directory. Reusing an image recipe requires
  attaching images again. Prompt and settings JSON stay on disk.
- Recipe JSON and real output video can be downloaded from the UI.
- Both app servers bind to loopback. The API rejects foreign browser origins.
  This is a trusted-local-user prototype, not an authenticated multi-user
  service. Do not expose it to LAN/the internet or put it behind a public tunnel.
- Model downloads contact Hugging Face. Otherwise no analytics, hosted assets,
  external fonts, cloud generation, or paid API are used. Upstream ComfyUI/custom
  nodes have their own network and privacy behavior.
- `PORT` controls the API/production port (default 3001). The development Vite
  proxy targets 3001; update `vite.config.ts` too if changing the API dev port.

## Development and validation

```sh
npm test
npm run build
```

Tests use HTTP mocks and tiny local byte fixtures, never real model weights or
a GPU. They cover model preparation and restart persistence, generation,
upload/mode/frame validation, queue limits, download guards and failure cleanup,
ComfyUI graph binding and output handling, and React control/submission flows.
`npm run build` includes strict TypeScript checking.

The backend runs TypeScript directly with Node 22.18+'s type stripping; no
Python environment or global package installation is required.

### Source layout

```text
src/App.tsx                 React studio, library, models, and setup screens
src/styles.css              Responsive local-only styling
src/shared/catalog.ts       Model variants, weight manifests, and shared types
src/shared/validation.ts    Input constraints
src/server/app.ts           Local API and persisted mock/real jobs
src/server/comfy.ts         ComfyUI workflow and video adapter
src/server/downloads.ts     Guarded streaming weight downloads
```
