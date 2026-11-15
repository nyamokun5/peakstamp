import {createGoalDrafts,actualGoalTime} from './goal-stats.mjs';
import {getCandidateEnd} from './editing-rules.mjs';
const unique=values=>[...new Set(values.filter(Boolean))];
export function goalLabelsForRange(source,start,end,storage){
 const goals=createGoalDrafts(source,storage).items.filter(g=>{
  if(g.status!=='confirmed')return false;
  const at=actualGoalTime(g);if(at>=start&&at<end)return true;
  return (source.candidates||[]).some(c=>c.goalRecordId===g.id&&c.enabled===true&&c.time<end&&getCandidateEnd(source,c,{})>start);
 });
 if(!goals.length)return {label:'ハイライト',scorer:'',assist:''};
 const scorers=unique(goals.map(g=>g.scorer?.trim())),assists=unique(goals.filter(g=>g.assistStatus==='named').map(g=>g.assist?.trim()));
 return {label:'⚽ ゴール',scorer:scorers.join('・'),assist:assists.join('・'),...(goals.length>1?{participants:unique([...scorers,...assists])}:{})};
}
export function clipPeople(clip){return unique(Array.isArray(clip.participants)?clip.participants:[clip.scorer,clip.assist])}
export function clipDisplayLabel(clip){
 if(clip.scorer||clip.label==='⚽ ゴール')return 'ゴール'+(clip.scorer?'('+clip.scorer+')':'')+(clip.assist?'/アシスト('+clip.assist+')':'');
 return clip.label||'ハイライト';
}
