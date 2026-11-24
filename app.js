// LWACNet browser client. Never fabricates crowd counts or density predictions.
const $ = (id) => document.getElementById(id);
const state = {
  file: null,
  previewUrl: null,
  condition: 'original',
  prediction: null,
  preparedDataUrl: null,
  busy: false,
  kind: 'image',
  videoSamples: [],
  videoSelected: -1,
  videoPreviewReady: false,
  analysisController: null,
};

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const format = (n) => numberFormat.format(n);
const peopleFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const displayPeople = (n) => peopleFormat.format(Math.max(0, Math.round(Number(n) || 0)));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Minimal responsive navigation.
const menu = $('menu-toggle');
const nav = $('site-nav');
menu.addEventListener('click', () => {
  const isOpen = nav.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(isOpen));
  menu.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
});
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menu.setAttribute('aria-expanded', 'false');
}));

const dropzone = $('dropzone');
const imageInput = $('image-file');
const cameraInput = $('camera-file');
const feedback = $('inline-feedback');

function setFeedback(message = '', isError = false) {
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle('error', isError);
}

function resetResults() {
  state.prediction = null;
  $('results').hidden = true;
  $('video-report').hidden = true;
  state.videoSamples = [];
  state.videoSelected = -1;
  $('metric-count-title').textContent = 'Estimated people';
}

function selectImage(file) {
  if (!file) return;
  if (state.busy) { setFeedback('Stop the current analysis before choosing another file.', true); return; }
  const videoFile = file.type === 'video/mp4' || file.type === 'video/webm' || /\.(mp4|webm)$/i.test(file.name);
  if (videoFile) {
    if (file.size > 500 * 1024 * 1024) {
      setFeedback('Video must be smaller than 500 MB. The file remains on your device.', true);
      return;
    }
  } else {
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/bmp']);
    if (!allowed.has(file.type)) { setFeedback('Choose a JPG, PNG, WebP, BMP image or an MP4/WebM video.', true); return; }
    if (file.size > 12 * 1024 * 1024) { setFeedback('Image exceeds the 12 MB limit.', true); return; }
  }
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  const player = $('video-preview');
  player.pause();
  player.removeAttribute('src');
  player.load();
  state.file = file;
  state.kind = videoFile ? 'video' : 'image';
  state.previewUrl = URL.createObjectURL(file);
  $('upload-preview').hidden = videoFile;
  player.hidden = !videoFile;
  $('video-options').hidden = !videoFile;
  if (videoFile) {
    player.src = state.previewUrl;
    player.load();
  } else {
    $('upload-preview').src = state.previewUrl;
  }
  $('upload-empty').hidden = true;
  $('replace-image').hidden = false;
  $('file-name').textContent = file.name;
  $('run-analysis').disabled = false;
  $('studio-helper').textContent = videoFile
    ? 'MP4 ready. Each sampled video frame will be counted by the actual LWACNet model.'
    : 'Ready to process a scene with LWACNet. The site uses only actual model output.';
  setFeedback();
  resetResults();
}

imageInput.addEventListener('change', () => {
  selectImage(imageInput.files?.[0]);
  imageInput.value = '';
});
cameraInput.addEventListener('change', () => {
  selectImage(cameraInput.files?.[0]);
  cameraInput.value = '';
});
$('camera-button').addEventListener('click', () => cameraInput.click());
$('replace-image').addEventListener('click', (event) => { event.stopPropagation(); imageInput.click(); });
dropzone.addEventListener('click', (event) => {
  if (event.target !== imageInput && !event.target.closest('video, button, input, select')) imageInput.click();
});
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    imageInput.click();
  }
});
['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.add('dragging');
}));
['dragleave', 'dragend'].forEach((name) => dropzone.addEventListener(name, () => dropzone.classList.remove('dragging')));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
  selectImage(event.dataTransfer?.files?.[0]);
});

// Image degradation controls reproduce basic low-resolution, blur and JPEG stress conditions.
document.querySelectorAll('.condition').forEach((button) => button.addEventListener('click', () => {
  state.condition = button.dataset.condition;
  document.querySelectorAll('.condition').forEach((node) => {
    const active = node === button;
    node.classList.toggle('active', active);
    node.setAttribute('aria-pressed', String(active));
  });
  resetResults();
  setFeedback();
}));

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the selected image.'));
    img.src = url;
  });
}

