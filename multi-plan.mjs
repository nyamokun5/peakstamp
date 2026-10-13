import { INTRO_SECONDS } from './exporter.mjs?v=storage8';
import { getCandidateEnd, dissolveOverlap, normalizeSceneZoom } from './editing-rules.mjs?v=zoom10';

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
    const spans = mergeAdaptive(selected.map(candidate => ({
      start: Math.max(0, Math.min(source.duration, Number(candidate.time) || 0)),
      end: getCandidateEnd(source, candidate, cfg),
      zoom: normalizeSceneZoom(candidate.zoom),
    })), source.duration);
    for(const span of spans) plan.push({
      sourceId:source.id,sourceName:source.file.name,start:span.start,end:span.end,
      ...(span.zoom !== 1 ? { zoom:span.zoom } : {})
    });
  }
  return plan;
}
function mergeAdaptive(raw,duration){
  const clips=[];
  for(const segment of raw.filter(c=>c.end>c.start+.2).sort((a,b)=>a.start-b.start)){
    const prev=clips.at(-1);
    if(prev && prev.zoom===segment.zoom && segment.start<=prev.end+.2){
      prev.end=Math.max(prev.end,Math.min(duration,segment.end));
    }else{
      // Different zooms are separate shots. Avoid repeating overlap footage.
      if(prev && prev.zoom!==segment.zoom && segment.start<prev.end){
        prev.end=Math.min(prev.end,segment.start);
        if(prev.end-prev.start<=.2)clips.pop();
      }
      clips.push({start:segment.start,end:Math.min(duration,segment.end),zoom:segment.zoom});
    }
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
        +list.map(c=>formatLocalTime(c.time)+' '+(c.title?.trim()||'ナイスプレイ！')).join('\n')
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
