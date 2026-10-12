import { detectHighlights, formatTime, makeComment } from './detector.mjs';
import { initMontageEditor, updateMontageEditor } from './montage-ui.mjs?v=multi2';
import { buildMultiClipPlan, sourceTimestampComments } from './multi-plan.mjs?v=edit3';

const $ = id => document.getElementById(id);
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const state = {
  file: null, objectUrl: null, duration: 0, bins: null, candidates: [], sources: [],
  sensitivity: 'normal', leadSeconds: 7, maxResults: 8,
  working: false, cancelled: false, exporting: false
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
let nextSourceId = 0;
let appendOnPick = false;
function busy(value) {
  state.working = value;
  $('fileInput').disabled = value || state.exporting;
  $('changeFile').disabled = value || state.exporting;
  $('addFiles').disabled = value || state.exporting;
  $('analyzeButton').disabled = value || !state.sources.length;
  $('analyzeButton').textContent = value ? '音声を解析中…' : '⌁　音声を解析する　→';
  $('cancelButton').hidden = !value;
}
function syncSources() {
  closeInlinePreview();
  // Existing single-video controls still point to the first file.
  const first = state.sources[0] || null;
  state.file = first?.file || null;
  state.objectUrl = first?.objectUrl || null;
  let offset = 0;
  const bins = [];
  const candidates = [];
  for (const source of state.sources) {
    source.offset = offset;
    if (!source.bins) continue;
    bins.push(...source.bins);
    candidates.push(...source.candidates);
    offset += source.duration;
  }
  state.duration = offset;
  state.bins = bins.length ? bins : null;
  state.candidates = candidates;
  $('resultsPanel').hidden = !state.bins;
  $('multiWaveNotice').hidden = state.sources.length <= 1;
  $('commentHelp').hidden = state.sources.length <= 1;
  $('commentHeading').textContent = '動画ごとのYouTubeタイムスタンプ';
  if (state.bins) drawResults();
  else updateMontageEditor(state);
  renderSourceList();
}
function renderSourceList() {
  const sources = state.sources;
  $('fileDetails').hidden = sources.length === 0;
  $('sourceBoard').hidden = sources.length === 0;
  $('uploadZone').hidden = sources.length > 0;
  $('sourceCount').textContent = String(sources.length);
  $('fileName').textContent = sources.length + '本の動画を選択中';
  const megabytes = sources.reduce((n,s) => n + s.file.size,0)/1048576;
  $('fileSize').textContent = megabytes.toFixed(1) + ' MB 合計';
  $('analyzeButton').disabled = !sources.length || state.working || state.exporting;
  const preview = $('preview');
  const first = sources[0];
  if (first) {
    if (preview.src !== first.objectUrl) {
      preview.pause();
      preview.src = first.objectUrl;
      preview.load();
    }
    $('videoWrapper').hidden = false;
  } else {
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    $('videoWrapper').hidden = true;
  }
  const list = $('sourceList');
  list.replaceChildren(...sources.map((source, i) => {
    const card = make('div','source-item');
    const num = make('span','source-order',String(i + 1));
    const info = make('div','source-info');
    const filename = make('strong','',source.file.name);
    const status = source.error ? '解析失敗：' + source.error
      : source.bins ? '解析済み・候補 ' + source.candidates.length + '件'
      : '未解析';
    info.append(filename,make('small','',status));
    const controls = make('div','source-controls');
    const move = (label,diff) => {
      const button = make('button','source-control',label);
      button.type = 'button';
      button.disabled = state.working || state.exporting || i + diff < 0 || i + diff >= sources.length;
      button.addEventListener('click', () => {
        const other = i + diff;
        [sources[i],sources[other]]=[sources[other],sources[i]];
        syncSources();
      });
      controls.append(button);
    };
    move('↑',-1); move('↓',1);
    const del = make('button','source-control source-remove','×');
    del.type = 'button';
    del.disabled = state.working || state.exporting;
    del.setAttribute('aria-label',source.file.name+' を削除');
    del.addEventListener('click', () => {
      sources.splice(i,1);
      URL.revokeObjectURL(source.objectUrl);
      syncSources();
    });
    controls.append(del);
    card.append(num,info,controls);
    return card;
  }));
}
function chooseFiles(files, append = false) {
  if (state.working || state.exporting || !files?.length) return;
  const incoming = Array.from(files).filter(file => /\.(mp4|mov|m4v)$/i.test(file.name) ||
    /^video\//.test(file.type));
  if (!incoming.length) {
    error('loadError','動画ファイル（MOV / MP4）を選んでください。');
    return;
  }
  closeInlinePreview();
  if (!append) {
    state.sources.forEach(source => URL.revokeObjectURL(source.objectUrl));
    state.sources = [];
  }
  const seen = new Set(state.sources.map(s =>
    s.file.name + ':' + s.file.size + ':' + s.file.lastModified));
  let added = 0;
  for (const file of incoming) {
    const key = file.name + ':' + file.size + ':' + file.lastModified;
    if (seen.has(key)) continue;
    if (state.sources.length >= 12) break; // Keep memory manageable on iPhone.
    state.sources.push({ id: 'video-' + (++nextSourceId), file,
      objectUrl: URL.createObjectURL(file), duration: 0,
      bins: null, candidates: [], error: '' });
    seen.add(key);
    added++;
  }
  error('loadError',state.sources.length === 12 && incoming.length > added
    ? '一度に選べる動画は最大12本です。' : '');
  $('progressArea').hidden = true;
  error('analysisError','');
  syncSources();
}
$('fileInput').addEventListener('change', e => {
  chooseFiles(e.target.files,appendOnPick);
  e.target.value = '';
  appendOnPick = false;
});
$('changeFile').addEventListener('click', () => { appendOnPick = false; $('fileInput').click(); });
$('addFiles').addEventListener('click', () => { appendOnPick = true; $('fileInput').click(); });

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
  if (!state.sources.length || state.working || state.exporting) return;
  state.cancelled = false;
  busy(true);
  error('analysisError', '');
  const abort = () => { if (state.cancelled) throw Error('解析を中止しました'); };
  const failures = [];
  try {
    const files = [...state.sources];
    for (let i = 0; i < files.length; i++) {
      abort();
      const source = files[i];
      // Keep already edited results when adding more videos; re-run only unprocessed.
      if (source.bins) continue;
      const segmentProgress = (label, percent) => progress(
        '動画 ' + (i + 1) + '/' + files.length + '：' + source.file.name + ' — ' + label,
        (i + Math.min(100, percent) / 100) / files.length * 100);
      try {
        segmentProgress('解析準備中',0);
        const result = await decodeStreaming(source.file, segmentProgress, abort);
        abort();
        source.duration = result.duration;
        source.bins = result.bins;
        source.candidates = detectHighlights(source.bins, {
          sensitivity: state.sensitivity, leadSeconds: state.leadSeconds,
          maxResults: state.maxResults, binSeconds: STEP,
        }).map(item => ({ ...item, sourceId: source.id }));
        source.error = '';
        syncSources();
      } catch (e) {
        if (state.cancelled) throw e;
        source.error = e?.message || String(e);
        failures.push(source.file.name + '：' + source.error);
        renderSourceList();
      }
    }
    syncSources();
    if (!state.bins) throw Error('すべての動画で解析に失敗しました。');
    if (failures.length) {
      error('analysisError', '一部の動画は解析できませんでした：' + failures.join(' / '));
    }
    $('resultsPanel').hidden = false;
    $('resultsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    const message = e?.message || String(e);
    error('analysisError', message);
  } finally {
    busy(false);
    $('progressArea').hidden = true;
    renderSourceList();
  }
});
function rebuild() {
  if (!state.sources.some(s => s.bins)) return;
  for (const source of state.sources) {
    if (!source.bins) continue;
    const earlier=new Map(source.candidates.map(c=>[c.id,c]));
    source.candidates = detectHighlights(source.bins, {
      sensitivity: state.sensitivity, leadSeconds: state.leadSeconds,
      maxResults: state.maxResults, binSeconds: STEP
    }).map(item => {
      const old=earlier.get(item.id);
      return { ...item, sourceId: source.id,
        enabled: old?.enabled ?? false, title: old?.title || item.title };
    });
  }
  syncSources();
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
  const source = state.sources.find(s => s.id === item.sourceId);
  if (!source) return make('div','', '動画が見つかりません');
  const entry = make('div', 'highlight-entry');
  const wrap = make('div','highlight-item');
  const inline = make('div', 'inline-preview');
  inline.hidden = true;
  const badge = make('span', 'selection-label', item.enabled ? 'キープ済み' : '未選択');
  const number = make('span', 'scene-number', String(index + 1).padStart(2, '0'));
  const applySelection = () => {
    entry.classList.toggle('is-selected', !!item.enabled);
    entry.classList.toggle('is-excluded', !item.enabled);
    badge.textContent = item.enabled ? 'キープ済み' : '未選択';
    badge.classList.toggle('excluded', !item.enabled);
  };
  const enabled = make('button','keep-btn');
  enabled.type='button';
  const updateKeep=()=>{
    enabled.textContent=item.enabled ? '✓ キープ済み' : '＋ キープする';
    enabled.classList.toggle('kept',!!item.enabled);
    enabled.setAttribute('aria-pressed',String(!!item.enabled));
  };
  updateKeep();
  enabled.addEventListener('click', () => {
    item.enabled = !item.enabled;
    updateKeep();
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
    video.src = source.objectUrl;
    const label = make('p', 'inline-caption', source.file.name + ' — シーン ' + (index + 1) + '｜' + formatTime(item.time) + ' から再生（終わったら下の一覧で次を選べます）');
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
    if (seconds === null || seconds > source.duration) {
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
    source.candidates = source.candidates.filter(x => x !== item);
    syncSources();
  });
  wrap.append(play, fields, remove);
  entry.append(wrap, enabled);
  entry.append(inline);
  applySelection();
  return entry;
}
function refreshComment() {
  const selected = state.candidates.filter(item => item.enabled);
  const isMulti = state.sources.length > 1;
  const perSource=sourceTimestampComments(state.sources);
  $('commentText').value = perSource.filter(x=>x.text).map(x=>x.text).join('\n\n');
  $('selectedCount').textContent = String(selected.length);
  const summary = $('selectedSummary');
  summary.replaceChildren(...selected.map((item,i)=>{
    const src = state.sources.find(s => s.id === item.sourceId);
    return make('span','selected-chip', String(i+1) + '. ' +
      (isMulti ? src?.file.name + ' · ' : '') +
      formatTime(item.time) + ' ' + (item.title || 'Highlight'));
  }));
  summary.hidden = selected.length === 0;
  updateMontageEditor(state);
}
function drawResults() {
  closeInlinePreview();
  const elements = [];
  let pos = 0;
  for (const source of state.sources) {
    if (!source.bins) continue;
    const heading = make('div','source-scenes-header');
    const headTitle=make('div','source-scenes-name');
    headTitle.append(make('strong','',source.file.name),
      make('small','',source.candidates.length+'件の候補'));
    const copy=make('button','source-copy','この動画の時刻をコピー');
    copy.type='button';
    copy.addEventListener('click', async()=>{
      const current=sourceTimestampComments([source])[0];
      if(!current?.text){
        copy.textContent='キープした候補がありません'; return;
      }
      try { await navigator.clipboard.writeText(current.text); copy.textContent='✓ コピーしました'; }
      catch { $('commentText').value=current.text; $('commentText').focus();$('commentText').select();copy.textContent='下のテキストをコピー'; }
    });
    heading.append(headTitle,copy);
    elements.push(heading);
    for (const candidate of source.candidates) elements.push(row(candidate, pos++));
  }
  $('highlightList').replaceChildren(...elements);
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
    const source = state.sources.find(s => s.id === item.sourceId);
    const x = ((source?.offset || 0) + item.peakSeconds) / Math.max(1,state.duration) * width;
    context.strokeStyle = '#ffb773';
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(x,7); context.lineTo(x,height-7); context.stroke();
  }
}
window.addEventListener('resize', () => { if (state.bins) requestAnimationFrame(drawWave); });
$('waveCanvas').addEventListener('click', e => {
  if (!state.bins) return;
  const r = $('waveCanvas').getBoundingClientRect();
  const offsetSeconds = Math.max(0, Math.min(state.duration,
    (e.clientX - r.left) / r.width * state.duration));
  const source = [...state.sources].reverse().find(s =>
    s.bins && s.offset <= offsetSeconds);
  if (!source) return;
  const localTime = Math.min(source.duration, Math.max(0, offsetSeconds - source.offset));
  const closest = source.candidates.reduce((best,item) =>
    !best || Math.abs(item.time - localTime) < Math.abs(best.time - localTime) ? item : best, null);
  if (!closest) return;
  const idx = source.candidates.indexOf(closest);
  const entries = [...$('highlightList').querySelectorAll('.highlight-entry')];
  const allSources = state.sources.filter(s => s.bins);
  const preceding = allSources.slice(0,allSources.indexOf(source))
    .reduce((n,s)=>n+s.candidates.length,0);
  entries[preceding + idx]?.querySelector('.play-btn')?.click();
});
window.addEventListener('montage-settings-changed', () => {
  if (state.bins) refreshComment();
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


window.addEventListener('montage-export-state', event => {
  state.exporting = !!event.detail?.working;
  $('fileInput').disabled = state.exporting || state.working;
  $('changeFile').disabled = state.exporting || state.working;
  $('addFiles').disabled = state.exporting || state.working;
  $('analyzeButton').disabled = state.exporting || state.working || !state.sources.length;
  renderSourceList();
});

initMontageEditor(state);
