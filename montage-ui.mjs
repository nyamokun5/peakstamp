import { holdExportScreen } from './export-screen.mjs';
import { createEditTransfer } from './edit-transfer.mjs';
import { montageSeconds, exportMontage, estimateMontageMB, formatExportFailure } from './exporter.mjs?v=exportstage1';
import { buildMultiClipPlan } from './multi-plan.mjs?v=goal54';
import { formatTime } from './detector.mjs';
import { initIntroEditor, renderIntroPreview, refreshIntroAspect, getIntroConfiguration, getIntroSignature, setIntroWorking } from './intro-ui.mjs?v=title62';

const $ = id => document.getElementById(id);
function clipOptions(){return {mode:'peak'};}
function updateTitlePreview() {
  // The interactive intro canvas is the only preview. Its font, size,
  // location and background match the MP4 composition code.
  renderIntroPreview();
}

function settingChanged() {

  updateMontageEditor(activeState);
  window.dispatchEvent(new Event('montage-settings-changed'));
}

let lastFile = null;
let completedSignature = null;
let retry = false;
let backgrounded = false;
const interruptionKey = 'peakstamp-active-mp4-v1';
function markActive(active) {
  try {
    if (active) sessionStorage.setItem(interruptionKey, '1');
    else sessionStorage.removeItem(interruptionKey);
  } catch {}
}
function interruptedMessage() {
  retry = true;
  displayError('書き出しが中断されました');
}

function editSignature(state, plan) {
  return JSON.stringify({
    sources:(state?.sources||[]).map(s=>[s.id,s.file?.name,s.file?.size,s.file?.lastModified]),
    clips:plan.map(c=>[c.sourceId,c.start,c.end,c.zoom || 1,c.zoomX ?? .5,c.zoomY ?? .5]),
    title:$('montageTitle').value,
    font:$('titleFont').value,
    titleSize:$('titleSize').value,
    quality:document.querySelector('input[name="exportQuality"]:checked')?.value || 'high',
    intro:getIntroSignature(),
  });
}
let lastUrl = null;
let lastBlob = null;
let lastName = '';
let canShareOutput = false;
let working = false;
let cancelRequested = false;
let activeState = null;

function displayError(message) {
  $('montageError').textContent = message;
  $('montageError').hidden = !message;
}
function revokeOutput() {
  const media = $('montagePreview');
  media.pause();
  media.removeAttribute('src');
  media.load();
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = null;
  lastBlob = null;
  $('hsJsonReminder').hidden = true;
  lastName = '';
  $('montageShare').hidden = true;
  $('montageDownload').hidden = true;
  $('montageOpen').hidden = true;
  $('montageSaveHelp').hidden = true;
  $('montagePreview').hidden = true;
  $('montageSaveStatus').textContent = '';
}
function notify(message, percent) {
  $('montageStatus').textContent = message;
  $('montageProgress').hidden = false;
  $('montageBar').style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + '%';
  $('montagePercent').textContent = Math.round(Number(percent) || 0) + '%';
}
function setWorking(value) {
  working = value;
  $('montageExport').disabled = value;
  $('montageExport').textContent = value ? 'MP4を書き出しています…' : '▶ ハイライト動画を作成する';
  $('montageCancel').hidden = !value;
  setIntroWorking(value);
  window.dispatchEvent(new CustomEvent('montage-export-state',{detail:{working:value}}));
}
function setTitle(value) {
  $('montageTitle').value = value;
  updateTitlePreview();
  for (const button of document.querySelectorAll('[data-montage-title]')) {
    button.classList.toggle('active', button.dataset.montageTitle === value);
  }
  settingChanged();
}

