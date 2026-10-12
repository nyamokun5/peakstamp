/**
 * PeakStamp: automatic highlight montage with a 5-second title card.
 * Only processes an explicitly selected local file, never uploads it.
 */
export const INTRO_SECONDS = 5;
export const FRAME_RATE = 30;

/** Preserve the source aspect ratio and never upscale low-resolution video. */
export function getExportSettings(sourceWidth, sourceHeight, preset = 'high') {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('映像サイズを取得できません。');
  }
  const high = preset !== 'standard';
  const boundWidth = high ? 1920 : 1280;
  const boundHeight = high ? 1080 : 720;
  const ratio = Math.min(1, boundWidth / sourceWidth, boundHeight / sourceHeight);
  return {
    width: Math.max(2, Math.floor(sourceWidth * ratio / 2) * 2),
    height: Math.max(2, Math.floor(sourceHeight * ratio / 2) * 2),
    frameRate: FRAME_RATE,
    bitrate: high ? 10000000 : 4500000,
  };
}


/** Return sorted, nonoverlapping intervals from the candidates the user checked. */
export function buildClipPlan(candidates, duration, seconds = 16) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const length = Math.max(6, Math.min(40, Number(seconds) || 16));
  const raw = (candidates || [])
    .filter(x => x && x.enabled !== false && Number.isFinite(x.time))
    .map(x => ({ start: Math.max(0, Math.min(duration, x.time)),
      end: Math.min(duration, Math.max(0, x.time) + length) }))
    .filter(x => x.end - x.start > 0.2)
    .sort((a, b) => a.start - b.start);
  const clips = [];
  for (const segment of raw) {
    const prev = clips.at(-1);
    if (prev && segment.start <= prev.end + 0.2) {
      prev.end = Math.max(prev.end, segment.end);
    } else {
      clips.push({ ...segment });
    }
  }
  return clips;
}

export function montageSeconds(plan) {
  return INTRO_SECONDS + plan.reduce((n, clip) => n + (clip.end - clip.start), 0);
}

/** Make the only intro content a word/title: GOALS!, HIGHLIGHTS!, etc. */
export function drawIntro(context, width, height, title) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#081526');
  gradient.addColorStop(1, '#193b57');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const label = String(title || 'GOALS!').trim().slice(0, 32) || 'GOALS!';
  let font = Math.floor(Math.min(height * 0.23, width * 0.135));
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  do {
    context.font = '900 ' + font + 'px Arial, Helvetica, sans-serif';
    if (context.measureText(label).width <= width * 0.9 || font <= 18) break;
    font -= 3;
  } while (font > 18);
  context.fillStyle = '#ffffff';
  context.fillText(label, width / 2, height / 2);
}

const FRAME_SOURCE = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs';

/**
 * Re-encode up to 1080p MP4 (AVC/AAC) entirely within the browser.
 * iPhone support is codec/OS dependent; failure is reported, not hidden.
 */