// Limits request JSON to comfortably below the standard Vercel Function payload cap.
async function prepareImage() {
  if (!state.previewUrl) throw new Error('Select an image before analyzing.');
  const image = await imageFromUrl(state.previewUrl);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not supported in this browser.');
  const condition = state.condition;
  if (condition === 'blur') {
    ctx.filter = 'blur(2.5px)';
    ctx.drawImage(image, 0, 0, width, height);
    ctx.filter = 'none';
  } else if (condition === 'lowres') {
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(width / 4));
    small.height = Math.max(1, Math.round(height / 4));
    small.getContext('2d').drawImage(image, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, width, height);
  } else {
    ctx.drawImage(image, 0, 0, width, height);
  }
  let quality = condition === 'jpeg' ? 0.27 : 0.86;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > 3_200_000 && quality > 0.35) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length > 3_200_000) {
    throw new Error('This image is too large to analyze. Try a smaller image.');
  }
  return dataUrl;
}

let countAnimation = 0;
function animateCount(raw) {
  cancelAnimationFrame(countAnimation);
  const final = Math.max(0, Math.round(Number(raw) || 0));
  const field = $('metric-count');
  if (reduceMotion.matches || final === 0) { field.textContent = displayPeople(final); return; }
  const startedAt = performance.now();
  const duration = 480;
  const update = (time) => {
    const progress = Math.min(1, (time - startedAt) / duration);
    const ease = 1 - Math.pow(1 - progress, 3);
    field.textContent = displayPeople(Math.round(final * ease));
    if (progress < 1) countAnimation = requestAnimationFrame(update);
    else field.textContent = displayPeople(final);
  };
  countAnimation = requestAnimationFrame(update);
}

function actionableServiceError(status, payload) {
  const detail = typeof payload?.detail === 'string' ? payload.detail : (typeof payload?.error === 'string' ? payload.error : '');
  if ([502, 503, 504].includes(status)) {
    return new Error(`The live model could not be reached (${status}). Keep FastAPI and ngrok running on your laptop; verify the public /health URL. Update LWACNET_BACKEND_URL in Vercel if your ngrok address changes.${detail ? ` Details: ${detail}` : ''}`);
  }
  return new Error(detail || `Inference request failed (${status}).`);
}

async function requestPrediction(dataUrl, filename, signal) {
  const response = await fetch('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl.split(',')[1], filename }),
    signal,
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw actionableServiceError(response.status, payload);
  if (!Number.isFinite(payload.count) || !Array.isArray(payload.grid) || payload.grid.length !== 8 || !payload.grid.every((row) => Array.isArray(row) && row.length === 8) || typeof payload.density_png !== 'string') {
    throw new Error('The model returned an unexpected response. Check the deployed FastAPI version.');
  }
  return payload;
}

async function runAnalysis() {
  if (!state.file || state.busy) return;
  if (state.kind === 'video') return runVideoAnalysis();
  state.busy = true;
  $('run-analysis').disabled = true;
  $('run-label').textContent = 'Analyzing image…';
  $('studio-helper').textContent = 'Processing the selected image.';
  setFeedback();
  resetResults();
  state.analysisController = new AbortController();
  try {
    const dataUrl = await prepareImage();
    const payload = await requestPrediction(dataUrl, state.file.name, state.analysisController.signal);
    state.prediction = payload;
    state.preparedDataUrl = dataUrl;
    await showResults(payload, dataUrl);
    $('studio-helper').textContent = 'Image analysis complete. The count and heatmap were returned by your actual LWACNet model.';
    $('results').hidden = false;
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('LWACNet analysis:', error);
      setFeedback(error?.message || 'Analysis could not be completed.', true);
    }
    $('studio-helper').textContent = 'Your image remains ready for another attempt.';
  } finally {
    state.busy = false;
    state.analysisController = null;
    $('run-analysis').disabled = !state.file;
    $('run-label').textContent = 'Run LWACNet analysis';
  }
}

function waitForVideoEvent(video, eventName, timeout = 18000) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      video.removeEventListener(eventName, onDone);
      video.removeEventListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onDone = () => finish();
    const onError = () => finish(new Error('The browser could not decode this video. Try an MP4 encoded with H.264 video.'));
    timer = setTimeout(() => finish(new Error('Video loading or seeking timed out. Try a shorter H.264 MP4.')), timeout);
    video.addEventListener(eventName, onDone, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function loadVideoForFrames(src) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = src;
  const load = waitForVideoEvent(video, 'loadeddata');
  video.load();
  await load;
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
    throw new Error('Could not determine video duration. Please use a normal MP4 file rather than a live stream.');
  }
  return video;
}

