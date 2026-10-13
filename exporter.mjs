import { DISSOLVE_SECONDS, dissolveFrames, dissolveOverlap, normalizeFont, normalizeSize, FONT_CHOICES, zoomDrawRect } from './editing-rules.mjs?v=zoom11';
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
  const profile = EXPORT_PROFILES[preset] || EXPORT_PROFILES.high;
  const ratio = Math.min(1, profile.maxWidth / sourceWidth, profile.maxHeight / sourceHeight);
  return {
    width: Math.max(2, Math.floor(sourceWidth * ratio / 2) * 2),
    height: Math.max(2, Math.floor(sourceHeight * ratio / 2) * 2),
    frameRate: FRAME_RATE,
    bitrate: profile.bitrate,
  };
}

/** Output bitrates are approximate; the final file size varies by encoder. */
export const EXPORT_PROFILES = Object.freeze({
  high: Object.freeze({ maxWidth:1920, maxHeight:1080, bitrate:10000000 }),
  standard: Object.freeze({ maxWidth:1280, maxHeight:720, bitrate:4500000 }),
  compact: Object.freeze({ maxWidth:960, maxHeight:540, bitrate:2000000 }),
});
export function estimateMontageMB(seconds, preset='high') {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const bitrate = (EXPORT_PROFILES[preset] || EXPORT_PROFILES.high).bitrate;
  const audioBitrate = 128000;
  // Approximate 6% container overhead; this is NOT a free-storage estimate.
  return Math.round((seconds * (bitrate + audioBitrate) / 8 * 1.06) / 1e6 * 10) / 10;
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
  return Math.max(INTRO_SECONDS,INTRO_SECONDS + plan.reduce((n, clip) => n + (clip.end - clip.start), 0) - dissolveOverlap(plan,FRAME_RATE));
}

