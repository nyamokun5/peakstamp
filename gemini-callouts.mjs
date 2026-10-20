/**
 * Audio-only commentary transcription pilot.
 * Keep all tagged utterances separate from the regular Gemini highlights.
 * The value "1対2" is a spoken team matchup label, NOT necessarily a score.
 */
const TYPES=new Set(['match_start','goal_call']);
const limit=(n,a,b)=>Math.min(b,Math.max(a,n));
const clean=v=>typeof v==='string'?v.trim().slice(0,160):'';
const optional=v=>clean(v)||null;
export function normalizeCallouts(rows,duration){
 const seconds=Number(duration);
 if(!Number.isFinite(seconds)||seconds<=0||!Array.isArray(rows))return [];
 return rows.slice(0,30).flatMap(row=>{
  const time=Number(row?.time_seconds);
  const quote=clean(row?.quote);
  if(!TYPES.has(row?.kind)||!Number.isFinite(time)||time<0||time>seconds+1||!quote)return [];
  return [{time_seconds:+limit(time,0,seconds).toFixed(1),kind:row.kind,quote,
   match_label:optional(row.match_label),team_a:optional(row.team_a),
   team_b:optional(row.team_b),scorer:optional(row.scorer),assist:optional(row.assist),
   confidence:['high','medium','low'].includes(row.confidence)?row.confidence:'low'}];
 });
}
export function mergeCalloutSegments(responses,duration){
 const seconds=Number(duration),rows=[];
 if(!Number.isFinite(seconds)||seconds<=0)return [];
 for(const segment of responses||[]){
  const offset=Number(segment?.startSeconds);
  const span=Number(segment?.durationSeconds);
  if(!Number.isFinite(offset)||offset<0||!Number.isFinite(span)||span<=0)continue;
  const items=normalizeCallouts(segment.utterances,span);
  for(const item of items)if(offset+item.time_seconds<=seconds+1){
   rows.push({...item,time_seconds:+limit(offset+item.time_seconds,0,seconds).toFixed(1)});
  }
 }
 rows.sort((a,b)=>a.time_seconds-b.time_seconds);
 const combined=[];
 const canonical=t=>String(t||'').normalize('NFKC').toLowerCase().replace(/[\s。、！？!?,.]/g,'');
 for(const row of rows){
  // Overlapping 70-second audio regions can report the same phrase.
  // Avoid merging distinct goals merely because they are close in time.
  const duplicate=combined.find(last=>last.kind===row.kind &&
   Math.abs(last.time_seconds-row.time_seconds)<=3 &&
   canonical(last.quote)===canonical(row.quote));
  if(!duplicate){combined.push(row);continue;}
  const rank={high:3,medium:2,low:1};
  if(rank[row.confidence]>rank[duplicate.confidence]){
   Object.assign(duplicate,row,{time_seconds:Math.min(duplicate.time_seconds,row.time_seconds)});
  }
 }
 return combined.slice(0,120);
}
export function formatCalloutTime(value){
 const sec=Math.max(0,Math.floor(Number(value)||0));
 return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
}