async function prepareVideoFrame(video, time) {
  const safeTime = Math.max(0, Math.min(video.duration - 0.02, time));
  if (Math.abs(video.currentTime - safeTime) > 0.04 || video.readyState < 2) {
    const seeking = waitForVideoEvent(video, 'seeked');
    video.currentTime = safeTime;
    await seeking;
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const scale = Math.min(1, 1100 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas support is required for MP4 frame analysis.');
  if (state.condition === 'blur') {
    ctx.filter = 'blur(2.5px)';
    ctx.drawImage(video, 0, 0, width, height);
    ctx.filter = 'none';
  } else if (state.condition === 'lowres') {
    const reduced = document.createElement('canvas');
    reduced.width = Math.max(1, Math.round(width / 4));
    reduced.height = Math.max(1, Math.round(height / 4));
    reduced.getContext('2d').drawImage(video, 0, 0, reduced.width, reduced.height);
    ctx.drawImage(reduced, 0, 0, width, height);
  } else ctx.drawImage(video, 0, 0, width, height);
  let q = state.condition === 'jpeg' ? .27 : .82;
  let out = canvas.toDataURL('image/jpeg', q);
  while (out.length > 3_000_000 && q > .37) {
    q -= .12;
    out = canvas.toDataURL('image/jpeg', q);
  }
  if (out.length > 3_000_000) throw new Error('Video frame is too large for the gateway.');
  return out;
}

function timeLabel(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}

function refreshVideoReport() {
  const samples = state.videoSamples;
  $('video-report').hidden = !samples.length;
  if (!samples.length) return;
  const counts = samples.map((sample) => sample.prediction.count);
  const average = counts.reduce((sum, value) => sum + value, 0) / counts.length;
  $('video-average').textContent = displayPeople(average);
  $('video-peak').textContent = displayPeople(Math.max(...counts));
  $('video-frames').textContent = String(samples.length);
  const width = 840; const height = 145;
  const max = Math.max(1, ...counts) * 1.16;
  const count = Math.max(1, samples.length - 1);
  const points = counts.map((value, i) => ({ x: 35 + (i / count) * 770, y: 116 - (value / max) * 96 }));
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const baseline = '<path d="M35 116 H810" stroke="#d5e5dc" stroke-width="1"/>';
  const dots = points.map((point, i) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${i === state.videoSelected ? 6 : 4}" fill="${i === state.videoSelected ? '#d86c4c' : '#458770'}"/>`).join('');
  $('video-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Estimated people over ${samples.length} sampled frames"><path d="${path}" fill="none" stroke="#4d9077" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${baseline}${dots}<text x="35" y="137">${timeLabel(samples[0].time)}</text><text x="810" y="137" text-anchor="end">${timeLabel(samples.at(-1).time)}</text></svg>`;
  const strip = $('video-frame-strip');
  strip.replaceChildren();
  samples.forEach((sample, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = i === state.videoSelected ? 'video-frame-choice selected' : 'video-frame-choice';
    button.textContent = `${timeLabel(sample.time)} · ${displayPeople(sample.prediction.count)} people`;
    button.setAttribute('aria-pressed', String(i === state.videoSelected));
    button.addEventListener('click', () => {
      const video = $('video-preview');
      video.currentTime = sample.time;
      void displayVideoSample(i);
    });
    strip.append(button);
  });
}

async function displayVideoSample(index) {
  if (index < 0 || index >= state.videoSamples.length) return;
  if (index === state.videoSelected && state.prediction) return;
  state.videoSelected = index;
  const sample = state.videoSamples[index];
  state.prediction = sample.prediction;
  state.preparedDataUrl = sample.dataUrl;
  $('metric-count-title').textContent = `People at ${timeLabel(sample.time)}`;
  await showResults(sample.prediction, sample.dataUrl);
  refreshVideoReport();
}

$('video-preview').addEventListener('timeupdate', () => {
  if (state.kind !== 'video' || !state.videoSamples.length) return;
  const now = $('video-preview').currentTime;
  let closest = 0;
  for (let i = 1; i < state.videoSamples.length; i++) {
    if (Math.abs(state.videoSamples[i].time - now) < Math.abs(state.videoSamples[closest].time - now)) closest = i;
  }
  if (closest !== state.videoSelected) void displayVideoSample(closest);
});

async function runVideoAnalysis() {
  state.busy = true;
  state.analysisController = new AbortController();
  $('run-analysis').disabled = true;
  $('cancel-analysis').hidden = false;
  $('analysis-progress').hidden = false;
  $('run-label').textContent = 'Analyzing video frames…';
  resetResults();
  setFeedback();
  let decoder;
  try {
    decoder = await loadVideoForFrames(state.previewUrl);
    const spacing = Number($('video-sampling').value) || 2;
    const planned = Math.min(24, Math.max(1, Math.ceil(decoder.duration / spacing)));
    const start = Math.min(0.12, decoder.duration / 4);
    const end = Math.max(start, decoder.duration - 0.12);
    $('studio-helper').textContent = `Sampling ${planned} frames across ${timeLabel(decoder.duration)} of footage. Counting each frame with the real model.`;
    let failure = null;
    for (let i = 0; i < planned; i++) {
      if (state.analysisController.signal.aborted) break;
      const time = planned === 1 ? decoder.duration / 2 : start + (end - start) * i / (planned - 1);
      $('analysis-progress-fill').style.width = `${Math.round(100 * i / planned)}%`;
      $('analysis-progress-text').textContent = `Frame ${i + 1} of ${planned} · ${timeLabel(time)} · analyzing with LWACNet`;
      const dataUrl = await prepareVideoFrame(decoder, time);
      if (state.analysisController.signal.aborted) break;
      try {
        const prediction = await requestPrediction(dataUrl, `frame-${i + 1}.jpg`, state.analysisController.signal);
        const sample = { id: `video-${Date.now()}-${i}`, time, dataUrl, prediction };
        state.videoSamples.push(sample);
        await displayVideoSample(i);
        $('results').hidden = false;
      } catch (error) {
        if (error.name === 'AbortError') break;
        failure = error;
        break;
      }
    }
    $('analysis-progress-fill').style.width = '100%';
    const frames = state.videoSamples.length;
    if (failure) throw failure;
    if (!frames) {
      if (state.analysisController.signal.aborted) setFeedback('Video analysis stopped before any frames completed.');
      else throw new Error('Video did not produce any decoded frames. Try an H.264-encoded MP4.');
    } else {
      $('studio-helper').textContent = `Analyzed ${frames} video frame${frames === 1 ? '' : 's'} using your real LWACNet model. Select a sample to view its density map.`;
      if (state.analysisController.signal.aborted) setFeedback(`Stopped after ${frames} sampled frame${frames === 1 ? '' : 's'}. Completed results remain available.`);
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (error) {
    console.error('LWACNet video analysis:', error);
    setFeedback(`${error?.message || 'Video analysis failed.'}${state.videoSamples.length ? ` ${state.videoSamples.length} earlier frame(s) are still available.` : ''}`, true);
    $('studio-helper').textContent = 'The video remains ready for another attempt.';
  } finally {
    if (decoder) { decoder.pause(); decoder.removeAttribute('src'); decoder.load(); }
    state.busy = false;
    state.analysisController = null;
    $('cancel-analysis').hidden = true;
    $('analysis-progress').hidden = true;
    $('run-analysis').disabled = !state.file;
    $('run-label').textContent = 'Run LWACNet analysis';
  }
}

$('cancel-analysis').addEventListener('click', () => state.analysisController?.abort());

$('run-analysis').addEventListener('click', runAnalysis);

// Decode the exact grayscale density PNG returned by the trained FastAPI model.
// The backend normalizes each PNG to the maximum density for visual display;
// its count remains the numerical model output, NOT these 8-bit colors.
function densityColor(value) {
  const anchors = [
    [0.00, 17, 23, 45],
    [0.14, 54, 39, 93],
    [0.30, 111, 49, 133],
    [0.48, 174, 55, 111],
    [0.66, 229, 91, 72],
    [0.84, 251, 166, 70],
    [1.00, 255, 238, 152],
  ];
  const clamped = Math.max(0, Math.min(1, value));
  for (let i = 1; i < anchors.length; i++) {
    const hi = anchors[i];
    if (clamped <= hi[0]) {
      const lo = anchors[i - 1];
      const fraction = (clamped - lo[0]) / (hi[0] - lo[0]);
      return [1, 2, 3].map((k) => Math.round(lo[k] + (hi[k] - lo[k]) * fraction));
    }
  }
  return anchors[anchors.length - 1].slice(1);
}

async function renderDensityMaps(grayscaleDataUrl) {
  const input = await imageFromUrl(grayscaleDataUrl);
  if (!input.naturalWidth || !input.naturalHeight) throw new Error('Density map image is empty.');

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = input.naturalWidth;
  sampleCanvas.height = input.naturalHeight;
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sampleContext.drawImage(input, 0, 0);
  const gray = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;

  const heatCanvas = $('density-heatmap');
  heatCanvas.width = sampleCanvas.width;
  heatCanvas.height = sampleCanvas.height;
  const heatCtx = heatCanvas.getContext('2d');
  const heat = heatCtx.createImageData(sampleCanvas.width, sampleCanvas.height);
  for (let i = 0; i < gray.length; i += 4) {
    const relativeDensity = gray[i] / 255;
    const [r, g, b] = densityColor(relativeDensity);
    heat.data[i] = r;
    heat.data[i + 1] = g;
    heat.data[i + 2] = b;
    heat.data[i + 3] = 255;

  }
  heatCtx.putImageData(heat, 0, 0);
  $('map-dimensions').textContent = `${sampleCanvas.width} × ${sampleCanvas.height} DENSITY MAP`;
}

async function showResults(result, dataUrl) {
  animateCount(result.count);

  // This image is the exact prepared JPEG sent to the model gateway.
  // The standalone map corresponds to the backend's 256×256 density prediction.
  const image = $('result-image');
  image.src = dataUrl;
  await image.decode();
  await renderDensityMaps(result.density_png);
}

function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}
function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
$('export-json').addEventListener('click', () => {
  if (!state.prediction) return;
  downloadText(JSON.stringify({ filename: state.file.name, source_type: state.kind, condition: state.condition, generated_at: new Date().toISOString(), video_samples: state.kind === 'video' ? state.videoSamples.map(sample => ({ time_seconds: sample.time, count: sample.prediction.count, inference_ms: sample.prediction.inference_ms })) : undefined, ...state.prediction }, null, 2), 'lwacnet-analysis.json', 'application/json');
});
$('export-csv').addEventListener('click', () => {
  if (!state.prediction) return;
  if (state.kind === 'video') {
    const rows = ['time_seconds,estimated_people,inference_ms'];
    state.videoSamples.forEach(({time, prediction}) => rows.push(`${time.toFixed(3)},${prediction.count},${prediction.inference_ms}`));
    downloadText(rows.join('\n'), 'lwacnet-video-crowd-timeline.csv', 'text/csv');
  } else {
    const rows = ['filename,condition,estimated_people_raw,estimated_people_display,inference_ms'];
    rows.push(`${JSON.stringify(state.file.name)},${state.condition},${Number(state.prediction.count)},${Math.round(state.prediction.count)},${Number(state.prediction.inference_ms)}`);
    downloadText(rows.join('\n'), 'lwacnet-crowd-estimate.csv', 'text/csv');
  }
});
$('export-png').addEventListener('click', () => {
  if (!state.prediction) return;
  downloadUrl($('density-heatmap').toDataURL('image/png'), 'lwacnet-colorized-density-heatmap.png');
});

// Navigation is independent of backend status; checks are made only when needed.
window.addEventListener('beforeunload', () => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); });

$('export-raw').addEventListener('click', () => { if (state.prediction) downloadUrl(state.prediction.density_png, 'lwacnet-original-grayscale-density.png'); });


// Nonblocking status. Analysis always uses a real model call; no fake fallback.
(async () => {
  const badge = $('model-status');
  if (!badge) return;
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (response.ok && data.status === 'ready') badge.innerHTML = '<span></span> LIVE MODEL CONNECTED';
    else badge.textContent = 'IMAGE-BASED INFERENCE';
  } catch { badge.textContent = 'IMAGE-BASED INFERENCE'; }
})();


// Decorative motion stays on the webpage only and never touches model prediction values.
(() => {
  if (reduceMotion.matches) return;
  const photo = $('hero-photo');
  if (photo && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    photo.addEventListener('pointermove', (event) => {
      const box = photo.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5;
      const y = (event.clientY - box.top) / box.height - .5;
      photo.style.setProperty('--hero-ry', `${(x * 4.8).toFixed(2)}deg`);
      photo.style.setProperty('--hero-rx', `${(-y * 4).toFixed(2)}deg`);
    });
    photo.addEventListener('pointerleave', () => {
      photo.style.setProperty('--hero-ry', '0deg');
      photo.style.setProperty('--hero-rx', '0deg');
    });
  }
  if (!('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('motion-ready');
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: .07, rootMargin: '0px 0px 24px 0px' });
  document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
})();
