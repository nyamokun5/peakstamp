/**
 * PeakStamp: optional on-device Japanese speech recognition experiment.
 * The AI is loaded only after the user taps the experimental button.
 * Audio/video are never sent to the model provider; only model assets are fetched.
 * Recognition is advisory, never automatically changes kept/rejected scenes.
 */
const MODEL_ID = 'onnx-community/whisper-tiny';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MEDIABUNNY_CDN = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs';
const MAX_SNIPPET_SECONDS = 16;
const TARGET_RATE = 16000;

let recognizerPromise = null;
let busy = false;
const $ = id => document.getElementById(id);

export function snippetWindow(peakSeconds, duration, length = MAX_SNIPPET_SECONDS) {
  if (!(duration > 0) || !Number.isFinite(duration)) throw Error('動画の長さが不正です');
  const peak = Math.max(0, Math.min(duration, Number(peakSeconds) || 0));
  const width = Math.min(duration, Math.max(1, length));
  const start = Math.max(0, Math.min(duration - width, peak - 6));
  return { start, end: Math.min(duration, start + width) };
}

export function resampleMono(samples, sourceRate, targetRate = TARGET_RATE) {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || targetRate <= 0) {
    throw Error('音声のサンプルレートが不正です');
  }
  if (!samples?.length) return new Float32Array();
  const length = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = Math.min(samples.length - 1, i * sourceRate / targetRate);
    const left = Math.floor(position);
    const fraction = position - left;
    result[i] = samples[left] * (1 - fraction) +
      samples[Math.min(left + 1, samples.length - 1)] * fraction;
  }
  return result;
}

export function matchingKeywords(transcript) {
  const text = String(transcript || '').replace(/\s+/g, '');
  const words = ['ナイス', 'ゴール', '入った', '決まった', 'やった', 'すごい', 'うまい', '惜しい'];
  return words.filter(word => text.includes(word));
}

export async function extractSnippet(file, start, end, notify = () => {}) {
  if (!file || !(end > start)) throw Error('切り出し範囲を確認してください');
  const { Input, BlobSource, ALL_FORMATS, AudioSampleSink } = await import(MEDIABUNNY_CDN);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024 })
  });
  const chunks = [];
  let frames = 0;
  let sourceRate = 0;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw Error('動画の音声を読み込めません');
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples(start, end)) {
      try {
        const rate = sample.sampleRate;
        if (!sourceRate) sourceRate = rate;
        if (rate !== sourceRate) throw Error('途中で音声形式が切り替わる動画には未対応です');
        const channels = sample.numberOfChannels;
        const data = new Float32Array(sample.allocationSize({ planeIndex: 0, format: 'f32' }) / 4);
        sample.copyTo(data, { planeIndex: 0, format: 'f32' });
        const first = Math.max(0, Math.ceil((start - sample.timestamp) * rate));
        const last = Math.min(sample.numberOfFrames, Math.ceil((end - sample.timestamp) * rate));
        if (last <= first) continue;
        const mono = new Float32Array(last - first);
        for (let f = first; f < last; f++) {
          let sum = 0;
          for (let c = 0; c < channels; c++) sum += data[f * channels + c] || 0;
          mono[f - first] = sum / channels;
        }
        chunks.push(mono);
        frames += mono.length;
        notify(Math.min(100, Math.round((sample.timestamp + sample.duration - start) / (end - start) * 100)));
      } finally {
        sample.close();
      }
    }
  } finally {
    input.dispose();
  }
  if (!frames || !sourceRate) throw Error('選択範囲から音声を取り出せませんでした');
  const joined = new Float32Array(frames);
  let index = 0;
  for (const chunk of chunks) { joined.set(chunk, index); index += chunk.length; }
  return resampleMono(joined, sourceRate);
}

async function loadRecognizer(notify) {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const { pipeline, env } = await import(TRANSFORMERS_CDN);
      env.allowLocalModels = false;
      return pipeline('automatic-speech-recognition', MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: event => {
          if (event?.status === 'progress' && Number.isFinite(event.progress)) {
            notify('AIモデル取得中：' + Math.round(event.progress) + '%');
          }
        }
      });
    })().catch(error => {
      recognizerPromise = null; // Retry after an offline / network failure.
      throw error;
    });
  }
  return recognizerPromise;
}