export async function exportMontage({ file, plan, title = 'GOALS!', quality = 'high', onProgress = () => {}, isCancelled = () => false }) {
  if (!file || !plan?.length) throw new Error('動画と切り抜く場面を選んでください。');
  if (!globalThis.VideoEncoder || !globalThis.VideoDecoder) {
    throw new Error('このブラウザは動画の書き出しに必要なWebCodecsに対応していません。');
  }
  const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget,
    CanvasSource, AudioSampleSource, VideoSampleSink, AudioSampleSink } = await import(FRAME_SOURCE);
  let input = null, output = null, finalized = false;
  const check = () => { if (isCancelled()) throw new Error('書き出しを中止しました。'); };
  try {
    check();
    input = new Input({ formats: ALL_FORMATS,
      source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024 }) });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('このファイルには映像トラックがありません。');
    if (!(await videoTrack.canDecode())) throw new Error('この端末は動画の映像形式を読み込めません。');
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack && !(await audioTrack.canDecode())) throw new Error('この端末は動画の音声形式を読み込めません。');

    const sourceWidth = await videoTrack.getDisplayWidth();
    const sourceHeight = await videoTrack.getDisplayHeight();
    if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error('映像サイズを取得できません。');
    const settings = getExportSettings(sourceWidth, sourceHeight, quality);
    const { width, height } = settings;
    onProgress('出力設定：' + width + '×' + height + '・' + settings.frameRate + 'fps', 1);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('画像の描画機能を開始できません。');

    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new CanvasSource(canvas,
      { codec: 'avc', bitrate: settings.bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(videoSource, { frameRate: settings.frameRate });
    const audioSource = audioTrack ? new AudioSampleSource({ codec: 'aac', bitrate: 128000 }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    onProgress('タイトル（5秒）を作成しています', 2);
    drawIntro(context, width, height, title);
    await videoSource.add(0, INTRO_SECONDS, { keyFrame: true });

    const videoSink = new VideoSampleSink(videoTrack);
    const audioSink = audioTrack ? new AudioSampleSink(audioTrack) : null;
    const totalFrames = plan.reduce((n, c) => n + Math.ceil((c.end - c.start) * FRAME_RATE), 0);
    let processed = 0;
    let timeline = INTRO_SECONDS;

    for (let section = 0; section < plan.length; section++) {
      check();
      const clip = plan[section];
      const frames = Math.ceil((clip.end - clip.start) * FRAME_RATE);
      const stamps = Array.from({ length: frames }, (_, i) =>
        Math.min(clip.end - 0.001, clip.start + i / FRAME_RATE));
      let idx = 0;
      for await (const sample of videoSink.samplesAtTimestamps(stamps)) {
        check();
        if (!sample) throw new Error('動画から一部のフレームを取り出せませんでした。');
        try {
          context.fillStyle = '#000';
          context.fillRect(0, 0, width, height);
          sample.draw(context, 0, 0, width, height);
          await videoSource.add(timeline + idx / FRAME_RATE, 1 / FRAME_RATE,
            { keyFrame: idx === 0 });
        } finally { sample.close(); }
        idx++; processed++;
        if (idx % 12 === 0) {
          onProgress('映像を書き出しています（' + (section + 1) + '/' + plan.length + '）',
            Math.min(96, 3 + processed / Math.max(1, totalFrames) * 91));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Keep original field sound. Preserve the audio offset within each clip,
      // crop boundary samples, and rebase timestamps to their montage positions.
      if (audioSink && audioSource) {
        const first = await audioSink.getSample(clip.start);
        const samples = (async function* () {
          if (first && first.timestamp < clip.start && first.timestamp + first.duration > clip.start) {
            yield first;
          } else if (first) {
            first.close();
          }
          for await (const sample of audioSink.samples(clip.start, clip.end)) yield sample;
        })();
        for await (const sample of samples) {
          check();
          let cut = null;
          try {
            const rate = sample.sampleRate;
            const from = Math.max(0, Math.min(sample.numberOfFrames,
              Math.ceil((clip.start - sample.timestamp) * rate)));
            const to = Math.max(from, Math.min(sample.numberOfFrames,
              Math.floor((clip.end - sample.timestamp) * rate)));
            if (to <= from) continue;
            cut = sample.trim(from, to);
            cut.setTimestamp(timeline + Math.max(0, cut.timestamp - clip.start));
            await audioSource.add(cut);
          } finally { cut?.close(); sample.close(); }
        }
      }
      timeline += frames / FRAME_RATE;
    }

    check();
    videoSource.close();
    audioSource?.close();
    onProgress('MP4を仕上げています', 98);
    await output.finalize();
    finalized = true;
    if (!target.buffer) throw new Error('書き出したMP4を取得できません。');
    onProgress('完了', 100);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (err) {
    if (output && !finalized) {
      try { await output.cancel(); } catch {}
    }
    throw err;
  } finally {
    input?.dispose();
  }
}
