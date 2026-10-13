/** PeakStamp pure editing rules — no media file operations here. */
export const DISSOLVE_SECONDS = 0.5;
export const END_PADDING_SECONDS = 3;
export const QUIET_CONFIRM_SECONDS = 1.5;
export const FONT_CHOICES = Object.freeze({
  impact: { label: 'インパクト', family: 'Impact, "Arial Black", sans-serif', weight: '900' },
  modern: { label: 'モダン', family: '"Helvetica Neue", Arial, sans-serif', weight: '800' },
  serif: { label: 'セリフ', family: 'Georgia, "Times New Roman", serif', weight: 'bold' },
  mono: { label: 'モノスペース', family: '"Courier New", monospace', weight: 'bold' },
});
export function normalizeFont(font) {
  return FONT_CHOICES[font] ? font : 'impact';
}
export function normalizeSize(size) {
  const n=Number(size);
  return Number.isFinite(n) ? Math.min(150,Math.max(60,Math.round(n))) : 100;
}
/** Find an extended quiet stretch after a cheer, relative to the local peak.
 * The whole detection uses audio levels already measured on the device.
 * No low-volume section -> fall back to the fixed clip length.
 */
export function quietClipEnd({
  bins, peakSeconds, startSeconds, duration,
  fallbackSeconds = 16, tailSeconds = END_PADDING_SECONDS, maxSeconds = 40,
  binSeconds = 0.25, quietSeconds = QUIET_CONFIRM_SECONDS,
} = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const start = Math.max(0,Math.min(duration,Number(startSeconds)||0));
  const peak = Math.max(start,Math.min(duration,Number(peakSeconds)||start));
  const fallback = Math.min(duration,start + Math.max(6,Number(fallbackSeconds)||16));
  if (!Array.isArray(bins) || !bins.length) return fallback;
  const window = Math.max(1,Math.round(quietSeconds/binSeconds));
  const max = Math.min(duration,start+Math.max(10,Number(maxSeconds)||40));
  const peakAt=Math.max(0,Math.min(bins.length-1,Math.round(peak/binSeconds)));
  const radius=Math.max(1,Math.ceil(1/binSeconds));
  let peakRms=0;
  for(let i=Math.max(0,peakAt-radius);i<=Math.min(bins.length-1,peakAt+radius);i++){
    peakRms=Math.max(peakRms,Number(bins[i].rms)||0);
  }
  if(peakRms < .008) return fallback;
  // Based on the noise floor observed before the cheer. The level must drop
  // to roughly 35% of the cheer but cannot go below a small noise-floor margin.
  const startBaseline=Math.max(0,Math.round((peak-9)/binSeconds));
  const endBaseline=Math.max(startBaseline+1,Math.round((peak-2)/binSeconds));
  const baseline=(bins.slice(startBaseline,endBaseline).reduce((n,b)=>n+Number(b.rms||0),0)/
    Math.max(1,endBaseline-startBaseline));
  const quietThreshold=Math.min(peakRms*.42,Math.max(.008,baseline*1.35));
  const begin=Math.max(peak + 2.5,start + 5);
  const beginIndex=Math.max(0,Math.ceil(begin/binSeconds));
  const stopIndex=Math.min(bins.length-window,Math.floor(max/binSeconds)-window);
  for(let i=beginIndex;i<=stopIndex;i++){
    let quiet=true;
    for(let j=0;j<window;j++){
      if((Number(bins[i+j]?.rms)||0)>quietThreshold){quiet=false;break;}
    }
    if(quiet){
      const finish=(i+window)*binSeconds + Math.max(0,Number(tailSeconds)||0);
      return Math.min(duration,Math.max(start+6,Math.min(max,finish)));
    }
  }
  return fallback;
}
export function dissolveFrames(frameRate = 30) {
  return Math.max(1,Math.round(DISSOLVE_SECONDS*frameRate));
}
export function dissolveOverlap(plan, fps = 30) {
  const frames=dissolveFrames(fps);
  return (plan||[]).slice(1).reduce((sum,item,i)=>{
    const a=plan[i],b=item;
    const aFrames=Math.ceil((a.end-a.start)*fps);
    const bFrames=Math.ceil((b.end-b.start)*fps);
    return sum+(Math.min(frames,Math.floor(aFrames/3),Math.floor(bFrames/3))/fps);
  },0);
}


/** Return the effective clip endpoint, honoring a user-set value. */
export function getCandidateEnd(source, item, options = {}) {
  const duration = Number(source?.duration) || 0;
  if (duration <= 0) return 0;
  const start = Math.max(0, Math.min(duration, Number(item?.time) || 0));
  if (Number.isFinite(item?.manualEnd)) {
    return Math.min(duration, Math.max(start + 0.25, Number(item.manualEnd)));
  }
  const seconds = Number(options.fixedSeconds) || 16;
  if (options.mode === 'fixed') return Math.min(duration, start + Math.max(6, Math.min(40,seconds)));
  return quietClipEnd({
    bins: source?.bins, peakSeconds: item?.peakSeconds,
    startSeconds: start, duration,
    fallbackSeconds: seconds, tailSeconds: Number(options.tailSeconds) || 3,
  });
}

/** Percent marker positions in a small view window around the action. */
export function clipMarkerPositions(start, peak, end, duration) {
  const maxDuration = Math.max(0, Number(duration) || 0);
  const a = Math.max(0, Math.min(maxDuration, Number(start)||0));
  const p = Math.max(0, Math.min(maxDuration, Number(peak)||a));
  const e = Math.max(a, Math.min(maxDuration, Number(end)||a));
  const left = Math.max(0, a - 3);
  const right = Math.min(maxDuration, Math.max(e,p,a+1)+3);
  const span = Math.max(1, right-left);
  const pc=t=>Math.max(0,Math.min(100,(t-left)/span*100));
  return { start:pc(a), peak:pc(p), end:pc(e), left, right };
}

/** Positive source-relative timestamps with tenths, including during fine scrubbing. */
export function formatTimelineTime(seconds) {
  const ticks = Math.round(Math.max(0, Number(seconds) || 0) * 10);
  const whole = Math.floor(ticks / 10);
  const tenth = ticks % 10;
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor(whole / 60) % 60;
  const ss = whole % 60;
  const base = hh
    ? hh + ':' + String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0')
    : String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
  return base + '.' + tenth;
}
/** Position-to-timestamp map for the currently visible (zoomed) scene timeline. */
export function timelineTimeAt(clientX, rect, left, right, step = 0.25) {
  const width = Math.max(1, Number(rect?.width) || 1);
  const ratio = Math.max(0, Math.min(1, (Number(clientX) - (Number(rect?.left) || 0)) / width));
  const t = left + (right-left) * ratio;
  const snap = Math.max(0.01, Number(step) || 0.25);
  return Math.max(0, Math.round(Math.round(t / snap) * snap * 100) / 100);
}
export function clampTimelineEdge(edge, seconds, start, end, duration) {
  const length = Math.max(0, Number(duration) || 0);
  const at = Math.max(0, Math.min(length, Number(seconds) || 0));
  if (edge === 'start') return Math.min(Math.max(0, end - 0.3), at);
  if (edge === 'end') return Math.max(Math.min(length, start + 0.3), at);
  throw new Error('Invalid timeline handle');
}