function setStatus(message, isError = false) {
  const status = $('whisperStatus');
  status.textContent = message;
  status.classList.toggle('whisper-status-error', isError);
}
function formatTime(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' +
    String(n % 60).padStart(2, '0');
}

export function refreshWhisperTargets(state) {
  const select = $('whisperTarget');
  const button = $('whisperButton');
  if (!select || !button) return;
  const prior = select.value;
  const choices = [];
  for (const source of state.sources || []) {
    if (!source.bins) continue;
    for (const candidate of source.candidates || []) {
      choices.push({
        key: source.id + '::' + candidate.id,
        label: source.file.name + ' — ' + formatTime(candidate.peakSeconds) + '（音のピーク）'
      });
    }
  }
  select.replaceChildren(...choices.map(choice => {
    const option = document.createElement('option');
    option.value = choice.key;
    option.textContent = choice.label;
    return option;
  }));
  if (choices.some(c => c.key === prior)) select.value = prior;
  select.disabled = busy || !choices.length;
  button.disabled = busy || state.working || state.exporting || !choices.length;
}

export function initWhisperExperiment(state) {
  const button = $('whisperButton');
  const select = $('whisperTarget');
  if (!button || !select) return;
  select.addEventListener('change', () => {
    $('whisperOutput').hidden = true;
    setStatus('');
  });
  button.addEventListener('click', async () => {
    if (busy || state.working || state.exporting) return;
    const [sourceId, candidateId] = select.value.split('::');
    const source = state.sources.find(s => s.id === sourceId);
    const candidate = source?.candidates.find(c => c.id === candidateId);
    if (!source?.bins || !candidate) {
      setStatus('候補が見つかりません。音声解析をやり直してください。', true);
      return;
    }
    busy = true;
    button.disabled = true;
    select.disabled = true;
    $('whisperOutput').hidden = true;
    try {
      const window = snippetWindow(candidate.peakSeconds, source.duration);
      setStatus('選択した約16秒の音声を取り出しています…');
      const audio = await extractSnippet(source.file, window.start, window.end,
        progress => setStatus('音声を準備中：' + progress + '%'));
      setStatus('Whisper Tinyを読み込み中（初回はモデルのダウンロードが必要です）…');
      const recognizer = await loadRecognizer(message => setStatus(message));
      setStatus('日本語の文字起こしを実行中… Safariを閉じないでください');
      const result = await recognizer(audio, {
        language: 'japanese', task: 'transcribe', return_timestamps: true
      });
      const transcript = String(result?.text || '').trim();
      const matches = matchingKeywords(transcript);
      const output = $('whisperOutput');
      output.replaceChildren();
      const heading = document.createElement('strong');
      heading.textContent = source.file.name + '（' + formatTime(window.start) + '〜' + formatTime(window.end) + '）';
      output.append(heading);
      const content = document.createElement('p');
      content.textContent = transcript || '音声は解析できましたが、認識できる発言がありませんでした。';
      output.append(content);
      const info = document.createElement('small');
      info.textContent = matches.length
        ? '参考キーワード：' + matches.join(' / ') + '（検出結果は要確認）'
        : '参考キーワードなし。歓声・拍手だけでは文字起こしされない場合があります。';
      output.append(info);
      if (Array.isArray(result?.chunks) && result.chunks.length) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '発言の時刻を見る';
        const list = document.createElement('ul');
        for (const chunk of result.chunks) {
          if (!String(chunk.text || '').trim()) continue;
          const item = document.createElement('li');
          item.textContent = formatTime(window.start + (chunk.timestamp?.[0] || 0)) +
            ' ' + String(chunk.text || '').trim();
          list.append(item);
        }
        details.append(summary, list);
        output.append(details);
      }
      output.hidden = false;
      setStatus('完了しました。結果を聞き比べてください。');
    } catch (error) {
      setStatus('Whisperの実行に失敗しました：' + (error?.message || String(error)) +
        '。通常の音声解析は引き続き利用できます。', true);
    } finally {
      busy = false;
      refreshWhisperTargets(state);
    }
  });
  refreshWhisperTargets(state);
}
