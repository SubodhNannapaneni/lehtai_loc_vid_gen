import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  Aperture, ArrowDownToLine, ArrowRight, AudioLines, Box, Check, ChevronDown,
  CircleHelp, Clapperboard, Clock3, Cpu, Film, FolderOpen, ImagePlus, Layers3,
  LoaderCircle, Monitor, Plus, Settings2, ShieldCheck, Sparkles, WandSparkles, X,
} from 'lucide-react';
import { api } from './api.ts';
import { models } from './shared/catalog.ts';
import type { Bootstrap, Generation, Job, Mode, Model, ModelId } from './shared/catalog.ts';
import { generationSchema } from './shared/validation.ts';

type Page = 'create' | 'library' | 'models' | 'setup';
const modeNames: Record<Mode, string> = { text: 'Text to video', image: 'Image to video', frames: 'First + last frame' };
const initialModel = models[0];
const initialParameters: Generation = {
  modelId: initialModel.id, mode: 'text', prompt: '', negativePrompt: '',
  width: 768, height: 512, frames: initialModel.frames, fps: initialModel.fps,
  steps: initialModel.steps, guidance: initialModel.guidance, seed: -1,
};
const examples = [
  'A lone traveler crosses terracotta dunes at dusk. A slow aerial camera reveals endless ripples of sand, warm amber light, soft film grain.',
  'A glass greenhouse in a rainy forest. The camera slowly pushes through the open door as droplets catch the morning light.',
  'A tiny observatory on a cliff above a sea of clouds. The telescope turns slowly under a sky full of stars, cinematic wide shot.',
];

export function Landscape({ compact = false }: { compact?: boolean }) {
  return <svg className="landscape" viewBox="0 0 960 640" role="img" aria-label="Illustrated desert concept storyboard, not generated video" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id={compact ? 'sky-small' : 'sky'} x2="0" y2="1"><stop stopColor="#19162e" /><stop offset=".6" stopColor="#655287" /><stop offset="1" stopColor="#b69adc" /></linearGradient>
      <linearGradient id={compact ? 'dune-small' : 'dune'} x2=".6" y2="1"><stop stopColor="#9c7cc2" /><stop offset=".5" stopColor="#5b3f82" /><stop offset="1" stopColor="#292337" /></linearGradient>
      <filter id={compact ? 'grain-small' : 'grain'}><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncA type="linear" slope=".10" /></feComponentTransfer></filter>
    </defs>
    <rect width="960" height="640" fill={`url(#${compact ? 'sky-small' : 'sky'})`} />
    <circle cx="688" cy="228" r="44" fill="#e6dcff" opacity=".85" />
    <path d="M0 370Q230 290 470 365T960 330V640H0Z" fill="#76638f" />
    <path d="M0 460Q210 290 420 385T960 390V640H0Z" fill="#9580b1" />
    <path d="M-50 600Q190 430 405 435Q650 435 1030 320L1030 670H-50Z" fill={`url(#${compact ? 'dune-small' : 'dune'})`} />
    <path d="M-30 610Q170 430 405 435Q670 431 1000 330" fill="none" stroke="#cbb0ed" strokeWidth="2" opacity=".8" />
    <path d="M0 640Q220 570 440 578T960 500V640Z" fill="#30263d" opacity=".6" />
    <g fill="#242030"><circle cx="468" cy="435" r="4" /><path d="m465 440-5 19 9 2 4-18ZM462 458l-4 17h3l5-16ZM468 458l5 15h3l-5-17Z" /></g>
    <rect width="960" height="640" filter={`url(#${compact ? 'grain-small' : 'grain'})`} opacity=".55" />
  </svg>;
}

function ImageInput({ label, file, onChange }: { label: string; file?: File; onChange: (file?: File) => void }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(event: ChangeEvent<HTMLInputElement>) { onChange(event.target.files?.[0]); event.target.value = ''; }
  return <div className="image-input">
    <label className="upload">
      {preview ? <img src={preview} alt={label} /> : <ImagePlus size={25} />}
      <span>{file ? file.name : label}</span><small>PNG or JPG · up to 10 MB</small>
      <input aria-label={label} type="file" accept="image/png,image/jpeg" onChange={choose} />
    </label>
    {file && <button className="remove-image icon-button" aria-label={`Remove ${label}`} onClick={() => onChange(undefined)}><X size={15} /></button>}
  </div>;
}