/** Make the only intro content a word/title: GOALS!, HIGHLIGHTS!, etc. */
export function drawIntro(context, width, height, title, options = {}) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#081526');
  gradient.addColorStop(1, '#193b57');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const label = String(title || 'GOALS!').trim().slice(0, 32) || 'GOALS!';
  const family = FONT_CHOICES[normalizeFont(options.font)];
  let font = Math.floor(Math.min(height * .23, width * .135) *
    normalizeSize(options.size) / 100);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  do {
    context.font = family.weight + ' ' + font + 'px ' + family.family;
    if (context.measureText(label).width <= width * .9 || font <= 18) break;
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
export async function exportMontage({
  file, sources, plan, title = 'GOALS!', quality = 'high', font = 'impact', titleSize = 100,
  onProgress = () => {}, isCancelled = () => false,
}) {
  if (!plan?.length) throw new Error('切り抜く場面を選んでください。');
  if (!globalThis.VideoEncoder || !globalThis.VideoDecoder) {
    throw new Error('このブラウザは動画の書き出しに必要なWebCodecsに対応していません。');
  }
  // Backwards compatible with the original single-file editor.
  const items = sources?.length
    ? sources.map(s => ({ id: s.id, file: s.file }))
    : file ? [{ id: '__single__', file }] : [];
  const fileMap = new Map(items.map(s => [s.id, s.file]));
  const clips = plan.map(c => ({
    ...c, sourceId: c.sourceId ?? '__single__',
  }));
  if (!items.length || clips.some(c => !fileMap.has(c.sourceId))) {
    throw new Error('選択された動画が見つかりません。ファイルを選び直してください。');
  }
  const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget,
    CanvasSource, AudioSampleSource, VideoSampleSink, AudioSampleSink } = await import(FRAME_SOURCE);
  const check = () => {
    if (isCancelled()) throw new Error('書き出しを中止しました。');
  };
  const openSource = async (sourceId) => {
    check();
    const entry = items.find(x => x.id === sourceId);
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(entry.file, { maxCacheSize: 4 * 1024 * 1024 }),
    });
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack || !(await videoTrack.canDecode())) {
        throw new Error('「' + entry.file.name + '」の映像を読み込めません。');
      }
      const audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack || !(await audioTrack.canDecode())) {
        throw new Error('「' + entry.file.name + '」の音声を読み込めません。音声付きのMOV/MP4を選んでください。');
      }
      return { input, videoTrack, audioTrack, name: entry.file.name };
    } catch (error) {
      input.dispose();
      throw error;
    }
  };

  let output = null, finalized = false, opened = null;
  const liveBitmaps = new Set();
  try {
    // Use the first clip to select output aspect ratio; other ratios get letterboxed.
    opened = await openSource(clips[0].sourceId);
    const sourceWidth = await opened.videoTrack.getDisplayWidth();
    const sourceHeight = await opened.videoTrack.getDisplayHeight();
    const settings = getExportSettings(sourceWidth, sourceHeight, quality);
    const { width, height } = settings;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('動画描画を開始できません。');
    // Full-frame compositing ensures letterboxing also dissolves to black
    // instead of retaining parts of the outgoing frame.
    const incomingCanvas = document.createElement('canvas');
    incomingCanvas.width = width;
    incomingCanvas.height = height;
    const incomingContext = incomingCanvas.getContext('2d', { alpha: false });
    if (!incomingContext) throw new Error('ディゾルブ描画を開始できません。');

    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc', bitrate: settings.bitrate, keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: settings.frameRate });
    const audioSource = new AudioSampleSource({
      codec: 'aac', bitrate: 128000,
      transform: { sampleRate: 48000, numberOfChannels: 2 },
    });
    output.addAudioTrack(audioSource);
    await output.start();
    onProgress('冒頭5秒のタイトルを作成中', 2);
    drawIntro(context, width, height, title, { font, size: titleSize });
    await videoSource.add(0, INTRO_SECONDS, { keyFrame: true });

    const totalFrames = clips.reduce((n, c) => n +
      Math.ceil((c.end - c.start) * settings.frameRate), 0);
    let done = 0;
    let timeline = INTRO_SECONDS;
    let loadedSourceId = clips[0].sourceId;
    let pendingTail = [];
    let videoSink = new VideoSampleSink(opened.videoTrack);
    let audioSink = new AudioSampleSink(opened.audioTrack);

    for (let section = 0; section < clips.length; section++) {
      check();
      const clip = clips[section];
      if (loadedSourceId !== clip.sourceId) {
        opened.input.dispose();
        opened = null;
        loadedSourceId = clip.sourceId;
        opened = await openSource(loadedSourceId);
        videoSink = new VideoSampleSink(opened.videoTrack);
        audioSink = new AudioSampleSink(opened.audioTrack);
      }
      const clipFrames = Math.ceil((clip.end - clip.start) * settings.frameRate);
      const nextClip = clips[section + 1];
      const nextFrames = nextClip ? Math.ceil((nextClip.end - nextClip.start) * settings.frameRate) : 0;
      // Cross-dissolve 15 video frames (0.5 seconds at 30fps) between adjacent clips.
      // With very short clips, bound the overlap to prevent negative durations.
      const outgoingFrames = nextClip ? Math.min(dissolveFrames(settings.frameRate),
        Math.floor(clipFrames / 3), Math.floor(nextFrames / 3)) : 0;
      const incomingFrames = pendingTail.length;
      const previousTail = pendingTail;
      const nextTail = [];
      const clipStart = timeline;
      const stamps = Array.from({ length: clipFrames }, (_, i) =>
        Math.min(clip.end - 0.001, clip.start + i / settings.frameRate));
      const vWidth = await opened.videoTrack.getDisplayWidth();
      const vHeight = await opened.videoTrack.getDisplayHeight();
      // Digital zoom is baked into both ordinary frames and dissolve frames.
      // Canvas bounds clip the centered, enlarged picture without changing output size.
      const { dx,dy,dw,dh }=zoomDrawRect(vWidth,vHeight,width,height,clip.zoom);

      let frame = 0;
      for await (const sample of videoSink.samplesAtTimestamps(stamps)) {
        check();
        if (!sample) throw new Error('「' + opened.name + '」の映像フレームを読み込めませんでした。');
        try {
          context.globalAlpha = 1;
          context.fillStyle = '#000000';
          context.fillRect(0, 0, width, height);
          if (frame < incomingFrames) {
            context.drawImage(previousTail[frame], 0, 0, width, height);
            incomingContext.fillStyle = '#000000';
            incomingContext.fillRect(0, 0, width, height);
            sample.draw(incomingContext, dx, dy, dw, dh);
            context.globalAlpha = (frame + 1) / (incomingFrames + 1);
            context.drawImage(incomingCanvas, 0, 0, width, height);
            context.globalAlpha = 1;
            previousTail[frame].close();
            liveBitmaps.delete(previousTail[frame]);
            previousTail[frame] = null;
          } else {
            sample.draw(context, dx, dy, dw, dh);
          }
          if (frame >= clipFrames - outgoingFrames) {
            // Retain last few source frames to blend with the next clip.
            // No output is written yet; the next clip will emit the mixed frames.
            const frameBitmap = await createImageBitmap(canvas);
            liveBitmaps.add(frameBitmap);
            nextTail.push(frameBitmap);
          } else {
            await videoSource.add(clipStart + frame / settings.frameRate,
              1 / settings.frameRate, { keyFrame: frame === 0 });
          }
        } finally {
          sample.close();
          context.globalAlpha = 1;
        }
        frame++;
        done++;
        if (frame % 15 === 0) {
          onProgress('結合中 ' + (section + 1) + '/' + clips.length + '：' + opened.name,
            Math.min(96, 3 + 91 * done / Math.max(1, totalFrames)));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      for (const image of previousTail) {
        if (image) { image.close(); liveBitmaps.delete(image); }
      }
      if (frame !== clipFrames) throw new Error('映像フレーム数が不足しています。');
      pendingTail = nextTail;

      // Trim each clip's audio to its local interval and shift into montage time.
      // A new sink is used whenever the source changes; this avoids cross-file offsets.
      const first = await audioSink.getSample(clip.start);
      const audioEnd = Math.min(clip.end,clip.start + (clipFrames - outgoingFrames) / settings.frameRate);
      const samples = (async function* () {
        if (first && first.timestamp < clip.start &&
            first.timestamp + first.duration > clip.start) {
          yield first;
        } else if (first) {
          first.close();
        }
        for await (const sample of audioSink.samples(clip.start, audioEnd)) yield sample;
      })();
      for await (const sample of samples) {
        check();
        let cut = null;
        try {
          const rate = sample.sampleRate;
          const from = Math.max(0, Math.min(sample.numberOfFrames,
            Math.ceil((clip.start - sample.timestamp) * rate)));
          const to = Math.max(from, Math.min(sample.numberOfFrames,
            Math.floor((audioEnd - sample.timestamp) * rate)));
          if (to <= from) continue;
          cut = sample.trim(from, to);
          cut.setTimestamp(clipStart + Math.max(0, cut.timestamp - clip.start));
          await audioSource.add(cut);
        } finally { cut?.close(); sample.close(); }
      }
      timeline += (clipFrames - outgoingFrames) / settings.frameRate;
    }

    for (const image of pendingTail) {
      if (image) { image.close(); liveBitmaps.delete(image); }
    }
    check();
    videoSource.close();
    audioSource.close();
    onProgress('MP4を仕上げています', 98);
    await output.finalize();
    finalized = true;
    if (!target.buffer) throw new Error('MP4ファイルを生成できませんでした。');
    onProgress('完了', 100);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    if (output && !finalized) {
      try { await output.cancel(); } catch {}
    }
    throw error;
  } finally {
    for (const image of liveBitmaps) image.close();
    liveBitmaps.clear();
    opened?.input.dispose();
  }
}
