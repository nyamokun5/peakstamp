import { detectHighlights, formatTime, makeComment } from './detector.mjs';
import { initMontageEditor, updateMontageEditor } from './montage-ui.mjs?v=rapid5';
import { buildMultiClipPlan, sourceTimestampComments } from './multi-plan.mjs?v=rapid5';
import { getCandidateEnd, clipMarkerPositions } from './editing-rules.mjs?v=rapid5';
import { montageSeconds } from './exporter.mjs?v=rapid5';
import { DEFAULT_PLAY_LABEL, PLAY_LABELS, nextUndecided, judgeScene, restoreJudgment, replayBounds } from './review-flow.mjs?v=keep7';

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
  if (lastRejected && !state.candidates.includes(lastRejected.item)) clearUndoReview();
  $('stickyBar').hidden = !state.bins;
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
        enabled: old?.enabled ?? false, rejected: old?.rejected ?? false,
        title: old?.title || item.title,
        time: old?.time ?? item.time, manualEnd: old?.manualEnd ?? null };
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
  const close=()=>{
    if(replayVideo){
      replayVideo.pause();
      replayVideo.removeAttribute('src');
      replayVideo.load();
      replayVideo=null;
    }
    inline.replaceChildren();
    inline.hidden=true;
    entry.classList.remove('preview-active');
  };
  const clampAndStop=()=>{
    if(!replayVideo || !Number.isFinite(replayVideo.duration))return;
    const bounds=replayBounds(source,item,(s,c)=>getCandidateEnd(s,c,currentClipOptions()));
    if(replayVideo.currentTime<bounds.start-.06){
      replayVideo.currentTime=bounds.start;
      return;
    }
    if(replayVideo.currentTime >= bounds.end-.06){
      replayVideo.pause();
      if(Math.abs(replayVideo.currentTime-bounds.end)>.08)replayVideo.currentTime=bounds.end;
    }
  };
  const restartReplay=()=>{
    if(!replayVideo)return;
    const bounds=replayBounds(source,item,(s,c)=>getCandidateEnd(s,c,currentClipOptions()));
    if(bounds.end<=bounds.start)return;
    replayVideo.pause();
    replayVideo.currentTime=bounds.start;
    replayVideo.play().catch(()=>{});
  };
  play.addEventListener('click',()=>{
    if(activeInlineClose===close && replayVideo){
      restartReplay();
      return;
    }
    closeInlinePreview();
    $('preview').pause();
    const video=document.createElement('video');
    replayVideo=video;
    video.className='inline-player';
    // The Replay button is the playback control. Suppress iPhone's large
    // native pause overlay and keep playback inline within the clip card.
    video.controls=false;
    video.playsInline=true;
    video.setAttribute('playsinline','');
    video.setAttribute('webkit-playsinline','');
    video.disablePictureInPicture=true;
    video.preload='metadata';
    video.src=source.objectUrl;
    const label=make('p','inline-caption',
      source.file.name+' — '+formatTime(item.time)+' 〜 '+
      formatTime(getCandidateEnd(source,item,currentClipOptions()))+' をリプレイ');
    inline.replaceChildren(label,video);
    inline.hidden=false;
    entry.classList.add('preview-active');
    activeInlineClose=close;
    video.addEventListener('loadedmetadata',restartReplay,{once:true});
    video.addEventListener('timeupdate',clampAndStop);
    video.addEventListener('seeked',clampAndStop);
    video.load();
    if (!autoOpeningNextReplay) {
      inline.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
  });
  const fields = make('div','item-fields');
  const timeRow = make('div','time-row');
  const time = make('input','time-input');
  time.type = 'text';
  time.value = formatTime(item.time);
  time.setAttribute('aria-label','タイムスタンプ');
  time.addEventListener('change', () => {
    const seconds = parseTime(time.value);
    if (seconds === null || seconds >= source.duration ||
      (Number.isFinite(item.manualEnd) && seconds >= item.manualEnd - .24)) {
      time.value = formatTime(item.time);
    } else {
      item.time = seconds;
      renderRange();
      refreshComment();
    }
  });
  timeRow.append(number, badge);
  const score = make('span','score', 'ピーク ' + Math.round(item.peakSeconds) + '秒 / ' + item.db + 'dBFS');
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

  const rangeEditor = make('div','range-editor');
  const rangeHeading = make('div','range-title','切り取り範囲');
  const markerLegend=make('div','range-legend');
  const legendStart=make('span','range-start-label');
  const legendPeak=make('span','range-peak-label');
  const legendEnd=make('span','range-end-label');
  markerLegend.append(legendStart,legendPeak,legendEnd);
  const track=make('div','range-track');
  const fill=make('div','range-fill');
  const startDot=make('span','range-dot range-start');
  const peakDot=make('span','range-dot range-peak');
  const endDot=make('span','range-dot range-end');
  track.append(fill,startDot,peakDot,endDot);
  const rangeInputs=make('div','range-inputs');
  const startBox=make('div','range-field');
  startBox.append(make('label','', '開始'));
  const startControls=make('div','range-adjust');
  const endBox=make('div','range-field');
  const endLabel=make('label','range-auto-label','終了（自動）');
  const endInput=make('input','range-time');
  endInput.type='text';
  endInput.inputMode='text';
  endInput.setAttribute('aria-label','切り取り終了時刻');
  endBox.append(endLabel);
  const endControls=make('div','range-adjust');
  const makeJog=(target,step)=>{
    const jog=make('button','range-jog',step>0?'+1秒':'−1秒');
    jog.type='button';
    jog.addEventListener('click',()=>{
      const current=target==='start' ? item.time : getCandidateEnd(source,item,currentClipOptions());
      const next=Math.round(current)+step;
      if (target==='start') {
        const clipEnd=getCandidateEnd(source,item,currentClipOptions());
        if(next<0 || next>=source.duration || next>=clipEnd-.24) return;
        item.time=next;
        time.value=formatTime(item.time);
      } else {
        if(next<=item.time+.24 || next>source.duration) return;
        item.manualEnd=next;
      }
      renderRange();
      refreshComment();
    });
    return jog;
  };
  startControls.append(makeJog('start',-1),makeJog('start',1));
  endControls.append(makeJog('end',-1),makeJog('end',1));
  const resetEnd=make('button','range-reset','自動に戻す');
  resetEnd.type='button';
  resetEnd.addEventListener('click',()=> {
    item.manualEnd=null;
    renderRange();
    refreshComment();
  });
  endControls.append(resetEnd);
  startBox.append(time,startControls);
  endBox.append(endInput,endControls);
  rangeInputs.append(startBox,endBox);
  rangeEditor.append(rangeHeading,markerLegend,track,rangeInputs);
  fields.append(timeRow, titleGroup, score);
  const renderRange=()=>{
    const end=getCandidateEnd(source,item,currentClipOptions());
    const p=clipMarkerPositions(item.time,item.peakSeconds,end,source.duration);
    fill.style.left=p.start+'%';
    fill.style.width=Math.max(0,p.end-p.start)+'%';
    startDot.style.left=p.start+'%';
    peakDot.style.left=p.peak+'%';
    endDot.style.left=p.end+'%';
    legendStart.textContent='開始 '+formatTime(item.time);
    legendPeak.textContent='ピーク '+formatTime(item.peakSeconds);
    legendEnd.textContent='終了 '+formatTime(end);
    endInput.value=formatTime(end);
    endLabel.textContent=Number.isFinite(item.manualEnd)?'終了（手動）':'終了（自動）';
    resetEnd.hidden=!Number.isFinite(item.manualEnd);
  };
  endInput.addEventListener('change',()=>{
    const seconds=parseTime(endInput.value);
    if(seconds===null || seconds<=item.time+.24 || seconds>source.duration){
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
  updateStickyBar();
}
function updateStickyBar() {
  const visible=Boolean(state.bins);
  $('stickyBar').hidden=!visible;
  if(!visible) return;
  const count=state.candidates.filter(item=>item.enabled).length;
  const plan=buildMultiClipPlan(state.sources,currentClipOptions());
  const estimate=montageSeconds(plan);
  const blocked=estimate>185;
  $('stickyCount').textContent=String(count);
  $('stickyDuration').textContent=blocked
    ? '3分超：シーンを減らしてください'
    : '完成予想 '+formatTime(Math.ceil(estimate));
  $('stickyExport').disabled = !plan.length || blocked || state.working || state.exporting;
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


window.addEventListener('montage-export-state', event => {
  state.exporting = !!event.detail?.working;
  $('fileInput').disabled = state.exporting || state.working;
  $('changeFile').disabled = state.exporting || state.working;
  $('addFiles').disabled = state.exporting || state.working;
  $('analyzeButton').disabled = state.exporting || state.working || !state.sources.length;
  renderSourceList();
  updateStickyBar();
});

initMontageEditor(state);