function ModelCard({ model, selected, onSelect }: { model: Model; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={`model-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
    <span className={`model-symbol ${model.id === 'wan-2.2' ? 'wan' : ''}`}>{model.id === 'ltx-2.5' ? <Aperture size={22} /> : <Layers3 size={22} />}</span>
    <strong>{model.name}</strong><small>{model.variant}</small>
    <span className="selection-dot">{selected && <Check size={10} />}</span>
  </button>;
}

export default function App() {
  const [page, setPage] = useState<Page>('create');
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [parameters, setParameters] = useState(initialParameters);
  const [image, setImage] = useState<File>();
  const [lastImage, setLastImage] = useState<File>();
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState<ModelId>();
  const [confirmation, setConfirmation] = useState<ModelId>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const mounted = useRef(true);
  const downloadDialog = useRef<HTMLElement>(null);
  const currentModel = (bootstrap?.models ?? models).find(m => m.id === parameters.modelId)!;
  const download = bootstrap?.models.find(m => m.id === parameters.modelId)?.download;
  const mock = bootstrap?.runtime === 'mock';
  const selectedJob = jobs.find(job => job.id === selectedJobId) ?? jobs[0];
  const active = jobs.filter(job => ['queued', 'running'].includes(job.status));
  const refresh = useCallback(async () => {
    const [status, history] = await Promise.all([api<Bootstrap>('/bootstrap'), api<Job[]>('/jobs')]);
    if (mounted.current) { setBootstrap(status); setJobs(history); setPollError(''); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(); } catch (reason) { if (!stopped) setPollError(reason instanceof Error ? reason.message : String(reason)); }
      if (!stopped) timer = setTimeout(poll, 1200);
    }
    void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!confirmation || !downloadDialog.current) return;
    const dialog = downloadDialog.current;
    const previousFocus = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
    focusable()[0]?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setConfirmation(undefined); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const target = event.shiftKey ? elements.at(-1) : elements[0];
      if ((event.shiftKey && document.activeElement === elements[0]) || (!event.shiftKey && document.activeElement === elements.at(-1))) {
        event.preventDefault(); target?.focus();
      }
    }
    dialog.addEventListener('keydown', handleKey);
    return () => {
      dialog.removeEventListener('keydown', handleKey);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [confirmation]);

  function update<K extends keyof Generation>(key: K, value: Generation[K]) { setParameters(p => ({ ...p, [key]: value })); }
  function selectModel(id: ModelId) {
    const model = models.find(m => m.id === id)!;
    setParameters(p => ({
      ...p, modelId: id, mode: model.modes.includes(p.mode) ? p.mode : 'text',
      steps: model.steps, guidance: model.guidance, fps: model.fps, frames: model.frames,
    }));
    setError('');
  }
  function chooseImage(setter: (file?: File) => void, file?: File) {
    if (file && (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
      setError('Choose a PNG or JPEG under 10 MB.'); return;
    }
    setter(file);
    setError('');
  }
  async function startDownload(id: ModelId) {
    if (!mock && confirmation !== id) { setAcknowledged(false); setConfirmation(id); return; }
    setDownloadBusy(id); setError('');
    try {
      await api(`/models/${id}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledged }) });
      setConfirmation(undefined);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDownloadBusy(undefined); }
  }
  async function generate() {
    setError('');
    const result = generationSchema.safeParse(parameters);
    if (!result.success) { setError(result.error.issues[0].message); return; }
    if (parameters.mode !== 'text' && !image) { setError('Add a starting reference image.'); return; }
    if (parameters.mode === 'frames' && !lastImage) { setError('Add an ending reference image.'); return; }
    setBusy(true);
    try {
      const body = new FormData();
      Object.entries(result.data).forEach(([key, value]) => body.append(key, String(value)));
      if (parameters.mode !== 'text' && image) body.append('image', image);
      if (parameters.mode === 'frames' && lastImage) body.append('lastImage', lastImage);
      const job = await api<Job>('/jobs', { method: 'POST', body });
      setSelectedJobId(job.id);
      setJobs(previous => [job, ...previous]);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  function reuse(job: Job) {
    setParameters({ ...job.parameters, mode: 'text' });
    setImage(undefined); setLastImage(undefined); setPage('create'); setSelectedJobId(job.id);
    setError(job.parameters.mode !== 'text' ? 'Recipe loaded. Re-select image mode and attach the original references; uploads are not retained by this app.' : '');
  }
  const pageTitles: Record<Page, string> = { create: 'Studio', library: 'Your library', models: 'Model library', setup: 'Getting started' };
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="Leht Frame home" onClick={e => { e.preventDefault(); setPage('create'); }}><span className="brand-mark"><Film size={23} /></span><span className="brand-name">Leht Frame</span></a>
      <div className="workspace-label">YOUR WORKSPACE <span>LOCAL</span></div>
      <nav aria-label="Main navigation">
        <NavButton label="Create video" active={page === 'create'} icon={<Clapperboard size={18} />} onClick={() => setPage('create')}>Create video <Plus size={15} /></NavButton>
        <NavButton label="My library" active={page === 'library'} icon={<FolderOpen size={18} />} onClick={() => setPage('library')}>My library <span className="nav-count">{jobs.filter(j => j.status === 'completed').length}</span></NavButton>
        <NavButton label="Models" active={page === 'models'} icon={<Box size={18} />} onClick={() => setPage('models')}>Models <span className="nav-count">2</span></NavButton>
      </nav>
      <div className="sidebar-project"><div className="tiny-label">A LITTLE INSPIRATION</div><div className="mini-landscape"><Landscape compact /><span>Every frame starts<br />with an idea.</span></div><p>Your imagination.<br />Your machine. Your rules.</p></div>
      <div className="sidebar-bottom">
        <button className="help-button" onClick={() => setPage('setup')}><CircleHelp size={17} /> Setup & guide <ArrowRight size={14} /></button>
        <div className="machine-card"><span className="machine-icon"><Monitor size={18} /></span><div><strong>{bootstrap?.platform ?? 'Connecting…'}</strong><small>{bootstrap ? `${bootstrap.memoryGB} GB system memory` : 'Waiting for local API'}</small></div><span className={`status-dot ${pollError ? 'offline' : ''}`} /></div>
        <small className="version">LEHT FRAME <span>v0.1.0</span></small>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{pageTitles[page]}</strong></div><div className="topbar-right"><span className="privacy"><ShieldCheck size={14} /> Local-first</span><span className={`runtime-pill ${!mock && bootstrap ? 'live' : ''}`}><span className="status-dot" />{bootstrap ? mock ? 'Mock mode' : 'ComfyUI mode' : 'Connecting'}</span><button className="icon-button" aria-label="Open setup" onClick={() => setPage('setup')}><Settings2 size={18} /></button></div></header>
      <main>
        {(error || pollError) && <div role="alert" className="error-banner"><CircleHelp size={17} /><span>{error || `Cannot sync with the local API: ${pollError}`}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => { setError(''); setPollError(''); }}><X size={16} /></button></div>}
        <div className="page-heading"><div><div className="eyebrow"><span /> YOUR LOCAL CREATIVE ENGINE</div><h1>{page === 'create' ? <>Big ideas. <span>Moving pictures.</span></> : pageTitles[page]}</h1><p>{page === 'create' ? 'Turn a thought into a scene. Keep the entire process on your machine.' : page === 'models' ? 'Two creative engines. One private workspace.' : page === 'library' ? 'Your scenes, settings, and experiments. Saved on this machine.' : 'From your first mock scene to your own local video engine.'}</p></div><span className="heading-stamp"><Cpu size={15} /> Built for local</span></div>
        {page === 'create' && <div className="studio-grid">
          <section className="controls-panel panel" aria-label="Video settings">
            <div className="section-title"><span className="step-number">01</span><h2>Choose your model</h2><button className="text-button" onClick={() => setPage('models')}>Details <ArrowRight size={13} /></button></div>
            <div className="model-grid">{models.map(model => <ModelCard key={model.id} model={model} selected={model.id === parameters.modelId} onSelect={() => selectModel(model.id)} />)}</div>
            <div className="model-status"><span className={`status-dot ${download?.status === 'ready' ? '' : 'accent'}`} /><span>{download?.status === 'ready' ? mock ? 'Mock model ready' : 'Weights present' : download?.status === 'downloading' ? `${download.progress}% · ${mock ? 'Preparing mock model' : 'Downloading weights'}` : 'Model not prepared'}</span>{download?.status !== 'ready' && download?.status !== 'downloading' && <button className="text-button" disabled={!bootstrap?.downloadsEnabled || !!downloadBusy} onClick={() => void startDownload(parameters.modelId)}>{mock ? 'Prepare' : 'Download'} <ArrowDownToLine size={12} /></button>}</div>
            {download?.status === 'downloading' && <div className="progress-track small"><span style={{ width: `${download.progress}%` }} /></div>}
            {download?.status === 'failed' && <p className="inline-error">{download.message}</p>}
            <div className="panel-divider" />
            <div className="section-title"><span className="step-number">02</span><h2>Set the scene</h2><Sparkles size={15} className="muted" /></div>
            <div className="mode-tabs" role="group" aria-label="Input mode">{currentModel.modes.map(mode => <button key={mode} className={parameters.mode === mode ? 'active' : ''} onClick={() => update('mode', mode)}>{modeNames[mode]}</button>)}</div>
            {parameters.mode !== 'text' && <div className="uploads"><ImageInput label="Starting reference image" file={image} onChange={file => chooseImage(setImage, file)} />{parameters.mode === 'frames' && <ImageInput label="Ending reference image" file={lastImage} onChange={file => chooseImage(setLastImage, file)} />}</div>}
            <div className="label-row"><label htmlFor="prompt">Your prompt</label><span>Be a little cinematic.</span></div>
            <div className="prompt-box"><textarea id="prompt" placeholder="A place, a moment, a little movement…&#10;Describe the scene you want to bring to life." maxLength={4000} value={parameters.prompt} onChange={e => update('prompt', e.target.value)} /><div><button className="text-button" onClick={() => { update('prompt', examples[exampleIndex % examples.length]); setExampleIndex(i => i + 1); }}><WandSparkles size={13} /> Try an idea</button><small>{parameters.prompt.length}/4000</small></div></div>
            <div className="prompt-hint">{parameters.modelId === 'ltx-2.5' ? <><AudioLines size={13} /> Describe sounds or dialogue for native audio. No audio-reference workflow in this version.</> : <><Film size={13} /> Describe subject, movement, lighting, and camera. This Wan variant produces silent video.</>}</div>
            <div className="panel-divider" />
            <div className="section-title"><span className="step-number">03</span><h2>Make it yours</h2><Settings2 size={15} className="muted" /></div>
            <div className="field-grid">
              <label>Aspect ratio<select aria-label="Aspect ratio" value={`${parameters.width}x${parameters.height}`} onChange={e => { const [width, height] = e.target.value.split('x').map(Number); setParameters(p => ({ ...p, width, height })); }}><option value="768x512">Landscape · 3:2</option><option value="512x768">Portrait · 2:3</option><option value="512x512">Square · 1:1</option></select></label>
              <label>Clip length<select aria-label="Clip length" value={parameters.frames} onChange={e => update('frames', Number(e.target.value))}>{[49, 81, 97, 121].map(frames => <option value={frames} key={frames}>{(frames / parameters.fps).toFixed(1)} seconds · {frames}f</option>)}</select></label>
            </div>
            <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><Settings2 size={13} /> Advanced settings <ChevronDown size={14} className={advanced ? 'rotated' : ''} /></button>
            {advanced && <div className="advanced-fields">
              <label htmlFor="negative">Negative prompt</label><textarea id="negative" rows={2} placeholder="What should stay out of the scene?" value={parameters.negativePrompt} onChange={e => update('negativePrompt', e.target.value)} maxLength={2000} />
              <div className="field-grid"><NumberField label="Sampling steps" value={parameters.steps} min={1} max={60} onChange={v => update('steps', v)} /><NumberField label="Guidance" value={parameters.guidance} min={0} max={15} step={0.1} onChange={v => update('guidance', v)} /><NumberField label="Frames per second" value={parameters.fps} min={8} max={30} onChange={v => update('fps', v)} /><NumberField label="Seed (-1 = random)" value={parameters.seed} min={-1} max={2147483647} onChange={v => update('seed', v)} /></div>
              <p className="fine-print">Conservative UI presets, not certified Mac settings. Your ComfyUI workflow must accept these dimensions and frame counts.</p>
            </div>}
            <button className="generate-button" disabled={busy || !bootstrap || !!pollError || download?.status !== 'ready' || active.length >= 3} onClick={() => void generate()}>{busy ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{busy ? 'Adding to queue…' : mock ? 'Generate mock scene' : 'Generate video'}<span><ArrowRight size={17} /></span></button>
            <div className="generation-footnote"><ShieldCheck size={12} />{mock ? 'No model needed. No weights downloaded.' : 'Runs on your local ComfyUI instance.'}</div>
          </section>
          <div className="preview-column">
            <section className="preview-panel panel">
              <div className="preview-heading"><div><span className="live-square" /> <h2>Scene preview</h2></div><span className="subtle-pill">{selectedJob ? selectedJob.runtime === 'mock' ? 'MOCK STORYBOARD' : selectedJob.status.toUpperCase() : 'CONCEPT PREVIEW'}</span></div>
              <div className="preview-stage">
                {selectedJob?.output ? <video key={selectedJob.id} controls src={`/api/jobs/${selectedJob.id}/video`} onError={() => setError('Video playback failed. Check ComfyUI and the output codec.')} /> : <><Landscape /><div className="poster-topline"><span>LEHT FRAME ORIGINAL CONCEPT</span><span>01 / 01</span></div><div className="poster-caption"><span className="poster-line" /><small>THE QUIET BETWEEN</small><h2>A world, waiting<br />to be imagined.</h2><span>DESERT STUDY &nbsp; / &nbsp; LIGHT & MOTION</span></div><span className="illustration-label">Illustration · not generated footage</span></>}
                {selectedJob && ['queued', 'running'].includes(selectedJob.status) && <div className="render-overlay"><LoaderCircle size={30} className="spin" /><strong>{selectedJob.runtime === 'mock' ? 'Imagining your mock scene' : 'Rendering with ComfyUI'}</strong><span>{selectedJob.progress}%</span><div className="progress-track"><span style={{ width: `${selectedJob.progress}%` }} /></div></div>}
              </div>
              <div className="preview-footer"><div><span className="status-dot accent" /><span>{selectedJob ? selectedJob.message : 'Your next scene starts with a few words.'}</span></div>{selectedJob?.status === 'completed' && <a className="icon-button" href={`/api/jobs/${selectedJob.id}/${selectedJob.output ? 'video' : 'recipe'}`} download aria-label={selectedJob.output ? 'Download video' : 'Download mock recipe'}><ArrowDownToLine size={17} /></a>}</div>
            </section>
            <div className="mock-notice"><span className="notice-icon"><Sparkles size={18} /></span><div><strong>{mock ? 'All the possibilities. None of the setup.' : 'Your machine is the render farm.'}</strong><p>{mock ? 'You’re in mock mode. Explore the complete workflow without downloading a single model. Mock results are recipes and storyboards, not videos.' : 'Weights, workflows, and generation stay on this computer. Large models may exceed available unified memory.'} <button className="text-button" onClick={() => setPage('setup')}>Setup guide <ArrowRight size={12} /></button></p></div></div>
            <section className="queue-section"><div className="queue-title"><h2>Recent generations <span>{jobs.length.toString().padStart(2, '0')}</span></h2><button className="text-button" onClick={() => setPage('library')}>View library <ArrowRight size={13} /></button></div>
              {!jobs.length ? <div className="empty-queue"><span><Clapperboard size={22} /></span><div><strong>A clean slate. A thousand possibilities.</strong><p>Your generations will appear here. Make your first scene.</p></div></div> : <div className="job-list">{jobs.slice(0, 3).map(job => <JobRow key={job.id} job={job} selected={job.id === selectedJob?.id} onClick={() => setSelectedJobId(job.id)} />)}</div>}
            </section>
            <div className="bottom-note"><ShieldCheck size={13} /><span>No cloud rendering. No API credits. Just your creativity.</span><span className="note-line" /></div>
          </div>
        </div>}
        {page === 'models' && <><div className="info-banner"><Cpu size={20} /><div><strong>Apple Silicon, with realistic expectations.</strong><p>M5 Pro / Max is a target, not a tested hardware certification. Unified memory, precision support, and workflow nodes determine what will run. Start small and verify in ComfyUI first.</p></div></div><div className="catalog-grid">{(bootstrap?.models ?? []).map(model => <section key={model.id} className="panel catalog-card"><div className="catalog-title"><span className="model-symbol">{model.id === 'ltx-2.5' ? <Aperture /> : <Layers3 />}</span><div><h2>{model.name}</h2><span>{model.variant}</span></div><span className="subtle-pill">{mock ? 'MOCK' : 'COMFYUI'}</span></div><p>{model.description}</p><div className="capability-tags">{model.modes.map(mode => <span key={mode}>{modeNames[mode]}</span>)}</div><p className="model-warning">{model.warning}</p><a className="text-button" href={model.source} target="_blank" rel="noreferrer">Official workflow & license information <ArrowRight size={13} /></a><div className="catalog-download"><strong>{model.download.status === 'ready' ? mock ? 'Mock ready' : 'Weights present' : model.download.status === 'downloading' ? `${model.download.progress}%` : model.download.status === 'failed' ? 'Download failed' : 'Not downloaded'}</strong><p>{model.download.message}</p>{model.download.status === 'downloading' ? <div className="progress-track"><span style={{ width: `${model.download.progress}%` }} /></div> : model.download.status === 'ready' ? <button className="secondary-button" onClick={() => { selectModel(model.id); setPage('create'); }}>Use model <ArrowRight size={15} /></button> : <button className="secondary-button" disabled={!bootstrap?.downloadsEnabled || !!downloadBusy} onClick={() => void startDownload(model.id)}><ArrowDownToLine size={15} />{mock ? 'Prepare mock model' : 'Download weights'}</button>}</div></section>)}</div>{!bootstrap?.downloadsEnabled && <p className="fine-print">Downloads are locked. Configure COMFYUI_ROOT and ALLOW_MODEL_DOWNLOADS on the server; see the setup guide.</p>}</>}
        {page === 'library' && <section className="panel library-panel"><div className="queue-title"><h2>All generations <span>{jobs.length}</span></h2><span className="fine-print">Most recent 100 · stored locally</span></div>{!jobs.length ? <div className="library-empty"><FolderOpen size={38} /><h2>Your story starts here.</h2><p>No generations yet. Try a mock scene first.</p><button className="secondary-button" onClick={() => setPage('create')}>Create a scene <ArrowRight size={15} /></button></div> : jobs.map(job => <div className="library-row" key={job.id}><JobRow job={job} onClick={() => { setSelectedJobId(job.id); setPage('create'); }} /><button className="text-button" onClick={() => reuse(job)}>Reuse settings</button><a className="icon-button" href={`/api/jobs/${job.id}/recipe`} download aria-label="Download recipe"><ArrowDownToLine size={17} /></a></div>)}</section>}
        {page === 'setup' && <div className="setup-grid"><section className="panel setup-card"><span className="subtle-pill">START HERE</span><h2>Your first scene, in three steps.</h2><ol className="setup-steps"><li><strong>Start the studio</strong><p>Install Node.js 22.18+ (Node 24 LTS recommended), open this project in Terminal, then run:</p><pre>npm ci{'\n'}npm run dev</pre><p>Open <a href="http://127.0.0.1:5173">127.0.0.1:5173</a>. Mock mode is on by default.</p></li><li><strong>Prepare a mock model</strong><p>Choose LTX 2.5 or Wan 2.2, then click Prepare. This simulates a download; it does not fetch any weights.</p></li><li><strong>Describe, generate, explore</strong><p>Write a prompt, optionally add reference images, and generate. Export the recipe from the library. Mock mode never creates an AI video.</p></li></ol></section><section className="panel setup-card"><span className="subtle-pill">WHEN YOU’RE READY</span><h2>Connect your own ComfyUI.</h2><p>ComfyUI is free, open-source software. Its cloud service is optional and is not used by this app.</p><ol className="setup-steps"><li><strong>Install ComfyUI for Apple Silicon</strong><p>Use the official Mac desktop installer. Test your chosen model’s template on your machine first. RAM and model precision matter more than the chip’s name.</p><a className="text-button" href="https://www.comfy.org/download" target="_blank" rel="noreferrer">Get ComfyUI <ArrowRight size={13} /></a></li><li><strong>Configure the local backend</strong><p>Copy .env.example to .env, set RUNTIME=comfyui, COMFYUI_URL, and COMFYUI_ROOT. Enable downloads explicitly; keep Hugging Face tokens server-side. LTX needs license approval.</p></li><li><strong>Export and bind your workflow</strong><p>Export an API-format graph from ComfyUI for each model and input mode. Add its input bindings following the project README. This step is required; the studio does not invent model graphs.</p></li><li><strong>Download, then generate</strong><p>Restart the studio. Download weights from Models after checking disk space, license, and MPS compatibility. The backend streams weights into ComfyUI’s model folders.</p></li></ol><div className="setup-warning"><CircleHelp size={18} /><p>Ollama is not used for video diffusion. vLLM-Omni has video pipelines, but this package targets ComfyUI for Mac. Real inference has not been tested on an M5.</p></div></section></div>}
        <footer className="page-footer"><span>MADE FOR THE WAY YOU IMAGINE.</span><span>Private by design. Local by choice.</span></footer>
      </main>
    </div>
    {confirmation && <div className="modal-backdrop" onClick={() => setConfirmation(undefined)}><section ref={downloadDialog} role="dialog" aria-modal="true" aria-labelledby="download-title" className="download-modal panel" onClick={e => e.stopPropagation()}><button className="icon-button modal-close" aria-label="Close download confirmation" onClick={() => setConfirmation(undefined)}><X size={20} /></button><ArrowDownToLine size={26} /><h2 id="download-title">Download {models.find(m => m.id === confirmation)?.name}?</h2><p>This downloads multiple large weight files from Hugging Face, potentially tens of gigabytes. Exact total size is not precomputed. Check free disk space and your network before continuing.</p><p>{models.find(m => m.id === confirmation)?.warning}</p><p>These are the official ComfyUI example checkpoints, not Mac-certified builds. Downloading them does not ensure they will run on your Mac.</p><label className="checkbox-row"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I have checked the license, available storage, and a working MPS workflow.</label><button className="generate-button" disabled={!acknowledged || !!downloadBusy} onClick={() => void startDownload(confirmation)}>{downloadBusy ? 'Starting…' : 'Confirm & download'}<ArrowDownToLine size={17} /></button></section></div>}
  </div>;
}

function NavButton({ label, active, icon, children, onClick }: { label: string; active: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return <button aria-label={label} className={`nav-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{children}</span></button>;
}
function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" value={Number.isNaN(value) ? '' : value} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} /></label>;
}
function JobRow({ job, selected, onClick }: { job: Job; selected?: boolean; onClick: () => void }) {
  return <button className={`job-row ${selected ? 'selected' : ''}`} onClick={onClick}><span className={`job-thumbnail ${job.status === 'failed' ? 'failed' : ''}`}>{job.status === 'running' || job.status === 'queued' ? <LoaderCircle className="spin" size={20} /> : job.status === 'failed' ? <X size={20} /> : <Film size={20} />}</span><span className="job-description"><strong>{job.parameters.prompt}</strong><small>{models.find(m => m.id === job.parameters.modelId)?.name} <span>·</span> {(job.parameters.frames / job.parameters.fps).toFixed(1)}s <span>·</span> {job.runtime === 'mock' ? 'Mock' : 'Local render'}</small></span><span className={`job-status ${job.status}`} title={job.message}>{job.status === 'completed' ? <Check size={12} /> : <Clock3 size={12} />}{job.status === 'running' ? `${job.progress}%` : job.status}</span></button>;
}
