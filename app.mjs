import { detectHighlights, formatTime, makeComment } from './detector.mjs?v=audio12';
import { initWhisperExperiment, refreshWhisperTargets } from './whisper-experiment.mjs?v=whisper21';
import { initAIReview, refreshAIReview } from './ai-review.mjs?v=shot-probe9';
import { initVideoExplore, refreshVideoExplore } from './video-explore.mjs?v=5';
import { initCloudAudioPilot, refreshCloudAudioPilot } from './cloud-audio-pilot.mjs?v=5';
import { initGeminiPrimary, refreshGeminiPrimary } from './gemini-primary.mjs?v=eta34';
import { initGeminiCalloutPilot } from './gemini-callout-pilot.mjs?v=callout35';
import { geminiEventsToCandidates } from './gemini-candidates.mjs?v=1';
import { createAudioBinCollector } from './audio-features.mjs?v=audio12';
import { initMontageEditor, updateMontageEditor } from './montage-ui.mjs?v=batch33';
import { buildMultiClipPlan, sourceTimestampComments } from './multi-plan.mjs?v=pinch18';
import { createEditTransfer } from './edit-transfer.mjs';
import { getCandidateEnd, clipMarkerPositions, formatTimelineTime, timelineTimeAt, clampTimelineEdge, normalizeSceneZoom, normalizeSceneFocus } from './editing-rules.mjs?v=pinch18';
import { attachScenePinchEditor } from './scene-gesture.mjs?v=pinch28';
import { montageSeconds } from './exporter.mjs?v=pinch18';
import { getIntroConfiguration } from './intro-ui.mjs?v=drag31';
import { lineShareUrl, normalizeVisibleLineUrl } from './line-share.mjs?v=line17';
import { DEFAULT_PLAY_LABEL, PLAY_LABELS, nextUndecided, judgeScene, restoreJudgment, replayBounds } from './review-flow.mjs?v=storage8';
import { createSceneReplayMedia } from './scene-replay-media.mjs?v=1';
import { createScenePreviewAudio } from './scene-preview-audio.mjs?v=1';
import { toggleScenePreviewPlayback } from './scene-preview-playback.mjs?v=1';
import { initFirstRunGuide } from './first-run-guide.mjs?v=1';

const $ = id => document.getElementById(id);
// Keep one video decoder across scene cards, independent of Gemini/candidate data.
const sceneReplayMedia=createSceneReplayMedia(()=>document.createElement('video'));
// Session preview volume persists while moving between scene cards.
const scenePreviewAudio=createScenePreviewAudio();
// When someone copies the address bar, preserve LINE's external-browser flag.
// This does NOT switch browser after LINE has already opened an in-app page.
try {
  const normalized=normalizeVisibleLineUrl(window.location.href);
  if(normalized && window.history?.replaceState)
    window.history.replaceState(window.history.state,'',normalized);
} catch {
  // The app remains usable even if a browser blocks History API operations.
}

