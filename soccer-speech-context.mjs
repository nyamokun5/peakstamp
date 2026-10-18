/**
 * Experimental, browser-only helpers for Shoot Sunday soccer shout transcription.
 * Context vocabulary is POST-RECOGNITION HINTING, not an ASR initial prompt.
 * Never rewrite Whisper text to force a soccer phrase/person's name.
 */
export const DEFAULT_CONTEXT = [
  'ナイス', '惜しい', '惜しい！惜しい！', '上手いね=うまいね',
  'うまい', 'ナイスパス', 'ナイスシュート', 'ナイスセーブ',
  'ゴール', 'シュート', 'パス', 'キーパー', 'セーブ',
  'いいね', 'いいよ', 'ナイスプレー', '行け', 'いけいけ',
  '戻って', '落として', 'こっち', '逆サイド', 'マイボール',
  'ディフェンス', 'オフサイド', 'ワンツー', 'どんまい',
].join('\n');

export function parseContextVocabulary(input) {
  const raw = String(input || '');
  const entries = raw.split(/[\r\n、,]+/u).map(x => x.trim()).filter(Boolean);
  const unique = new Set(), items = [];
  for (const line of entries) {
    const [term, reading] = line.split(/[=＝]/u, 2).map(x => String(x || '').trim());
    if (!term || term.length > 28) continue;
    const pronunciation = reading || term;
    if (pronunciation.length > 38) continue;
    const key = term + '\u0000' + pronunciation;
    if (unique.has(key)) continue;
    unique.add(key);
    items.push({ term, reading: pronunciation });
    if (items.length >= 90) break;
  }
  return items;
}

export function normalizeJapanese(text) {
  return String(text || '').normalize('NFKC')
    .toLowerCase()
    .replace(/上手い/g, 'うまい')
    .replace(/上手/g, 'うま')
    .replace(/旨い/g, 'うまい')
    .replace(/良い/g, 'いい')
    .replace(/行け/g, 'いけ')
    .replace(/[\u30A1-\u30F6]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\p{P}\p{S}\s\u30FC]/gu, '');
}

function levenshteinWithin(a, b, allowed) {
  if (Math.abs(a.length - b.length) > allowed) return false;
  if (!allowed) return a === b;
  let prior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let best = next[0];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, prior[j] + 1, prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (next[j] < best) best = next[j];
    }
    if (best > allowed) return false;
    prior = next;
  }
  return prior[b.length] <= allowed;
}

function approximateMatch(source, needle) {
  if (needle.length < 3 || source.length < 3) return false;
  const distance = needle.length >= 6 ? 2 : 1;
  for (let len = Math.max(2, needle.length - distance); len <= Math.min(source.length, needle.length + distance); len++) {
    for (let i = 0; i + len <= source.length; i++) {
      if (levenshteinWithin(source.slice(i, i + len), needle, distance)) return true;
    }
  }
  return false;
}

/** Returns _hints_, not automatic corrections. */
export function contextualHints(transcript, vocabulary, maxHints = 4) {
  const source = normalizeJapanese(transcript);
  if (!source) return [];
  const items = Array.isArray(vocabulary) ? vocabulary : parseContextVocabulary(vocabulary);
  const hits = [];
  for (const entry of items) {
    const target = normalizeJapanese(entry.reading);
    if (!target || target.length < 2) continue;
    const exact = source.includes(target);
    if (exact || approximateMatch(source, target)) {
      hits.push({ term: entry.term, kind: exact ? '一致' : '近い発音（要確認）' });
    }
  }
  hits.sort((a, b) => (a.kind === '一致' ? -1 : 1) - (b.kind === '一致' ? -1 : 1));
  return hits.slice(0, maxHints);
}

const VAD_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/';
const ORT_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
let vadPromise = null, scriptPromises = new Map();

function loadScript(url) {
  if (scriptPromises.has(url)) return scriptPromises.get(url);
  const p = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error('発話検出の追加モジュールを取得できません: ' + url));
    document.head.append(script);
  }).catch(error => { scriptPromises.delete(url); throw error; });
  scriptPromises.set(url, p);
  return p;
}

async function loadVAD(onStatus = () => {}) {
  if (!vadPromise) {
    vadPromise = (async () => {
      onStatus('発話検出モデルを準備中（初回のみ取得）…');
      await loadScript(ORT_ASSET_BASE + 'ort.wasm.min.js');
      await loadScript(VAD_ASSET_BASE + 'bundle.min.js');
      if (!globalThis.vad?.NonRealTimeVAD) {
        throw Error('発話検出ライブラリを読み込めませんでした');
      }
      return globalThis.vad.NonRealTimeVAD.new({
        model: 'v5',
        onnxWASMBasePath: ORT_ASSET_BASE,
        baseAssetPath: VAD_ASSET_BASE,
        positiveSpeechThreshold: 0.56,
        negativeSpeechThreshold: 0.38,
        redemptionMs: 320,
        preSpeechPadMs: 130,
        minSpeechMs: 200,
      });
    })().catch(error => { vadPromise = null; throw error; });
  }
  return vadPromise;
}

/**
 * Run Silero speech activity detection on the already decoded 16kHz audio.
 * The library reports milliseconds. False positives and missed short shouts remain possible.
 */
export async function speechSegmentsByVAD(samples, onStatus = () => {}) {
  if (!(samples instanceof Float32Array) || !samples.length) return [];
  const engine = await loadVAD(onStatus);
  onStatus('人の発話区間を検出中…');
  const duration = samples.length / 16000;
  const found = [];
  for await (const segment of engine.run(samples, 16000)) {
    const start = Math.max(0, Number(segment.start) / 1000 - 0.12);
    const end = Math.min(duration, Number(segment.end) / 1000 + 0.15);
    if (Number.isFinite(start) && Number.isFinite(end) && end - start > 0.18) {
      found.push({ start, end, why: 'Silero発話検出（推定）' });
    }
    if (found.length >= 14) break;
  }
  found.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const candidate of found) {
    const last = merged[merged.length - 1];
    if (last && candidate.start <= last.end + .10) {
      last.end = Math.max(last.end, candidate.end);
    } else {
      merged.push({ ...candidate });
    }
  }
  return merged;
}