export function updateMontageEditor(state) {
  activeState = state;
  const visible = Boolean(state?.file && (state?.bins ||
    state.sources?.some(source=>Number(source.duration)>0 &&
      (source.candidates||[]).some(c=>c.enabled===true&&c.goalRecordId))));
  $('montagePanel').hidden = !visible;
  if (!state?.sources?.length && lastFile) { revokeOutput(); completedSignature = null; }
  lastFile = state?.file || null;
  if (!visible) return;
  const plan = buildMultiClipPlan(state.sources, clipOptions());
  refreshIntroAspect(state,plan);
  const signature = editSignature(state,plan);
  if (!working) {
    const ready = lastBlob && completedSignature === signature;
    if (lastBlob) {
      const preview=$('montagePreview');
      if (!ready && !preview.hidden) preview.pause();
      preview.hidden=!ready;
      for (const id of ['montageDownload','montageOpen','montageSaveHelp','hsJsonReminder']) $(id).hidden=!ready;
      $('montageShare').hidden=!ready || !canShareOutput;
      $('montageProgress').hidden=!ready;
    }
    $('montageExport').textContent = ready ? '完成した動画を保存・共有' :
      retry ? 'もう一度書き出す' : completedSignature ? '変更を反映して再書き出し' : 'ハイライト動画を作成する';
    if (!ready) $('montageProgress').hidden = true;
  }
  $('montageSelected').textContent = plan.length + 'シーンを結合';
  const seconds = montageSeconds(plan,getIntroConfiguration());
  $('montageLength').textContent = '完成：約' + formatTime(Math.ceil(seconds));
  const quality = document.querySelector('input[name="exportQuality"]:checked')?.value || 'high';
  $('montageSizeEstimate').textContent = plan.length
    ? '約' + estimateMontageMB(seconds,quality).toFixed(1) + ' MB' : '—';
  $('montageExport').disabled = working || state.geminiProcessing || !plan.length;
}
function makeShareFile() {
  if (!lastBlob || !lastName || typeof File !== 'function') return null;
  return new File([lastBlob], lastName, { type: 'video/mp4', lastModified: Date.now() });
}
export function initMontageEditor(state,{onComplete=()=>{},onFailure=()=>{},onTransfer=()=>{}}={}) {
  activeState = state;
  try { if (sessionStorage.getItem(interruptionKey)) interruptedMessage(); } catch {}
  markActive(false);
  document.addEventListener('visibilitychange', () => {
    if (working && document.hidden) backgrounded = true;
  });
  $('titleSize').addEventListener('input', () => {
    $('titleSizeValue').textContent = $('titleSize').value + '%';
    updateTitlePreview(); settingChanged();
  });
  $('titleFont').addEventListener('change', () => {
    updateTitlePreview(); settingChanged();
  });
  $('montageTitle').addEventListener('input', () => setTitle($('montageTitle').value));
  for (const button of document.querySelectorAll('[data-montage-title]')) {
    button.addEventListener('click', () => setTitle(button.dataset.montageTitle));
  }
  for (const radio of document.querySelectorAll('input[name="exportQuality"]')) {
    radio.addEventListener('change', () => {
      if (!working) {
        updateMontageEditor(activeState);
      }
    });
  }
  $('montageCancel').addEventListener('click', () => {
    cancelRequested = true;
    $('montageStatus').textContent = '中止しています…';
  });
  $('montageShare').addEventListener('click', async () => {
    if (!lastBlob) {
      $('montageSaveStatus').textContent = 'まずMP4の書き出しを完了してください。';
      return;
    }
    const file = makeShareFile();
    if (!file || !navigator.share) {
      $('montageSaveStatus').textContent = '共有に非対応です。下の「MP4をダウンロード」をお試しください。';
      return;
    }
    try {
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        $('montageSaveStatus').textContent = 'このサイズの動画は共有できないようです。「MP4をダウンロード」または別タブから保存をお試しください。';
        return;
      }
      await navigator.share({ files: [file], title: lastName });
      $('montageSaveStatus').textContent = '共有メニューから保存先を選択してください。';
    } catch (err) {
      if (err?.name === 'AbortError') {
        $('montageSaveStatus').textContent = '共有を閉じました。もう一度「iPhoneに保存・共有」を押せます。';
      } else {
        $('montageDownload').click();
      }
    }
  });
  $('montageDownload').addEventListener('click', () => {
    $('montageSaveStatus').textContent = 'Safariで保存されない場合は「iPhoneに保存・共有」から「ファイルに保存」を選択してください。';
  });
  $('montageExport').addEventListener('click', async () => {
    if (working || activeState?.geminiProcessing || !activeState?.file) return;
    const plan = buildMultiClipPlan(activeState.sources, clipOptions());
    const signature = editSignature(activeState, plan);
    if (lastBlob && signature === completedSignature) {
      ($('montageShare').hidden ? $('montageDownload') : $('montageShare')).click();
      return;
    }
    if (!plan.length) {
      displayError('まずシーンにチェックを入れてください。');
      return;
    }
    if (montageSeconds(plan,getIntroConfiguration()) > 185) {
      displayError('スマホのメモリ負荷を抑えるため、最初は3分以内にしてください。秒数や候補件数を減らせます。');
      return;
    }
    const quality = document.querySelector('input[name="exportQuality"]:checked')?.value || 'high';
    revokeOutput();
    const file = activeState.file;
    cancelRequested = false;
    displayError('');
    setWorking(true);
    notify('動画の準備中…', 0);
    retry = false;
    backgrounded = false;
    markActive(true);
    const warning = $('montageWakeHelp');
    warning.hidden = true;
    const release = holdExportScreen(() => { warning.hidden = false; });
    let transfer;
    let transferError='';
    try { transfer = createEditTransfer(activeState.sources, plan); }
    catch (error) { transferError=error.message; }
    try {
      const blob = await exportMontage({
        file, sources: activeState.sources, plan, quality,
        title: $('montageTitle').value || 'GOALS!',
        font: $('titleFont').value, titleSize: Number($('titleSize').value),
        intro:getIntroConfiguration(),
        isCancelled: () => cancelRequested,
        onProgress: notify,
      });
      if (cancelRequested) throw new Error('書き出しを中止しました。');
      if (!blob || blob.size < 1024) throw new Error('MP4の生成結果が空です。');
      completedSignature = signature;
      onTransfer(transfer,transferError);
      lastBlob = blob;
      lastName = 'PeakStamp_' + new Date().toISOString().slice(0, 10) + '.mp4';
      lastUrl = URL.createObjectURL(blob);
      $('montagePreview').src = lastUrl;
      $('montagePreview').hidden = false;
      $('montageDownload').href = lastUrl;
      $('montageDownload').download = lastName;
      $('montageDownload').hidden = false;
      $('montageOpen').href = lastUrl;
      $('montageOpen').hidden = false;
      $('montageSaveHelp').hidden = false;
      const fileForShare = makeShareFile();
      canShareOutput=Boolean(fileForShare && navigator.share && (!navigator.canShare || navigator.canShare({files:[fileForShare]})));
      $('montageShare').hidden=!canShareOutput;
      $('montageStatus').textContent = '書き出し完了（' + (blob.size / 1048576).toFixed(1) + ' MB）';
      $('montageSaveStatus').textContent = $('montageShare').hidden
        ? '下の「MP4をダウンロード」で保存してください。'
        : '「iPhoneに保存・共有」をタップして保存先を選んでください。';
      $('hsJsonReminder').hidden=false;
      if (signature === editSignature(activeState,buildMultiClipPlan(activeState.sources,clipOptions()))) onComplete();
    } catch (err) {
      $('montageProgress').hidden = true;
      const message=formatExportFailure(err);
      displayError(message);
      if (backgrounded && !cancelRequested) { interruptedMessage(); $('montageError').title=message; }
      else if(!cancelRequested)onFailure(message);
    } finally {
      release();
      warning.hidden = true;
      markActive(false);
      setWorking(false);
      updateMontageEditor(activeState);
      const planAfter = buildMultiClipPlan(activeState?.sources || [], clipOptions());
      $('montageExport').disabled = !planAfter.length;
    }
  });
  initIntroEditor(settingChanged,()=>working);
  updateTitlePreview();
  updateMontageEditor(state);
}