const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const state = {
  file: null, objectUrl: null, duration: 0, bins: null, candidates: [], sources: [],
  sensitivity: 'normal', leadSeconds: 7, maxResults: 8,
  working: false, cancelled: false, exporting: false, geminiProcessing: false
};
const guide=initFirstRunGuide({hasPriorAnalysis:()=>{
  try {return Object.keys(JSON.parse(localStorage.getItem('peakstamp_gemini_primary_json_v1')||'{}')).length>0;}
  catch{return false;}
}});
const STEP = .25;
let activeInlineClose = null;
let reviewTab = 'all';
let autoOpeningNextReplay = false;
let lastRejected = null;
let undoTimer = null;
const UNDO_VISIBLE_MS = 5000;
function currentClipOptions(){return {mode:document.querySelector('input[name="cutMode"]:checked')?.value || 'quiet',fixedSeconds:Number($('clipDuration').value)||16,tailSeconds:Number($('tailSeconds').value)||3};}
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
let filePickerOpenedAt = null;
let importTimingSequence = 0;
function elapsedLabel(milliseconds) {
  return milliseconds < 1000 ? Math.round(milliseconds) + 'ms'
    : (milliseconds / 1000).toFixed(1) + '秒';
}
$('fileInput').addEventListener('click', () => {
  // The native picker may browse Photos, retrieve iCloud originals and convert
  // media before firing "change"; this timer ALSO includes human selection time.
  filePickerOpenedAt = performance.now();
  error('loadError', '');
});
function showIncompleteFilePick() {
  // Native iOS Photos/Files picker sometimes returns without selected File objects.
  // We cannot access, speed up, or measure the OS-side preparation itself.
  const waited = filePickerOpenedAt === null ? '' :
    '（選択画面を開いてから約' + elapsedLabel(performance.now() - filePickerOpenedAt) + '）';
  filePickerOpenedAt = null;
  error('loadError','動画の選択が完了しませんでした' + waited +
    '。大きな動画はSafariで1本ずつ選択するか、写真アプリから「未編集のオリジナルを書き出す」で「このiPhone内」に保存し、ファイルから選択してください。');
}
$('fileInput').addEventListener('cancel', showIncompleteFilePick);
function busy(value) {
  state.working = value;
  $('fileInput').disabled = value || state.exporting || state.geminiProcessing;
  $('changeFile').disabled = value || state.exporting || state.geminiProcessing;
  $('addFiles').disabled = value || state.exporting || state.geminiProcessing;
  $('analyzeButton').disabled = value || state.geminiProcessing || !state.sources.length;
  $('analyzeButton').textContent = value ? '音声を解析中…' : '⌁　音声を解析する　→';
  $('cancelButton').hidden = !value;
  refreshAIReview(state);
  refreshVideoExplore(state);
  refreshCloudAudioPilot(state);
  refreshGeminiPrimary(state);
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
  refreshWhisperTargets(state);
  refreshAIReview(state);
  refreshVideoExplore(state);
  refreshGeminiPrimary(state);
  refreshCloudAudioPilot(state);
  calloutPilot?.refresh();
  if (lastRejected && !state.candidates.includes(lastRejected.item)) clearUndoReview();
  $('stickyBar').hidden = !state.bins;
  $('resultsPanel').hidden = !state.bins;
  $('multiWaveNotice').hidden = state.sources.length <= 1;
  $('commentHelp').hidden = state.sources.length <= 1;
  $('commentHeading').textContent = '動画ごとのYouTubeタイムスタンプ';
  if (state.bins) drawResults();
  else updateMontageEditor(state);
  renderSourceList();
  guide.update({hasVideo:state.sources.length>0,hasResults:!!state.bins});
}
function renderSourceList() {
  const sources = state.sources;
  document.body.classList.toggle('has-media',sources.length>0);
  $('fileDetails').hidden = sources.length === 0;
  $('sourceBoard').hidden = sources.length === 0;
  $('uploadZone').hidden = sources.length > 0;
  $('sourceCount').textContent = String(sources.length);
  $('fileName').textContent = sources.length + '本の動画を選択中';
  const megabytes = sources.reduce((n,s) => n + s.file.size,0)/1048576;
  $('fileSize').textContent = megabytes.toFixed(1) + ' MB 合計';
  $('analyzeButton').disabled = !sources.length || state.working || state.exporting || state.geminiProcessing;
  const preview = $('preview');
  const previewButton = $('loadPreview');
  const first = sources[0];
  if (first) {
    if (preview.dataset.sourceId !== first.id) {
      preview.pause();
      // Release an old source, but never open/read the NEW video until requested.
      if (preview.hasAttribute('src')) {
        preview.removeAttribute('src');
        preview.load();
      }
      delete preview.dataset.sourceId;
      preview.preload = 'none';
      preview.hidden = true;
      previewButton.hidden = false;
    }
    $('videoWrapper').hidden = false;
  } else {
    preview.pause();
    if (preview.hasAttribute('src')) {
      preview.removeAttribute('src');
      preview.load();
    }
    delete preview.dataset.sourceId;
    preview.hidden = true;
    previewButton.hidden = true;
    $('videoWrapper').hidden = true;
    $('fileImportTiming').hidden = true;
    $('fileImportHelp').hidden = true;
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
      button.disabled = state.working || state.exporting || state.geminiProcessing || i + diff < 0 || i + diff >= sources.length;
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
    del.disabled = state.working || state.exporting || state.geminiProcessing;
    del.setAttribute('aria-label',source.file.name+' を削除');
    del.addEventListener('click', () => {
      closeInlinePreview();
      // Release the retained decoder before revoking a media Blob URL.
      scenePreviewAudio.dispose();
      sceneReplayMedia.dispose();
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
  if (state.working || state.exporting || state.geminiProcessing || !files?.length) return;
  const incoming = Array.from(files).filter(file => /\.(mp4|mov|m4v)$/i.test(file.name) ||
    /^video\//.test(file.type));
  if (!incoming.length) {
    error('loadError','動画ファイル（MOV / MP4）を選んでください。');
    return;
  }
  closeInlinePreview();
  if (!append) {
    scenePreviewAudio.dispose();
    sceneReplayMedia.dispose();
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
  const receivedAt = performance.now();
  const pickerMs = filePickerOpenedAt === null ? null : receivedAt - filePickerOpenedAt;
  const filesProvided = Boolean(e.target.files?.length);
  if (!filesProvided) showIncompleteFilePick();
  else filePickerOpenedAt = null;
  const validFileSelected = Array.from(e.target.files || []).some(file =>
    /\.(mp4|mov|m4v)$/i.test(file.name) || /^video\//.test(file.type));
  chooseFiles(e.target.files,appendOnPick);
  const timingSequence = ++importTimingSequence;
  if (validFileSelected && state.sources.length) {
    // Measure until the browser gets a chance to paint the list, not video decode.
    requestAnimationFrame(() => {
      if (timingSequence !== importTimingSequence) return;
      const appMs = performance.now() - receivedAt;
      const pickerText = pickerMs === null ? '不明' : elapsedLabel(pickerMs);
      $('fileImportTiming').textContent =
        'ファイル選択：' + pickerText + ' ／ PeakStampの一覧表示：' + elapsedLabel(appMs);
      $('fileImportTiming').hidden = false;
      $('fileImportHelp').hidden = false;
    });
  }
  e.target.value = '';
  appendOnPick = false;
});
$('loadPreview').addEventListener('click', () => {
  const first = state.sources[0];
  if (!first) return;
  const preview = $('preview');
  preview.dataset.sourceId = first.id;
  preview.preload = 'metadata';
  preview.src = first.objectUrl;
  preview.hidden = false;
  $('loadPreview').hidden = true;
  preview.load();
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
    const collector=createAudioBinCollector(STEP);
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
          let p = 0;
          for (let ch = 0; ch < channels; ch++) {
            const v = floats[f * channels + ch] || 0;
            p += v * v;
          }
          collector.push(seconds,p/channels,floats[f*channels]||0,rate,4);
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
      bins: collector.finish(duration)
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

async function commitGeminiResults({source,parsed,audio,decoded,batch=false}) {
  if(!state.sources.includes(source))throw Error('この動画は既に削除されました。');
  const duration=Number(audio.durationSeconds)||Number(decoded.duration);
  if(!(duration>0)||!Array.isArray(decoded.bins)||!decoded.bins.length)
    throw Error('確認用の音声波形を準備できませんでした。');
  const previous=source.candidates||[];
  const conversion=geminiEventsToCandidates(parsed.events,source.id,duration,previous);
  // Honor already reviewed offline scenes, while avoiding near-duplicate footage.
  const preserved=previous.filter(item=>
    (item.enabled===true||item.rejected===true) &&
    !conversion.items.some(candidate=>Math.abs(candidate.peakSeconds-item.peakSeconds)<=4));
  source.duration=duration;
  source.bins=decoded.bins;
  source.candidates=[...conversion.items,...preserved]
    .sort((a,b)=>a.peakSeconds-b.peakSeconds);
  source.analysisEngine='gemini';
  source.error='';
  syncSources();
  $('resultsPanel').hidden=false;
  if(!batch)$('resultsPanel').scrollIntoView({behavior:'smooth',block:'start'});
  return {candidates:conversion.items.length,merged:conversion.mergedCount};
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
    if (!source.bins || source.analysisEngine==='gemini') continue;
    const earlier=new Map(source.candidates.map(c=>[c.id,c]));
    source.candidates = detectHighlights(source.bins, {
      sensitivity: state.sensitivity, leadSeconds: state.leadSeconds,
      maxResults: state.maxResults, binSeconds: STEP
    }).map(item => {
      const old=earlier.get(item.id);
      return { ...item, sourceId: source.id,
        enabled: old?.enabled ?? false, rejected: old?.rejected ?? false,
        title: old?.title || item.title,
        time: old?.time ?? item.time, manualEnd: old?.manualEnd ?? null,
        zoom: normalizeSceneZoom(old?.zoom),
        zoomX: normalizeSceneFocus(old?.zoomX),zoomY: normalizeSceneFocus(old?.zoomY) };
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
  const parts = String(value).trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (parts.slice(0,-1).some(n => !Number.isInteger(n))) return null;
  if (parts.slice(1).some(n => n >= 60)) return null;
  return Math.round(parts.reduce((s,n) => s * 60 + n, 0) * 10) / 10;
}
function clearUndoReview() {
  if (undoTimer !== null) clearTimeout(undoTimer);
  undoTimer = null;
  lastRejected = null;
  $('undoReview').hidden = true;
}
function showUndoReview(message) {
  if (undoTimer !== null) clearTimeout(undoTimer);
  $('undoReviewText').textContent = message;
  $('undoReview').hidden = false;
  undoTimer = setTimeout(clearUndoReview, UNDO_VISIBLE_MS);
}
function nextSceneAfter(current) {
  const next=nextUndecided(state.sources,current);
  if (reviewTab === 'kept') reviewTab='all';
  drawResults();
  if (!next) {
    $('reviewProgress').textContent='未判断のシーンはありません。キープ済みを確認できます。';
    return;
  }
  $('reviewProgress').textContent='次の未判断シーンへ移動しました。';
  requestAnimationFrame(()=>{
    const items=[...$('highlightList').querySelectorAll('.highlight-entry')];
    const element=items.find(entry=>entry.dataset.sourceId===next.source.id && entry.dataset.sceneId===next.item.id);
    if (!element) return;
    element.classList.add('review-next');
    // Open the video first, then scroll after layout expands. This ensures
    // Keep and Reject follow the same motion on mobile Safari.
    autoOpeningNextReplay = true;
    try {
      element.querySelector('.play-btn')?.click();
    } finally {
      autoOpeningNextReplay = false;
    }
    requestAnimationFrame(()=>{
      element.scrollIntoView({behavior:'auto',block:'start'});
    });
  });
}
function decideReview(source,item,decision) {
  const previous=judgeScene(item,decision);
  if(decision==='rejected') {
    lastRejected={item,source,previous};
    showUndoReview('「'+(item.title||'シーン')+'」を不採用にしました');
  }
  nextSceneAfter(item);
}
$('undoReviewButton').addEventListener('click',()=>{
  if(!lastRejected) return;
  const {item,source,previous}=lastRejected;
  restoreJudgment(item,previous);
  clearUndoReview();
  if(reviewTab==='kept')reviewTab='all';
  drawResults();
  requestAnimationFrame(()=>{
    const match=[...$('highlightList').querySelectorAll('.highlight-entry')]
      .find(entry=>entry.dataset.sourceId===source.id && entry.dataset.sceneId===item.id);
    match?.scrollIntoView({behavior:'smooth',block:'start'});
  });
});

function row(item, index) {
  const source = state.sources.find(s => s.id === item.sourceId);
  if (!source) return make('div','', '動画が見つかりません');
  const entry = make('div', 'highlight-entry');
  entry.dataset.sourceId=source.id;
  entry.dataset.sceneId=item.id;
  const wrap = make('div','highlight-item');
  const inline = make('div', 'inline-preview');
  inline.hidden = true;
  const badge = make('span', 'selection-label',
    item.enabled ? 'キープ済み' : item.rejected ? '不採用' : '未判断');
  const number = make('span', 'scene-number', String(index + 1).padStart(2, '0'));
  const applySelection = () => {
    entry.classList.toggle('is-selected', !!item.enabled);
    entry.classList.toggle('is-excluded', !item.enabled);
    badge.textContent = item.enabled ? 'キープ済み' : item.rejected ? '不採用' : '未判断';
    badge.classList.toggle('excluded', !item.enabled);
  };
  const play = make('button','play-btn','▶ リプレイ');
  play.type = 'button';
  play.title = '切り取り範囲をもう一度再生';
  let replayVideo=null;
  let frameWatchId=null;
  let teardownZoom=null;
  let replayStatus=null;
  let pauseResumeButton=null;
  let playVersion=0;
  let replayListeners=[];
  const setReplayStatus=message=>{
    if(!replayStatus)return;
    replayStatus.textContent=message;
    replayStatus.hidden=!message;
  };
  const close=()=>{
    teardownZoom?.();
    teardownZoom=null;
    if(replayVideo){
      if(frameWatchId!==null && replayVideo.cancelVideoFrameCallback){
        replayVideo.cancelVideoFrameCallback(frameWatchId);
      }
      frameWatchId=null;
      playVersion++;
      for(const [event,handler] of replayListeners)replayVideo.removeEventListener(event,handler);
      replayListeners=[];
      // Detach the player but retain its media source for the next scene.
      sceneReplayMedia.release();
      replayVideo=null;
    }
    replayStatus=null;
    pauseResumeButton=null;
    inline.replaceChildren();
    inline.hidden=true;
    entry.classList.remove('preview-active');
  };
  const clampAndStop=()=>{
    if(!replayVideo || !Number.isFinite(replayVideo.duration))return;
    const bounds=replayBounds(source,item,(s,c)=>getCandidateEnd(s,c,currentClipOptions()));
    // Repeatedly seeking backwards while Safari is seeking can freeze long MOVs.
    // The start seek is performed once by restartReplay; only enforce the end.
    if(!replayVideo.seeking && replayVideo.currentTime >= bounds.end-.06){
      replayVideo.pause();
      if(Math.abs(replayVideo.currentTime-bounds.end)>.08)replayVideo.currentTime=bounds.end;
    }
    updatePlayhead();
  };
  // Safari and Chrome can update the cursor on each decoded video frame.
  // Older browsers still get updates through the standard timeupdate event.
  const watchVideoFrames=()=>{
    const video=replayVideo;
    if(!video || !video.requestVideoFrameCallback || frameWatchId!==null)return;
    const tick=()=>{
      frameWatchId=null;
      if(video!==replayVideo)return;
      clampAndStop();
      if(!video.paused)frameWatchId=video.requestVideoFrameCallback(tick);
    };
    frameWatchId=video.requestVideoFrameCallback(tick);
  };
  const updatePauseResume=()=>{
    if(!pauseResumeButton||!replayVideo)return;
    pauseResumeButton.textContent=replayVideo.paused?'▶ 再生':'⏸ 一時停止';
    pauseResumeButton.setAttribute('aria-label',replayVideo.paused?'シーンを再生':'シーンを一時停止');
  };
  const restartReplay=()=>{
    if(!replayVideo)return;
    const video=replayVideo;
    const bounds=replayBounds(source,item,(s,c)=>getCandidateEnd(s,c,currentClipOptions()));
    if(bounds.end<=bounds.start){setReplayStatus('再生範囲が不正です。開始・終了時刻を確認してください。');return;}
    if(video.readyState<1){setReplayStatus('動画を準備中です。準備後に「▶ リプレイ」を押してください。');return;}
    video.pause();
    try{video.currentTime=bounds.start;}catch(_){
      setReplayStatus('再生位置に移動できませんでした。もう一度「▶ リプレイ」を押してください。');
      return;
    }
    updatePlayhead();
    updatePauseResume();
    // Resume the iOS audio graph before requesting playback.
    void scenePreviewAudio.wake();
    const attempt=++playVersion;
    try{
      Promise.resolve(video.play()).then(()=>{
        if(replayVideo===video&&attempt===playVersion)setReplayStatus('');
      }).catch(()=>{
        if(replayVideo===video&&attempt===playVersion)
          setReplayStatus('Safariで再生が開始できませんでした。もう一度「▶ リプレイ」を押してください。');
      });
    }catch(_){
      setReplayStatus('Safariで再生が開始できませんでした。もう一度「▶ リプレイ」を押してください。');
    }
  };
  play.addEventListener('click',()=>{
    if(activeInlineClose===close && replayVideo){
      restartReplay();
      return;
    }
    closeInlinePreview();
    $('preview').pause();
    const {video,sourceChanged}=sceneReplayMedia.acquire(source.id,source.objectUrl);
    replayVideo=video;
    video.className='inline-player';
    const audioMode=scenePreviewAudio.attach(video);
    void scenePreviewAudio.wake();
    // The Replay button is the playback control. Suppress iPhone's large
    // native pause overlay and keep playback inline within the clip card.
    video.controls=false;
    video.playsInline=true;
    video.setAttribute('playsinline','');
    video.setAttribute('webkit-playsinline','');
    video.disablePictureInPicture=true;
    const label=make('p','inline-caption',
      formatTimelineTime(item.time)+' 〜 '+
      formatTimelineTime(getCandidateEnd(source,item,currentClipOptions())));
    const viewport=make('div','zoom-video-viewport');
    viewport.setAttribute('tabindex','0');
    viewport.setAttribute('role','group');
    viewport.setAttribute('aria-label','映像の画角調整：2本指で拡大縮小、拡大後は1本指で移動。キーボードのプラス・マイナスでも倍率変更可能');
    viewport.append(video);
    const tip=make('span','pinch-overlay-tip','↔ 2本指で拡大');
    tip.setAttribute('aria-hidden','true');
    const isZoomTipSeen=()=>{try{return localStorage.getItem('peakstamp_zoom_discovered_v1')==='yes';}catch{return false;}};
    const markZoomTipSeen=()=>{try{localStorage.setItem('peakstamp_zoom_discovered_v1','yes');}catch{}};
    tip.hidden=isZoomTipSeen()||normalizeSceneZoom(item.zoom)>1;
    viewport.append(tip);
    const zoomRow=make('div','scene-pinch-toolbar');
    const zoomHint=make('span','scene-pinch-hint','画角調整 · 2本指でも拡大');
    const zoomValue=make('output','scene-pinch-value');
    const zoomOut=make('button','scene-zoom-action','−');
    zoomOut.type='button';zoomOut.setAttribute('aria-label','映像を縮小');
    const zoomIn=make('button','scene-zoom-action','＋');
    zoomIn.type='button';zoomIn.setAttribute('aria-label','映像を拡大');
    const zoomReset=make('button','scene-pinch-reset','戻す');
    zoomReset.type='button';
    zoomReset.setAttribute('aria-label','映像の拡大と位置を初期化');
    zoomRow.append(zoomHint,zoomOut,zoomValue,zoomIn,zoomReset);
    const playbackRow=make('div','scene-playback-controls');
    pauseResumeButton=make('button','scene-pause-button','⏸ 一時停止');
    pauseResumeButton.type='button';
    pauseResumeButton.setAttribute('aria-label','シーンを一時停止');
    const mute=make('button','scene-mute-button','🔊');
    mute.type='button';
    mute.setAttribute('aria-label','音声をミュート');
    const volumeLabel=make('label','scene-volume-label','音量');
    const volumeSlider=make('input','scene-volume-slider');
    volumeSlider.type='range';
    volumeSlider.min='0';volumeSlider.max='100';volumeSlider.step='5';
    volumeSlider.value=String(scenePreviewAudio.level);
    volumeSlider.setAttribute('aria-label','シーン確認の音量');
    const volumeValue=make('output','scene-volume-value',scenePreviewAudio.level+'%');
    volumeLabel.append(volumeSlider,volumeValue);
    playbackRow.append(pauseResumeButton,mute,volumeLabel);
    const volumeNote=make('p','scene-volume-note',
      audioMode.canAdjust?'確認時の音量 · 完成MP4には影響しません':
       'このiPhoneでは本体の音量ボタンをご利用ください（ミュートは利用可）');
    volumeSlider.disabled=!audioMode.canAdjust;
    const updateVolumeUI=()=>{
      const v=scenePreviewAudio.level;
      volumeSlider.value=String(v);volumeValue.textContent=v+'%';
      mute.textContent=v===0?'🔇':'🔊';
      mute.setAttribute('aria-label',v===0?'音声のミュートを解除':'音声をミュート');
    };
    let lastAudibleVolume=Math.max(5,scenePreviewAudio.level);
    volumeSlider.addEventListener('input',()=>{
      const amount=scenePreviewAudio.setLevel(Number(volumeSlider.value));
      if(amount>0)lastAudibleVolume=amount;
      void scenePreviewAudio.wake();
      updateVolumeUI();
    });
    mute.addEventListener('click',()=>{
      if(scenePreviewAudio.level>0){
        lastAudibleVolume=scenePreviewAudio.level;
        scenePreviewAudio.setLevel(0);
      }else scenePreviewAudio.setLevel(lastAudibleVolume);
      void scenePreviewAudio.wake();
      updateVolumeUI();
    });
    pauseResumeButton.addEventListener('click',()=>{
      const player=replayVideo;
      if(!player)return;
      const bounds=replayBounds(source,item,(s,c)=>getCandidateEnd(s,c,currentClipOptions()));
      toggleScenePreviewPlayback(player,bounds,{
        restart:restartReplay,
        onBeforePlay:()=>{void scenePreviewAudio.wake();},
        onError:()=>{if(replayVideo===player)
          setReplayStatus('再生できませんでした。もう一度お試しください。');}
      });
      updatePauseResume();
    });
    updateVolumeUI();
    updatePauseResume();
    replayStatus=make('p','inline-caption','動画を準備しています…');
    replayStatus.setAttribute('role','status');
    replayStatus.setAttribute('aria-live','polite');
    inline.replaceChildren(label,viewport,playbackRow,volumeNote,zoomRow,replayStatus);
    teardownZoom=attachScenePinchEditor({
      viewport,video,read:()=>({
        zoom:normalizeSceneZoom(item.zoom),
        zoomX:normalizeSceneFocus(item.zoomX),zoomY:normalizeSceneFocus(item.zoomY)
      }),
      write:next=>{
        item.zoom=next.zoom;item.zoomX=next.zoomX;item.zoomY=next.zoomY;
        zoomOut.disabled=normalizeSceneZoom(item.zoom)<=1;
        zoomIn.disabled=normalizeSceneZoom(item.zoom)>=3;
        if(normalizeSceneZoom(item.zoom)>1.02){markZoomTipSeen();tip.hidden=true;}
      },
      commit:()=>refreshComment(),
      resetButton:zoomReset,readout:zoomValue
    });
    zoomOut.disabled=normalizeSceneZoom(item.zoom)<=1;
    zoomIn.disabled=normalizeSceneZoom(item.zoom)>=3;
    zoomOut.addEventListener('click',()=>teardownZoom?.zoomBy(.8));
    zoomIn.addEventListener('click',()=>teardownZoom?.zoomBy(1.25));
    inline.hidden=false;
    entry.classList.add('preview-active');
    activeInlineClose=close;
    const on=(event,handler)=>{
      video.addEventListener(event,handler);
      replayListeners.push([event,handler]);
    };
    on('loadedmetadata',restartReplay);
    on('timeupdate',clampAndStop);
    on('seeked',clampAndStop);
    on('play',()=>{updatePlayhead();updatePauseResume();watchVideoFrames();});
    on('playing',()=>{setReplayStatus('');updatePauseResume();});
    on('pause',()=>{updatePlayhead();updatePauseResume();});
    on('waiting',()=>setReplayStatus('動画の再生位置を準備しています…'));
    on('error',()=>setReplayStatus('元動画を再生できません（メディアエラー '+(video.error?.code||'不明')+'）。MOVの形式を確認してください。'));
    // sourceChanged is only true on first load or when switching files.
    // For consecutive scenes of the same MOV, no src reassignment or load().
    if(!sourceChanged && video.readyState>=1)restartReplay();
    if (!autoOpeningNextReplay) {
      inline.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
  });
  const fields = make('div','item-fields');
  const timeRow = make('div','time-row');
  const time = make('input','time-input');
  time.type = 'text';
  time.value = formatTimelineTime(item.time);
  time.setAttribute('aria-label','タイムスタンプ');
  time.addEventListener('change', () => {
    const seconds = parseTime(time.value);
    if (seconds === null || seconds >= source.duration ||
      (Number.isFinite(item.manualEnd) && seconds >= item.manualEnd - .24)) {
      time.value = formatTimelineTime(item.time);
    } else {
      item.time = seconds;
      renderRange();
      refreshComment();
    }
  });
  timeRow.append(number, badge);
  const score = make('span','score',item.origin==='gemini'
    ? 'Gemini · '+formatTime(item.peakSeconds)
      +(item.geminiQuote?' · 「'+item.geminiQuote.slice(0,24)+(item.geminiQuote.length>24?'…':'')+'」':'')
    : 'ピーク ' + Math.round(item.peakSeconds) + '秒 / ' + item.db + 'dBFS');
  score.title=item.origin==='gemini'?String(item.geminiQuote||item.geminiReason||''):'';
  const titleGroup=make('div','play-label-group');
  const titleLabel=make('label','play-label-caption','プレイ内容');
  const titleSelect=make('select','play-label-select');
  titleSelect.setAttribute('aria-label','プレイ内容を選択');
  for(const value of PLAY_LABELS){
    const opt=make('option','',value);
    opt.value=value;
    titleSelect.append(opt);
  }
  const customOption=make('option','','その他（自由入力）');
  customOption.value='__custom__';
  titleSelect.append(customOption);
  const title=make('input','title-input');
  title.type='text';
  title.maxLength=100;
  title.setAttribute('aria-label','プレイ内容の自由入力');
  const labelIsPreset=PLAY_LABELS.includes(item.title);
  titleSelect.value=labelIsPreset ? item.title : '__custom__';
  title.value=item.title || DEFAULT_PLAY_LABEL;
  title.hidden=labelIsPreset;
  titleSelect.addEventListener('change',()=>{
    if(titleSelect.value==='__custom__'){
      title.hidden=false;
      title.focus();
    } else {
      title.hidden=true;
      item.title=titleSelect.value;
      title.value=item.title;
      refreshComment();
    }
  });
  title.addEventListener('input',()=>{
    item.title=title.value;
    refreshComment();
  });
  titleGroup.append(titleLabel,titleSelect,title);
  // Keep metadata/editor logic for compatibility; play classification is unused
  // in the current highlight-video workflow and intentionally hidden.
  titleGroup.hidden = true;

  const rangeEditor=make('div','range-editor');
  const rangeHeading=make('div','range-heading');
  const rangeTitle=make('strong','range-title','切り取り範囲');
  const currentReadout=make('span','range-current','再生位置 —');
  rangeHeading.append(rangeTitle,currentReadout);
  const markerLegend=make('div','range-legend');
  const legendStart=make('span','range-start-label');
  const legendPeak=make('span','range-peak-label');
  const legendEnd=make('span','range-end-label');
  markerLegend.append(legendStart,legendPeak,legendEnd);
  const track=make('div','range-track interactive-range');
  track.setAttribute('aria-label','タイムライン：端をドラッグして開始・終了を調整');
  const fill=make('div','range-fill');
  const startDot=make('button','range-dot range-start range-handle');
  const peakDot=make('span','range-dot range-peak');
  const endDot=make('button','range-dot range-end range-handle');
  const playhead=make('span','range-playhead');
  startDot.type='button';
  endDot.type='button';
  playhead.hidden=true;
  startDot.setAttribute('aria-label','切り取り開始位置を調整');
  endDot.setAttribute('aria-label','切り取り終了位置を調整');
  startDot.setAttribute('role','slider');
  endDot.setAttribute('role','slider');
  startDot.setAttribute('aria-orientation','horizontal');
  endDot.setAttribute('aria-orientation','horizontal');
  track.append(fill,startDot,peakDot,endDot,playhead);
  const rangeHint=make('p','range-hint','両端をドラッグ · 長押しで微調整');
  const rangeInputs=make('div','range-inputs');
  const startBox=make('div','range-field');
  startBox.append(make('label','', '開始'));
  const endBox=make('div','range-field');
  const endLabel=make('label','range-auto-label','終了（自動）');
  const endInput=make('input','range-time');
  endInput.type='text';
  endInput.inputMode='text';
  endInput.setAttribute('aria-label','切り取り終了時刻');
  endBox.append(endLabel);
  const resetEnd=make('button','range-reset','自動に戻す');
  resetEnd.type='button';
  resetEnd.addEventListener('click',()=>{
    item.manualEnd=null;
    renderRange();
    refreshComment();
  });
  startBox.append(time);
  endBox.append(endInput,resetEnd);
  rangeInputs.append(startBox,endBox);
  rangeEditor.append(rangeHeading,markerLegend,track,rangeHint,rangeInputs);
  let dragging=null;
  let fineTimer=null;
  const clearFineTimer=()=>{
    if(fineTimer!==null) clearTimeout(fineTimer);
    fineTimer=null;
  };
  const applyBoundary=(edge,value)=>{
    const end=getCandidateEnd(source,item,currentClipOptions());
    const adjusted=clampTimelineEdge(edge,value,item.time,end,source.duration);
    if(edge==='start'){
      item.time=adjusted;
      time.value=formatTimelineTime(adjusted);
    }else{
      item.manualEnd=adjusted;
      endInput.value=formatTimelineTime(adjusted);
    }
    renderRange();
  };
  const startDrag=(edge,handle,event)=>{
    if(event.button!==undefined && event.button!==0)return;
    event.preventDefault();
    event.stopPropagation();
    clearFineTimer();
    const end=getCandidateEnd(source,item,currentClipOptions());
    const window=clipMarkerPositions(item.time,item.peakSeconds,end,source.duration);
    const origin=edge==='start'?item.time:end;
    dragging={edge,pointerId:event.pointerId,initialX:event.clientX,lastX:event.clientX,
      origin,window,moved:false,fine:false,fineAnchorX:event.clientX,fineAnchorTime:origin};
    try{handle.setPointerCapture?.(event.pointerId);}catch{}
    handle.classList.add('dragging');
    fineTimer=setTimeout(()=>{
      if(!dragging || dragging.pointerId!==event.pointerId || dragging.moved)return;
      dragging.fine=true;
      dragging.fineAnchorX=dragging.lastX;
      dragging.fineAnchorTime=dragging.edge==='start'
        ? item.time:getCandidateEnd(source,item,currentClipOptions());
      rangeHint.textContent='微調整中：0.1秒単位で動かせます';
      track.classList.add('is-fine');
    },450);
  };
  const moveDrag=(event)=>{
    if(!dragging || dragging.pointerId!==event.pointerId)return;
    event.preventDefault();
    const rect=track.getBoundingClientRect();
    dragging.lastX=event.clientX;
    if(Math.abs(event.clientX-dragging.initialX)>7 && !dragging.fine){
      dragging.moved=true;
      clearFineTimer();
    }
    const seconds=dragging.fine
      ? Math.round((dragging.fineAnchorTime+
          (event.clientX-dragging.fineAnchorX)/Math.max(1,rect.width)*4)*10)/10
      : timelineTimeAt(event.clientX,rect,dragging.window.left,dragging.window.right,0.25);
    applyBoundary(dragging.edge,seconds);
  };
  const finishDrag=(event)=>{
    if(!dragging || dragging.pointerId!==event.pointerId)return;
    event.preventDefault();
    event.stopPropagation();
    clearFineTimer();
    const handle=dragging.edge==='start'?startDot:endDot;
    try{handle.releasePointerCapture?.(event.pointerId);}catch{}
    handle.classList.remove('dragging');
    dragging=null;
    track.classList.remove('is-fine');
    rangeHint.textContent='両端をドラッグ · 長押しで微調整';
    renderRange();
    refreshComment();
  };
  for(const [edge,handle] of [['start',startDot],['end',endDot]]){
    handle.addEventListener('pointerdown',event=>startDrag(edge,handle,event));
    handle.addEventListener('pointermove',moveDrag);
    handle.addEventListener('pointerup',finishDrag);
    handle.addEventListener('pointercancel',finishDrag);
    handle.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();
      const diff=(event.key==='ArrowRight'?1:-1)*(event.shiftKey?0.1:0.25);
      const current=edge==='start'?item.time:getCandidateEnd(source,item,currentClipOptions());
      applyBoundary(edge,Math.round((current+diff)*100)/100);
      refreshComment();
    });
  }
  track.addEventListener('click',event=>{
    if(!replayVideo || event.target===startDot || event.target===endDot ||
      event.target===peakDot || dragging)return;
    const p=clipMarkerPositions(item.time,item.peakSeconds,
      getCandidateEnd(source,item,currentClipOptions()),source.duration);
    const selected=timelineTimeAt(event.clientX,track.getBoundingClientRect(),p.left,p.right,0.1);
    const end=getCandidateEnd(source,item,currentClipOptions());
    replayVideo.pause();
    replayVideo.currentTime=Math.max(item.time,Math.min(end,selected));
    updatePlayhead();
  });
  fields.append(timeRow, titleGroup, score);
  const updatePlayhead=()=>{
    const current=replayVideo&&Number.isFinite(replayVideo.currentTime)
      ? replayVideo.currentTime:item.time;
    currentReadout.textContent=replayVideo
      ? '再生位置 '+formatTimelineTime(current) : '再生位置 —';
    playhead.hidden=!replayVideo;
    const end=getCandidateEnd(source,item,currentClipOptions());
    const window=dragging?.window || clipMarkerPositions(item.time,item.peakSeconds,end,source.duration);
    const percent=Math.max(0,Math.min(100,(current-window.left)/
      Math.max(0.001,window.right-window.left)*100));
    playhead.style.left=percent+'%';
    playhead.classList.toggle('is-playing',Boolean(replayVideo && !replayVideo.paused));
  };
  const renderRange=()=>{
    const end=getCandidateEnd(source,item,currentClipOptions());
    const p=dragging?.window || clipMarkerPositions(item.time,item.peakSeconds,end,source.duration);
    const pc=x=>Math.max(0,Math.min(100,(x-p.left)/Math.max(0.001,p.right-p.left)*100));
    const a=pc(item.time),b=pc(end);
    fill.style.left=a+'%';
    fill.style.width=Math.max(0,b-a)+'%';
    startDot.style.left=a+'%';
    peakDot.style.left=pc(item.peakSeconds)+'%';
    endDot.style.left=b+'%';
    legendStart.textContent='開始 '+formatTimelineTime(item.time);
    legendPeak.textContent='ピーク '+formatTimelineTime(item.peakSeconds);
    legendEnd.textContent='終了 '+formatTimelineTime(end);
    time.value=formatTimelineTime(item.time);
    endInput.value=formatTimelineTime(end);
    endLabel.textContent=Number.isFinite(item.manualEnd)?'終了（手動）':'終了（自動）';
    resetEnd.hidden=!Number.isFinite(item.manualEnd);
    for(const [handle,now,min,max] of [
      [startDot,item.time,0,Math.max(0,end-.3)],
      [endDot,end,item.time+.3,source.duration]
    ]){
      handle.setAttribute('aria-valuemin',String(Math.max(0,min)));
      handle.setAttribute('aria-valuemax',String(Math.max(0,max)));
      handle.setAttribute('aria-valuenow',String(Math.round(now*10)/10));
      handle.setAttribute('aria-valuetext',formatTimelineTime(now));
    }
    updatePlayhead();
  };
  endInput.addEventListener('change',()=>{
    const seconds=parseTime(endInput.value);
    if(seconds===null || seconds<=item.time+.29 || seconds>source.duration){
      renderRange();
      return;
    }
    item.manualEnd=seconds;
    renderRange();
    refreshComment();
  });
  renderRange();

  const remove = make('button','delete-btn','×');
  remove.type = 'button';
  remove.title = '候補を削除';
  remove.addEventListener('click', () => {
    if (activeInlineClose === close) closeInlinePreview();
    source.candidates = source.candidates.filter(x => x !== item);
    syncSources();
  });
  const actions=make('div','review-decision-actions');
  const keep=make('button','review-keep','✓ キープ');
  keep.type='button';
  const reject=make('button','review-reject','✕ 不採用');
  reject.type='button';
  keep.addEventListener('click',()=>decideReview(source,item,'kept'));
  reject.addEventListener('click',()=>decideReview(source,item,'rejected'));
  actions.append(play,keep,reject);
  timeRow.append(remove);
  wrap.append(fields,actions);
  // Three review actions share one row immediately above the inline video.
  entry.append(wrap,inline,rangeEditor);
  applySelection();
  return entry;
}
function refreshComment() {
  const selected = state.candidates.filter(item => item.enabled);
  $('exportEditData').disabled = !buildMultiClipPlan(state.sources,currentClipOptions()).length || state.working || state.exporting || state.geminiProcessing;
  const isMulti = state.sources.length > 1;
  const perSource=sourceTimestampComments(state.sources);
  $('commentText').value = perSource.filter(x=>x.text).map(x=>x.text).join('\n\n');
  $('selectedCount').textContent = String(selected.length);
  const summary = $('selectedSummary');
  summary.replaceChildren(...selected.map((item,i)=>{
    const src = state.sources.find(s => s.id === item.sourceId);
    return make('span','selected-chip', String(i+1) + '. ' +
      (isMulti ? src?.file.name + ' · ' : '') +
      formatTime(item.time));
  }));
  summary.hidden = selected.length === 0;
  updateMontageEditor(state);
  updateStickyBar();
}
function updateStickyBar() {
  const visible=Boolean(state.bins);
  $('stickyBar').hidden=!visible;
  if(!visible) return;
  const count=state.candidates.filter(item=>item.enabled).length;
  const plan=buildMultiClipPlan(state.sources,currentClipOptions());
  const estimate=montageSeconds(plan,getIntroConfiguration());
  const blocked=estimate>185;
  $('stickyCount').textContent=String(count);
  $('stickyDuration').textContent=blocked
    ? '3分超：シーンを減らしてください'
    : '完成予想 '+formatTime(Math.ceil(estimate));
  $('stickyExport').disabled = !plan.length || blocked || state.working || state.exporting || state.geminiProcessing;
  $('stickyExport').textContent=state.exporting?'書き出し中…':'動画を作成する →';
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
    copy.hidden=true; // YouTube timestamp feature is dormant, not deleted.
    copy.addEventListener('click', async()=>{
      const current=sourceTimestampComments([source])[0];
      if(!current?.text){
        copy.textContent='キープした候補がありません'; return;
      }
      try { await navigator.clipboard.writeText(current.text); copy.textContent='✓ コピーしました'; }
      catch { $('commentText').value=current.text; $('commentText').focus();$('commentText').select();copy.textContent='下のテキストをコピー'; }
    });
    // Keep and Reject both remove a scene from the undecided queue.
    // Kept scenes remain available in the dedicated Keep tab.
    const visible=source.candidates.filter(candidate=>reviewTab==='kept'
      ? candidate.enabled===true
      : candidate.enabled!==true && candidate.rejected!==true);
    if (visible.length === 0) { pos += source.candidates.length; continue; }
    headTitle.querySelector('small').textContent=visible.length+'件を表示';
    heading.append(headTitle,copy);
    elements.push(heading);
    for (const candidate of visible) elements.push(row(candidate, pos++));
  }
  $('highlightList').replaceChildren(...elements);
  const keptCount=state.candidates.filter(x=>x.enabled).length;
  const remainingCount=state.candidates.filter(x=>x.enabled!==true && x.rejected!==true).length;
  $('tabAllCount').textContent=String(remainingCount);
  $('tabKeptCount').textContent=String(keptCount);
  $('reviewEmpty').hidden=reviewTab!=='kept' || keptCount>0;
  if(reviewTab==='all' && remainingCount===0 && state.candidates.length>0){
    $('reviewProgress').textContent='すべて確認しました。キープ済みタブで選んだシーンを確認できます。';
  }
  document.querySelectorAll('[data-review-tab]').forEach(button=>{
    const selected=button.dataset.reviewTab===reviewTab;
    button.classList.toggle('active',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
  $('resultCount').textContent = String(state.candidates.length);
  $('emptyResults').hidden = state.candidates.length > 0 || state.candidates.some(x=>x.rejected===true);
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
  if(reviewTab==='kept'){
    reviewTab='all';
    drawResults();
  }
  const target=[...$('highlightList').querySelectorAll('.highlight-entry')]
    .find(entry=>entry.dataset.sourceId===source.id && entry.dataset.sceneId===closest.id);
  target?.querySelector('.play-btn')?.click();
});
window.addEventListener('montage-settings-changed', () => {
  if (state.bins) drawResults();
});
document.querySelectorAll('[data-review-tab]').forEach(button=>{
  button.addEventListener('click',()=>{
    reviewTab=button.dataset.reviewTab==='kept'?'kept':'all';
    if(state.bins)drawResults();
  });
});
$('stickySettings').addEventListener('click',()=>{
  $('montagePanel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('stickyExport').addEventListener('click',()=>{
  if($('stickyExport').disabled || $('montageExport').disabled)return;
  $('montagePanel').scrollIntoView({behavior:'smooth',block:'start'});
  $('montageExport').click();
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


window.addEventListener('gemini-processing-state',()=>{
  const locked=state.geminiProcessing||state.working||state.exporting;
  $('fileInput').disabled=locked;
  $('changeFile').disabled=locked;
  $('addFiles').disabled=locked;
  $('analyzeButton').disabled=locked||!state.sources.length;
  renderSourceList();
  refreshComment();
});
window.addEventListener('montage-export-state', event => {
  state.exporting = !!event.detail?.working;
  $('fileInput').disabled = state.exporting || state.working || state.geminiProcessing;
  $('changeFile').disabled = state.exporting || state.working || state.geminiProcessing;
  $('addFiles').disabled = state.exporting || state.working || state.geminiProcessing;
  $('analyzeButton').disabled = state.exporting || state.working || state.geminiProcessing || !state.sources.length;
  renderSourceList();
  updateStickyBar();
  refreshAIReview(state);
});

$('lineShareCopy').addEventListener('click',async()=>{
  const url=lineShareUrl(window.location.href);
  const fallback=$('lineShareFallback');
  fallback.hidden=true;
  try {
    if(!navigator.clipboard?.writeText)throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(url);
    $('lineShareStatus').textContent='コピーしました。LINEのトークに貼り付けてください。';
  } catch {
    // Safari can deny clipboard access. Keep a selectable URL in the page.
    fallback.value=url;
    fallback.hidden=false;
    fallback.focus();
    fallback.select();
    $('lineShareStatus').textContent='URLを選択しました。コピーしてLINEに貼り付けてください。';
  }
});

$('exportEditData').addEventListener('click',()=>{
  const status=$('exportEditStatus');
  status.textContent='';
  try {
    const plan=buildMultiClipPlan(state.sources,currentClipOptions());
    const payload=createEditTransfer(state.sources,plan);
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download='PeakStamp_Edit_'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent=plan.length+'シーンの編集データを書き出しました（元動画は含まれません）。';
  } catch(e) { status.textContent='書き出し失敗：'+(e?.message||String(e)); }
});

initMontageEditor(state);
initWhisperExperiment(state);
initAIReview(state);
initVideoExplore(state);
initCloudAudioPilot(state);
initGeminiPrimary(state,{decodeAudio:decodeStreaming,commitResults:commitGeminiResults});
const calloutPilot=initGeminiCalloutPilot(state,{refreshGeminiPrimary});
