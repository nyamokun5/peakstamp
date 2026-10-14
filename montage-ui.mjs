import { montageSeconds, exportMontage, estimateMontageMB } from './exporter.mjs?v=intro13';
import { buildMultiClipPlan } from './multi-plan.mjs?v=intro13';
import { formatTime } from './detector.mjs';
import { initIntroEditor, renderIntroPreview, refreshIntroAspect, getIntroConfiguration, getIntroSignature, setIntroWorking } from './intro-ui.mjs?v=intro13';

const $ = id => document.getElementById(id);
function clipOptions() {
  return {
    mode: document.querySelector('input[name="cutMode"]:checked')?.value || 'quiet',
    fixedSeconds: Number($('clipDuration').value),
    tailSeconds: Number($('tailSeconds').value),
  };
}
function updateTitlePreview() {
  const label = document.querySelector('.montage-title-preview strong');
  if (!label) return;
  label.textContent = $('montageTitle').value || 'GOALS!';
  renderIntroPreview();
  const fonts = {
    impact: 'Impact, "Arial Black", sans-serif',
    modern: '"Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"Courier New", monospace',
  };
  label.style.fontFamily = fonts[$('titleFont').value] || fonts.impact;
  label.style.fontSize = 'clamp(16px, ' + (Number($('titleSize').value) * .06) + 'vw, ' +
    (Number($('titleSize').value) * .43) + 'px)';
}
function settingChanged() {
  if (!working) revokeOutput();
  updateMontageEditor(activeState);
  window.dispatchEvent(new Event('montage-settings-changed'));
}

let lastFile = null;
let lastEditSignature = null;
function editSignature(state, plan) {
  return JSON.stringify({
    sources:(state?.sources||[]).map(s=>[s.id,s.file?.name,s.file?.size,s.file?.lastModified]),
    clips:plan.map(c=>[c.sourceId,c.start,c.end,c.zoom || 1]),
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
  const visible = Boolean(state?.file && state?.bins);
  $('montagePanel').hidden = !visible;
  if (lastFile && state.file !== lastFile) revokeOutput();
  lastFile = state?.file || null;
  if (!visible) return;
  const plan = buildMultiClipPlan(state.sources, clipOptions());
  refreshIntroAspect(state,plan);
  const signature = editSignature(state,plan);
  if (!working && lastEditSignature !== null && lastEditSignature !== signature) revokeOutput();
  lastEditSignature = signature;
  $('montageSelected').textContent = plan.length + 'シーンを結合';
  const seconds = montageSeconds(plan);
  $('montageLength').textContent = '完成：約' + formatTime(Math.ceil(seconds));
  const quality = document.querySelector('input[name="exportQuality"]:checked')?.value || 'high';
  $('montageSizeEstimate').textContent = plan.length
    ? '約' + estimateMontageMB(seconds,quality).toFixed(1) + ' MB' : '—';
  $('montageExport').disabled = working || !plan.length;
}
function makeShareFile() {
  if (!lastBlob || !lastName || typeof File !== 'function') return null;
  return new File([lastBlob], lastName, { type: 'video/mp4', lastModified: Date.now() });
}
export function initMontageEditor(state) {
  activeState = state;
  $('clipDuration').addEventListener('input', () => {
    $('clipDurationValue').textContent = $('clipDuration').value + '秒';
    settingChanged();
  });
  $('tailSeconds').addEventListener('input', () => {
    $('tailSecondsValue').textContent = $('tailSeconds').value + '秒';
    settingChanged();
  });
  $('titleSize').addEventListener('input', () => {
    $('titleSizeValue').textContent = $('titleSize').value + '%';
    updateTitlePreview(); settingChanged();
  });
  $('titleFont').addEventListener('change', () => {
    updateTitlePreview(); settingChanged();
  });
  document.querySelectorAll('input[name="cutMode"]').forEach(radio => {
    radio.addEventListener('change', settingChanged);
  });
  $('montageTitle').addEventListener('input', () => setTitle($('montageTitle').value));
  for (const button of document.querySelectorAll('[data-montage-title]')) {
    button.addEventListener('click', () => setTitle(button.dataset.montageTitle));
  }
  for (const radio of document.querySelectorAll('input[name="exportQuality"]')) {
    radio.addEventListener('change', () => {
      if (!working) {
        revokeOutput();
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
        $('montageSaveStatus').textContent = '共有できませんでした：' + (err?.message || String(err)) + '。下のダウンロードリンクをお試しください。';
      }
    }
  });
  $('montageDownload').addEventListener('click', () => {
    $('montageSaveStatus').textContent = 'Safariで保存されない場合は「iPhoneに保存・共有」から「ファイルに保存」を選択してください。';
  });
  $('montageExport').addEventListener('click', async () => {
    if (working || !activeState?.file) return;
    const plan = buildMultiClipPlan(activeState.sources, clipOptions());
    if (!plan.length) {
      displayError('まずシーンにチェックを入れてください。');
      return;
    }
    if (montageSeconds(plan) > 185) {
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
      $('montageShare').hidden = !(fileForShare && navigator.share
        && (!navigator.canShare || navigator.canShare({ files: [fileForShare] })));
      $('montageStatus').textContent = 'MP4作成完了（' + (blob.size / 1048576).toFixed(1) + ' MB）';
      $('montageSaveStatus').textContent = $('montageShare').hidden
        ? '下の「MP4をダウンロード」で保存してください。'
        : '「iPhoneに保存・共有」をタップして保存先を選んでください。';
      $('montageDownload').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      $('montageProgress').hidden = true;
      const detail = err?.message || String(err);
      const storageOrMemory = /quota|out.of.memory|insufficient|not.enough.space|memory|storage|容量|空き領域/i
        .test(String(err?.name || '') + ' ' + detail);
      displayError('書き出せませんでした：' + detail + (storageOrMemory
        ? '。容量または処理用メモリの不足が疑われます。省容量540pで短く作り直し、iPhoneストレージの空きを確認してください。'
        : '。まず省容量540p・30秒程度の動画でお試しください。'));
    } finally {
      setWorking(false);
      const planAfter = buildMultiClipPlan(activeState?.sources || [], clipOptions());
      $('montageExport').disabled = !planAfter.length;
    }
  });
  initIntroEditor(settingChanged,()=>working);
  updateTitlePreview();
  updateMontageEditor(state);
}
