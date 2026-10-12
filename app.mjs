import { detectHighlights, formatTime, makeComment } from './detector.mjs';
import { initMontageEditor, updateMontageEditor } from './montage-ui.mjs?v=20261012-fix1';

const $ = id => document.getElementById(id);
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const state = {
  file: null, objectUrl: null, duration: 0, bins: null, candidates: [],
  sensitivity: 'normal', leadSeconds: 7, maxResults: 8,
  working: false, cancelled: false
};
const STEP = .25;
let activeInlineClose = null;
function closeInlinePreview() { if (activeInlineClose) { const fn = activeInlineClose; activeInlineClose = null; fn(); } }
function error(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}
function progress(message, value) {
  $('progressArea').hidden = false;
  $('progressLabel').textContent = message;
  const percentage = Math.max(0, Math.min(100, Math.round(value || 0)));
  $('progressPercent').textContent = percentage + '%';
  $('progressBar').style.width = percentage + '%';
}
function busy(value) {
  state.working = value;
  $('fileInput').disabled = value;
  $('changeFile').disabled = value;
  $('analyzeButton').disabled = value || !state.file;
  $('analyzeButton').textContent = value ? '音声を解析中…' : '⌁　音声を解析する　→';
  $('cancelButton').hidden = !value;
}
function chooseFile(file) {
  if (!file || state.working) return;
  closeInlinePreview();
  state.cancelled = true;
  const video = $('preview');
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.file = file;
  state.objectUrl = URL.createObjectURL(file);
  state.duration = 0;
  state.bins = null;
  state.candidates = [];
  $('fileName').textContent = file.name;
  $('fileSize').textContent = (file.size / 1048576).toFixed(1) + ' MB · ' + (file.type || '動画 / 音声');
  $('fileDetails').hidden = false;
  $('uploadZone').hidden = true;
  video.src = state.objectUrl;
  $('videoWrapper').hidden = false;
  $('resultsPanel').hidden = true;
  updateMontageEditor(state);
  $('progressArea').hidden = true;
  error('analysisError', '');
  error('loadError', '');
  $('analyzeButton').disabled = false;
  video.onloadedmetadata = () => {
    if (Number.isFinite(video.duration)) state.duration = video.duration;
  };
}
$('fileInput').addEventListener('change', e => chooseFile(e.target.files && e.target.files[0]));
$('changeFile').addEventListener('click', () => $('fileInput').click());

async function decodeStreaming(file, update, check) {
  const { Input, BlobSource, ALL_FORMATS, AudioSampleSink } = await import(
    'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs'
  );
  check();
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024 })
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw Error('動画に音声トラックがありません');
    if (!await track.canDecode()) throw Error('この音声形式はブラウザでデコードできません');
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw Error('動画の長さを取得できません');
    check();
    const energy = [];
    const count = [];
    const sink = new AudioSampleSink(track);
    let lastDraw = 0;
    for await (const sample of sink.samples()) {
      try {
        check();
        const channels = sample.numberOfChannels;
        const rate = sample.sampleRate;
        const floats = new Float32Array(sample.allocationSize({ planeIndex: 0, format: 'f32' }) / 4);
        sample.copyTo(floats, { planeIndex: 0, format: 'f32' });
        for (let f = 0; f < sample.numberOfFrames; f += 4) {
          const seconds = sample.timestamp + f / rate;
          if (seconds < 0 || seconds >= duration + 1) continue;
          const i = Math.floor(seconds / STEP);
          let p = 0;
          for (let ch = 0; ch < channels; ch++) {
            const v = floats[f * channels + ch] || 0;
            p += v * v;
          }
          energy[i] = (energy[i] || 0) + p / channels;
          count[i] = (count[i] || 0) + 1;
        }
        if (performance.now() - lastDraw > 180) {
          update('音声のピークを解析中', Math.min(99, 100 * (sample.timestamp + sample.duration) / duration));
          lastDraw = performance.now();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } finally { sample.close(); }
    }
    check();
    return {
      duration,
      bins: Array.from({ length: Math.ceil(duration / STEP) }, (_, i) => ({
        time: i * STEP, rms: Math.sqrt((energy[i] || 0) / Math.max(1, count[i] || 0))
      }))
    };
  } finally { input.dispose(); }
}

async function decodeSmallAudio(file, update, check) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw Error('Web Audio APIが利用できません');
  const ctx = new Context();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const energy = [], count = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const samples = buffer.getChannelData(ch);
      for (let i = 0; i < samples.length; i += 2) {
        if (i % 65536 === 0) check();
        const bin = Math.floor(i / buffer.sampleRate / STEP);
        energy[bin] = (energy[bin] || 0) + samples[i] ** 2;
        count[bin] = (count[bin] || 0) + 1;
      }
      update('音声を解析中', (ch + 1) / buffer.numberOfChannels * 96);
    }
    return {
      duration: buffer.duration,
      bins: Array.from({ length: Math.ceil(buffer.duration / STEP) }, (_, i) => ({
        time: i * STEP, rms: Math.sqrt((energy[i] || 0) / Math.max(1, count[i] || 0))
      }))
    };
  } finally { await ctx.close(); }
}

