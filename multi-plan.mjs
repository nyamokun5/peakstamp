import { buildClipPlan, INTRO_SECONDS } from './exporter.mjs';
import { quietClipEnd, dissolveOverlap } from './editing-rules.mjs';

/**
 * Produce non-overlapping clips, in user-controlled file order.
 * Candidate times are always LOCAL to their source file.
 */
export function buildMultiClipPlan(sources, options = 16) {
  // Numeric argument remains supported for the previous fixed-duration mode.
  const cfg = typeof options === 'number'
    ? { mode:'fixed', fixedSeconds:options }
    : { mode:'quiet', fixedSeconds:16, tailSeconds:3, ...options };
  const plan=[];
  for(const source of sources||[]){
    if(!source?.file || !source?.bins || !Number.isFinite(source.duration))continue;
    const selected=(source.candidates||[]).filter(c=>c.enabled===true);
    const spans=cfg.mode==='fixed'
      ? buildClipPlan(selected,source.duration,cfg.fixedSeconds)
      : mergeAdaptive(selected.map(c=>({
          start:Math.max(0,Math.min(source.duration,c.time)),
          end:quietClipEnd({bins:source.bins, peakSeconds:c.peakSeconds,
            startSeconds:c.time,duration:source.duration,
            fallbackSeconds:cfg.fixedSeconds,tailSeconds:cfg.tailSeconds})
        })),source.duration);
    for(const span of spans) plan.push({
      sourceId:source.id,sourceName:source.file.name,start:span.start,end:span.end
    });
  }
  return plan;
}
function mergeAdaptive(raw,duration){
  const clips=[];
  for(const segment of raw.filter(c=>c.end>c.start+.2).sort((a,b)=>a.start-b.start)){
    const prev=clips.at(-1);
    if(prev && segment.start<=prev.end+.2)prev.end=Math.max(prev.end,Math.min(duration,segment.end));
    else clips.push({start:segment.start,end:Math.min(duration,segment.end)});
  }
  return clips;
}
/** Timestamps are for each ORIGINAL uploaded video, never cumulative. */
export function sourceTimestampComments(sources){
  return (sources||[]).filter(s=>s.bins).map(source=>{
    const list=(source.candidates||[]).filter(c=>c.enabled===true)
      .slice().sort((a,b)=>a.time-b.time);
    return {
      id:source.id,
      name:source.file.name,
      count:list.length,
      text:list.length ? '⚽ '+source.file.name+' — Highlights\n'
        +list.map(c=>formatLocalTime(c.time)+' '+(c.title?.trim()||'🔥 盛り上がり')).join('\n')
        : ''
    };
  });
}
function formatLocalTime(seconds){
  let s=Math.floor(Math.max(0,Number(seconds)||0));
  const ss=String(s%60).padStart(2,'0');
  s=Math.floor(s/60);
  return s>=60 ? Math.floor(s/60)+':'+String(s%60).padStart(2,'0')+':'+ss :
    String(s).padStart(2,'0')+':'+ss;
}
/** Timestamps refer to the generated montage, not the original videos. */
export function montageChapters(plan, title = 'GOALS!', fps = 30) {
  if (!plan?.length) return '';
  const format = s => {
    const n = Math.floor(Math.max(0, s));
    const hh = Math.floor(n / 3600), mm = Math.floor(n % 3600 / 60), ss = n % 60;
    return hh ? [hh, mm, ss].map(x => String(x).padStart(2, '0')).join(':')
      : [mm, ss].map(x => String(x).padStart(2, '0')).join(':');
  };
  let at = 0;
  const lines = ['0:00 ' + (title || 'GOALS!').trim()];
  at += INTRO_SECONDS;
  let i = 0;
  for (const clip of plan) {
    const label = clip.sourceName || 'Video';
    lines.push(format(at) + ' Highlight ' + (++i) + ' — ' + label);
    at += Math.ceil((clip.end - clip.start) * fps) / fps;
    if(i<plan.length) at -= dissolveOverlap([clip,plan[i]],fps);
  }
  return lines.join('\n');
}
