import { montageSeconds, exportMontage } from './exporter.mjs?v=multi2';
import { buildMultiClipPlan } from './multi-plan.mjs?v=multi2';
import { formatTime } from './detector.mjs';

const $ = id => document.getElementById(id);
let lastFile = null;
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
}
function setTitle(value) {
  $('montageTitle').value = value;
  const preview = document.querySelector('.montage-title-preview strong');
  if (preview) preview.textContent = value || 'GOALS!';
  for (const button of document.querySelectorAll('[data-montage-title]')) {
    button.classList.toggle('active', button.dataset.montageTitle === value);
  }
  if (!working) revokeOutput();
  window.dispatchEvent(new Event('montage-settings-changed'));
}

export function updateMontageEditor(state) {
  activeState = state;
  const visible = Boolean(state?.file && state?.bins);
  $('montagePanel').hidden = !visible;
  if (lastFile && state.file !== lastFile) revokeOutput();
  lastFile = state?.file || null;
  if (!visible) return;
  const plan = buildMultiClipPlan(state.sources, Number($('clipDuration').value));
  $('montageSelected').textContent = plan.length + 'シーンを結合';
  $('montageLength').textContent = '完成：約' + formatTime(Math.ceil(montageSeconds(plan)));
  $('montageExport').disabled = working || !plan.length;
  if (!working) revokeOutput();
}
function makeShareFile() {
  if (!lastBlob || !lastName || typeof File !== 'function') return null;
  return new File([lastBlob], lastName, { type: 'video/mp4', lastModified: Date.now() });
}
export function initMontageEditor(state) {
  activeState = state;
  $('clipDuration').addEventListener('input', () => {
    $('clipDurationValue').textContent = $('clipDuration').value + '秒';
    updateMontageEditor(activeState);
    window.dispatchEvent(new Event('montage-settings-changed'));
  });
  $('montageTitle').addEventListener('input', () => setTitle($('montageTitle').value));
  for (const button of document.querySelectorAll('[data-montage-title]')) {
    button.addEventListener('click', () => setTitle(button.dataset.montageTitle));
  }
  for (const radio of document.querySelectorAll('input[name="exportQuality"]')) {
    radio.addEventListener('change', () => {
      if (!working) revokeOutput();
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
    const plan = buildMultiClipPlan(activeState.sources, Number($('clipDuration').value));
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
      displayError('書き出せませんでした：' + (err?.message || String(err))
        + '。最初は標準720p・30秒程度の動画でお試しください。');
    } finally {
      setWorking(false);
      const planAfter = buildMultiClipPlan(activeState?.sources || [], Number($('clipDuration').value));
      $('montageExport').disabled = !planAfter.length;
    }
  });
  updateMontageEditor(state);
}