$('cancelButton').addEventListener('click', () => { state.cancelled = true; });
$('analyzeButton').addEventListener('click', async () => {
  if (!state.file || state.working) return;
  state.cancelled = false;
  busy(true);
  error('analysisError', '');
  $('resultsPanel').hidden = true;
  const abort = () => {
    if (state.cancelled) throw Error('解析を中止しました');
  };
  try {
    progress('音声ライブラリを準備中', 1);
    let result;
    try {
      result = await decodeStreaming(state.file, progress, abort);
    } catch (e) {
      if (state.cancelled) throw e;
      const name = state.file.name || '';
      const audio = /^audio\//.test(state.file.type) || /\.(wav|mp3|aac|m4a)$/i.test(name);
      if (!audio || state.file.size > 30 * 1048576) throw e;
      progress('音声ファイルを読み込み中', 5);
      result = await decodeSmallAudio(state.file, progress, abort);
    }
    abort();
    state.duration = result.duration;
    state.bins = result.bins;
    progress('ハイライト候補を抽出中', 100);
    rebuild();
    $('resultsPanel').hidden = false;
    $('resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    error('analysisError', message === '解析を中止しました' ? message :
      '解析できませんでした: ' + message + '。AAC音声付きのMP4/MOVでお試しください。');
  } finally {
    busy(false);
    $('progressArea').hidden = true;
  }
});
function rebuild() {
  if (!state.bins) return;
  state.candidates = detectHighlights(state.bins, {
    sensitivity: state.sensitivity, leadSeconds: state.leadSeconds,
    maxResults: state.maxResults, binSeconds: STEP
  });
  drawResults();
}
document.querySelectorAll('[data-sensitivity]').forEach(button => {
  button.addEventListener('click', () => {
    state.sensitivity = button.dataset.sensitivity;
    document.querySelectorAll('[data-sensitivity]').forEach(item => {
      const active = button === item;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    rebuild();
  });
});
for (const [slider, display, key, suffix] of [
  ['leadInput','leadValue','leadSeconds','秒'],
  ['maxInput','maxValue','maxResults','件']
]) {
  $(slider).addEventListener('input', () => {
    state[key] = Number($(slider).value);
    $(display).textContent = state[key] + suffix;
    rebuild();
  });
}
function parseTime(value) {
  const parts = value.trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 ||
      parts.some(n => !Number.isInteger(n) || n < 0) ||
      parts.slice(1).some(n => n > 59)) return null;
  return parts.reduce((s,n) => s * 60 + n, 0);
}
function row(item, index) {
  const entry = make('div', 'highlight-entry');
  const wrap = make('div','highlight-item');
  const inline = make('div', 'inline-preview');
  inline.hidden = true;
  const badge = make('span', 'selection-label', item.enabled ? '採用' : '除外');
  const number = make('span', 'scene-number', String(index + 1).padStart(2, '0'));
  const applySelection = () => {
    entry.classList.toggle('is-selected', !!item.enabled);
    entry.classList.toggle('is-excluded', !item.enabled);
    badge.textContent = item.enabled ? '採用' : '除外';
    badge.classList.toggle('excluded', !item.enabled);
  };
  const enabled = make('input','highlight-checkbox');
  enabled.type = 'checkbox';
  enabled.checked = item.enabled;
  enabled.setAttribute('aria-label', 'シーン ' + (index + 1) + ' を採用');
  enabled.addEventListener('change', () => {
    item.enabled = enabled.checked;
    applySelection();
    refreshComment();
  });
  const play = make('button','play-btn','▶ 確認');
  play.type = 'button';
  play.title = 'この場面を下に表示して再生';
  const close = () => {
    const media = inline.querySelector('video');
    if (media) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    inline.replaceChildren();
    inline.hidden = true;
    play.textContent = '▶ 確認';
    entry.classList.remove('preview-active');
  };
  play.addEventListener('click', () => {
    if (activeInlineClose === close) {
      closeInlinePreview();
      return;
    }
    closeInlinePreview();
    $('preview').pause();
    const video = document.createElement('video');
    video.className = 'inline-player';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = state.objectUrl;
    const label = make('p', 'inline-caption', 'シーン ' + (index + 1) + '｜' + formatTime(item.time) + ' から再生（終わったら下の一覧で次を選べます）');
    inline.replaceChildren(label, video);
    inline.hidden = false;
    entry.classList.add('preview-active');
    play.textContent = '× 閉じる';
    activeInlineClose = close;
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.max(0, Math.min(item.time, video.duration || item.time));
      video.play().catch(() => { /* Safari may require a second tap */ });
    }, { once: true });
    video.load();
    inline.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  const fields = make('div','item-fields');
  const timeRow = make('div','time-row');
  const time = make('input','time-input');
  time.type = 'text';
  time.value = formatTime(item.time);
  time.setAttribute('aria-label','タイムスタンプ');
  time.addEventListener('change', () => {
    const seconds = parseTime(time.value);
    if (seconds === null || seconds > state.duration) {
      time.value = formatTime(item.time);
    } else {
      item.time = seconds;
      refreshComment();
    }
  });
  timeRow.append(number, time, badge);
  const score = make('span','score', 'ピーク ' + Math.round(item.peakSeconds) + '秒 / ' + item.db + 'dBFS');
  const title = make('input','title-input');
  title.type = 'text';
  title.value = item.title;
  title.maxLength = 100;
  title.setAttribute('aria-label','シーンの説明');
  title.addEventListener('input', () => { item.title = title.value; refreshComment(); });
  fields.append(timeRow, title, score);
  const remove = make('button','delete-btn','×');
  remove.type = 'button';
  remove.title = '候補を削除';
  remove.addEventListener('click', () => {
    if (activeInlineClose === close) closeInlinePreview();
    state.candidates = state.candidates.filter(x => x !== item);
    drawResults();
  });
  wrap.append(enabled, play, fields, remove);
  entry.append(wrap, inline);
  applySelection();
  return entry;
}
function refreshComment() {
  $('commentText').value = makeComment(state.candidates);
  const selected = state.candidates.filter(item => item.enabled);
  $('selectedCount').textContent = String(selected.length);
  const summary = $('selectedSummary');
  summary.replaceChildren(...selected.map((item, i) => make('span', 'selected-chip',
    String(i + 1) + '. ' + formatTime(item.time) + ' ' + (item.title || 'Highlight'))));
  summary.hidden = selected.length === 0;
  updateMontageEditor(state);
}
function drawResults() {
  closeInlinePreview();
  $('highlightList').replaceChildren(...state.candidates.map(row));
  $('resultCount').textContent = String(state.candidates.length);
  $('emptyResults').hidden = state.candidates.length > 0;
  $('waveEnd').textContent = formatTime(state.duration);
  refreshComment();
  requestAnimationFrame(drawWave);
}
function drawWave() {
  const canvas = $('waveCanvas');
  if (!state.bins || !canvas.getClientRects().length) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext('2d');
  context.scale(dpr, dpr);
  context.strokeStyle = '#35526a';
  context.beginPath(); context.moveTo(0, height / 2);
  context.lineTo(width, height / 2); context.stroke();
  const bins = state.bins;
  const max = bins.reduce((v,b) => Math.max(v, b.rms), .015);
  for (let x = 0; x < width; x += 2) {
    const start = Math.floor(x / width * bins.length);
    const end = Math.min(bins.length, Math.ceil((x + 2) / width * bins.length));
    let loudest = 0;
    for (let i = start; i < end; i++) loudest = Math.max(loudest,bins[i].rms);
    const h = Math.min(height * .44, (loudest / max) * height * .43 + 1);
    context.strokeStyle = '#47aac1';
    context.lineWidth = 1.7;
    context.beginPath(); context.moveTo(x,height/2-h);
    context.lineTo(x,height/2+h); context.stroke();
  }
  for (const item of state.candidates) {
    const x = item.peakSeconds / Math.max(1,state.duration) * width;
    context.strokeStyle = '#ffb773';
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(x,7); context.lineTo(x,height-7); context.stroke();
  }
}
window.addEventListener('resize', () => { if (state.bins) requestAnimationFrame(drawWave); });
$('waveCanvas').addEventListener('click', e => {
  if (!state.bins) return;
  const r = $('waveCanvas').getBoundingClientRect();
  $('preview').currentTime = Math.max(0, Math.min(state.duration,
    (e.clientX - r.left) / r.width * state.duration));
  $('preview').scrollIntoView({ behavior: 'smooth', block:'center' });
});
$('copyButton').addEventListener('click', async () => {
  const comment = $('commentText').value;
  if (!comment.trim()) {
    $('copyStatus').textContent = 'コピーする候補がありません';
    return;
  }
  try {
    if (navigator.clipboard && isSecureContext) {
      await navigator.clipboard.writeText(comment);
    } else {
      $('commentText').focus();
      $('commentText').select();
      if (!document.execCommand('copy')) throw Error('unsupported');
    }
    $('copyStatus').textContent = 'コピーしました。YouTubeのコメント欄に貼り付けてください。';
  } catch {
    $('commentText').focus();
    $('commentText').select();
    $('copyStatus').textContent = 'テキストを選択しました。コピーしてください。';
  }
});

initMontageEditor(state);
