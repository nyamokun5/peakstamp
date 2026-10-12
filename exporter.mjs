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
export async function exportMontage({
  file, sources, plan, title = 'GOALS!', quality = 'high',
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
    drawIntro(context, width, height, title);
    await videoSource.add(0, INTRO_SECONDS, { keyFrame: true });

    const totalFrames = clips.reduce((n, c) => n +
      Math.ceil((c.end - c.start) * settings.frameRate), 0);
    let done = 0;
    let timeline = INTRO_SECONDS;
    let loadedSourceId = clips[0].sourceId;
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
      const clipStart = timeline;
      const stamps = Array.from({ length: clipFrames }, (_, i) =>
        Math.min(clip.end - 0.001, clip.start + i / settings.frameRate));
      const vWidth = await opened.videoTrack.getDisplayWidth();
      const vHeight = await opened.videoTrack.getDisplayHeight();
      const fit = Math.min(width / vWidth, height / vHeight);
      const dw = Math.round(vWidth * fit);
      const dh = Math.round(vHeight * fit);
      const dx = Math.round((width - dw) / 2);
      const dy = Math.round((height - dh) / 2);
      let frame = 0;
      for await (const sample of videoSink.samplesAtTimestamps(stamps)) {
        check();
        if (!sample) throw new Error('「' + opened.name + '」の映像フレームを読み込めませんでした。');
        try {
          context.fillStyle = '#000000';
          context.fillRect(0, 0, width, height);
          sample.draw(context, dx, dy, dw, dh);
          await videoSource.add(clipStart + frame / settings.frameRate,
            1 / settings.frameRate, { keyFrame: frame === 0 });
        } finally { sample.close(); }
        frame++;
        done++;
        if (frame % 15 === 0) {
          onProgress('結合中 ' + (section + 1) + '/' + clips.length + '：' + opened.name,
            Math.min(96, 3 + 91 * done / Math.max(1, totalFrames)));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      if (frame !== clipFrames) throw new Error('映像フレーム数が不足しています。');

      // Trim each clip's audio to its local interval and shift into montage time.
      // A new sink is used whenever the source changes; this avoids cross-file offsets.
      const first = await audioSink.getSample(clip.start);
      const samples = (async function* () {
        if (first && first.timestamp < clip.start &&
            first.timestamp + first.duration > clip.start) {
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
          cut.setTimestamp(clipStart + Math.max(0, cut.timestamp - clip.start));
          await audioSource.add(cut);
        } finally { cut?.close(); sample.close(); }
      }
      timeline += clipFrames / settings.frameRate;
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
    opened?.input.dispose();
  }
}
