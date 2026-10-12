import { buildClipPlan, montageSeconds, exportMontage } from './exporter.mjs';
import { formatTime } from './detector.mjs';

const $ = id => document.getElementById(id);
let lastFile = null;
let lastUrl = null;
let working = false;
let cancelRequested = false;
let activeState = null;

function revokeOutput() {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = null;
  $('montageDownload').hidden = true;
  $('montagePreview').hidden = true;
  $('montagePreview').removeAttribute('src');
  $('montagePreview').load();
}
function notify(message, percent) {
  $('montageStatus').textContent = message;
  $('montageProgress').hidden = false;
  $('montageBar').style.width = Math.max(0, Math.min(100, percent)) + '%';
  $('montagePercent').textContent = Math.round(percent) + '%';
}
function setWorking(value) {
  working = value;
  $('montageExport').disabled = value;
  $('montageExport').textContent = value ? 'MP4を書き出しています…' : '▶ ハイライト動画を作成する';
  $('montageCancel').hidden = !value;
}
function setTitle(value) {
  $('montageTitle').value = value;
  for (const button of document.querySelectorAll('[data-montage-title]')) {
    button.classList.toggle('active', button.dataset.montageTitle === value);
  }
  if (!working) revokeOutput();
}

export function updateMontageEditor(state) {
  activeState = state;
  const visible = Boolean(state?.file && state?.bins);
  $('montagePanel').hidden = !visible;
  if (lastFile && state.file !== lastFile) revokeOutput();
  lastFile = state?.file || null;
  if (!visible) return;
  const plan = buildClipPlan(state.candidates, state.duration,
    Number($('clipDuration').value));
  $('montageSelected').textContent = plan.length + 'シーンを結合';
  $('montageLength').textContent = '完成：約' + formatTime(Math.ceil(montageSeconds(plan)));
  $('montageExport').disabled = working || !plan.length;
  if (!working) revokeOutput();
}
export function initMontageEditor(state) {
  activeState = state;
  $('clipDuration').addEventListener('input', () => {
    $('clipDurationValue').textContent = $('clipDuration').value + '秒';
    updateMontageEditor(activeState);
  });
  $('montageTitle').addEventListener('input', () => setTitle($('montageTitle').value));
  for (const button of document.querySelectorAll('[data-montage-title]')) {
    button.addEventListener('click', () => setTitle(button.dataset.montageTitle));
  }
  $('montageCancel').addEventListener('click', () => {
    cancelRequested = true;
    $('montageStatus').textContent = '中止しています…';
  });
  $('montageExport').addEventListener('click', async () => {
    if (working || !activeState?.file) return;
    const plan = buildClipPlan(activeState.candidates, activeState.duration,
      Number($('clipDuration').value));
    if (!plan.length) {
      $('montageError').textContent = 'まずシーンにチェックを入れてください。';
      return;
    }
    if (montageSeconds(plan) > 185) {
      $('montageError').textContent = 'スマホのメモリ負荷を抑えるため、最初は3分以内にしてください。秒数や候補件数を減らせます。';
      return;
    }
    revokeOutput();
    const file = activeState.file;
    cancelRequested = false;
    $('montageError').textContent = '';
    setWorking(true);
    notify('動画の準備中…', 0);
    try {
      const blob = await exportMontage({
        file,
        plan,
        title: $('montageTitle').value || 'GOALS!',
        isCancelled: () => cancelRequested,
        onProgress: notify,
      });
      if (cancelRequested) throw new Error('書き出しを中止しました。');
      lastUrl = URL.createObjectURL(blob);
      $('montagePreview').src = lastUrl;
      $('montagePreview').hidden = false;
      $('montageDownload').href = lastUrl;
      $('montageDownload').download = 'PeakStamp_' + new Date().toISOString().slice(0,10) + '.mp4';
      $('montageDownload').hidden = false;
      $('montageStatus').textContent = '完成！ 再生して確認し、MP4を保存してください。';
    } catch (err) {
      $('montageProgress').hidden = true;
      $('montageError').textContent = '書き出せませんでした：' + (err?.message || String(err))
        + ' 対応コーデックや端末のメモリが原因の場合は、短い動画で試してください。';
    } finally {
      setWorking(false);
      updateMontageEditorAfterExport();
    }
  });
  updateMontageEditor(state);
}
function updateMontageEditorAfterExport() {
  const plan = buildClipPlan(activeState?.candidates || [], activeState?.duration,
    Number($('clipDuration').value));
  $('montageExport').disabled = !plan.length;
}
