/**
 * PS-local goals draft. No Shoot Sunday API writes.
 * Audio statements are merely candidates until a human confirms the video.
 * Storage is keyed to the full file fingerprint (name, size, lastModified).
 */
export const GOAL_STORE_PREFIX='peakstamp_confirmed_goals_v1:';
export const DEFAULT_GOAL_COMMENT_LAG_SECONDS=5;
// Preserve the recorded voice timestamp, while tracking the actual goal separately.
const roundTime=time=>Math.round(Number(time)*10)/10;
export function estimateGoalTime(commentSeconds,lag=DEFAULT_GOAL_COMMENT_LAG_SECONDS){
 return roundTime(Math.max(0,Number(commentSeconds)-lag));
}
export function actualGoalTime(item){
 if(item&&item.goalTimeSeconds!==undefined&&item.goalTimeSeconds!==null&&
    item.goalTimeSeconds!==''&&Number.isFinite(Number(item.goalTimeSeconds)))
   return roundTime(Number(item.goalTimeSeconds));
 return item?.origin==='manual'?Number(item.timeSeconds):estimateGoalTime(item?.timeSeconds||0);
}
const TRANSCRIPT_PREFIXES=['peakstamp_callout_pilot_v2:','peakstamp_callout_pilot_v1:'];
const clip=(value,max=120)=>typeof value==='string'?value.trim().slice(0,max):'';
const validTime=x=>Number.isFinite(Number(x))&&x!==''&&x!==null&&x!==undefined&&Number(x)>=0;
export function goalSourceKey(source){
 const f=source?.file;
 return f&&typeof f.name==='string'&&Number.isFinite(f.size)&&Number.isFinite(f.lastModified)
  ?[f.name,f.size,f.lastModified].join('::'):null;
}
export function goalSourceInfo(source){
 const f=source?.file;
 return {name:f?.name||'',size:f?.size||0,lastModified:f?.lastModified||0};
}
const readJson=(storage,key)=>{
 try{return JSON.parse(storage?.getItem(key)||'null');}catch{return null;}
};
export function readGoalTranscript(source,storage){
 const key=goalSourceKey(source);
 if(!key)return null;
 for(const prefix of TRANSCRIPT_PREFIXES)for(const scope of ['whole','first']){
  const data=readJson(storage,prefix+key+'::'+scope);
  if(Array.isArray(data?.utterances))
   return {data,scope,legacy:prefix===TRANSCRIPT_PREFIXES[1]};
 }
 return null;
}
export function goalCandidateId(time,quote){
 // Deterministic per source. No tie to highlight edits or Gemini candidate index.
 return 'audio-'+Math.round(Number(time)*10)+'-'+
  Array.from(clip(quote,90)).reduce((h,c)=>((h*31+c.codePointAt(0))>>>0),17).toString(36);
}
export function matchContext(utterances,time){
 if(!validTime(time))return null;
 const starts=(utterances||[]).filter(r=>r?.kind==='match_start'&&validTime(r.time_seconds)&&Number(r.time_seconds)<=Number(time))
  .sort((a,b)=>Number(b.time_seconds)-Number(a.time_seconds));
 if(!starts.length)return null;
 const r=starts[0];
 return {label:clip(r.match_label||r.quote),teamA:clip(r.team_a),teamB:clip(r.team_b),
  time:Number(r.time_seconds)};
}
export function createGoalDrafts(source,storage){
 const key=goalSourceKey(source);
 if(!key)return {items:[],transcript:null};
 const transcript=readGoalTranscript(source,storage);
 const prior=readJson(storage,GOAL_STORE_PREFIX+key);
 const items=(Array.isArray(prior?.items)?prior.items:[])
  .filter(x=>x&&typeof x.id==='string'&&validTime(x.timeSeconds))
  .map(x=>({
   ...x,
   // Old v38 records used timeSeconds for the spoken call: never overwrite it.
   goalTimeSeconds:actualGoalTime(x),
   goalTimeVerified:x.goalTimeVerified===true
  }));
 const events=transcript?.data?.utterances||[];
 for(const event of events){
  if(event?.kind!=='goal_call'||!validTime(event.time_seconds))continue;
  const time=Number(event.time_seconds),id=goalCandidateId(time,event.quote||'');
  // Re-analysis may shift timestamp; do not generate duplicate confirmed goals.
  const already=items.find(r=>r.id===id || (r.origin==='audio'&&
   Math.abs(Number(r.timeSeconds)-time)<=4 &&
   clip(r.scorer).toLowerCase()===clip(event.scorer).toLowerCase()));
  if(already)continue;
  const match=matchContext(events,time);
  items.push({id,origin:'audio',timeSeconds:time,
   goalTimeSeconds:estimateGoalTime(time),goalTimeVerified:false,
   quote:clip(event.quote,240),
   scorer:clip(event.scorer),assist:clip(event.assist),
   assistStatus:clip(event.assist)?'named':'unknown',
   matchLabel:match?.label||'',teamA:match?.teamA||'',teamB:match?.teamB||'',
   matchSeq:'',status:'draft',confirmedAt:null,note:''});
 }
 items.sort((a,b)=>Number(a.timeSeconds)-Number(b.timeSeconds));
 return {items,transcript};
}
export function saveGoalDrafts(source,storage,items){
 const key=goalSourceKey(source);
 if(!key)return false;
 const payload={version:1,source:goalSourceInfo(source),items};
 try{storage.setItem(GOAL_STORE_PREFIX+key,JSON.stringify(payload));return true;}
 catch{return false;}
}
export function makeManualGoal(time,source,storage){
 if(!validTime(time))throw Error('ゴール時刻は0秒以上で指定してください。');
 const t=Number(time);
 const rows=readGoalTranscript(source,storage)?.data?.utterances||[];
 const match=matchContext(rows,t);
 return {id:'manual-'+String(Date.now())+'-'+Math.random().toString(36).slice(2,9),
  origin:'manual',timeSeconds:t,goalTimeSeconds:t,goalTimeVerified:false,
  quote:'手動で追加',
  scorer:'',assist:'',assistStatus:'unknown',matchSeq:'',
  matchLabel:match?.label||'',teamA:match?.teamA||'',teamB:match?.teamB||'',
  status:'draft',confirmedAt:null,note:''};
}
export function validateGoal(goal){
 if(!validTime(goal?.timeSeconds))return '実況の時刻が不正です。';
 if(!validTime(actualGoalTime(goal))||actualGoalTime(goal)<0)return 'ゴールの時刻が不正です。';
 if(goal?.goalTimeSeconds!==undefined&&!validTime(goal.goalTimeSeconds))
  return 'ゴールの時刻が不正です。';
 if(!clip(goal?.scorer))return '得点者を入力してください。';
 if(!['named','none','unknown'].includes(goal?.assistStatus))return 'アシストの状態を選択してください。';
 if(goal.assistStatus==='named'&&!clip(goal.assist))return 'アシスト者を入力してください。';
 if(clip(goal.matchSeq,20) && (!/^\d+$/.test(String(goal.matchSeq))||Number(goal.matchSeq)<1))
  return '試合番号は1以上の数字で指定してください。';
 return null;
}
export function confirmedGoalExport(sources,storage){
 const rows=[];
 for(const source of sources||[]){
  const payload=createGoalDrafts(source,storage);
  for(const x of payload.items.filter(item=>item.status==='confirmed')){
   const problem=validateGoal(x);
   if(problem)continue;
   rows.push({id:x.id,source:goalSourceInfo(source),
    // v2: timeSeconds is now the estimated or reviewed PLAY time.
    timeSeconds:actualGoalTime(x),
    goalTimeSeconds:actualGoalTime(x),
    reactionTimeSeconds:x.origin==='audio'?Number(x.timeSeconds):null,
    goalTimeVerified:x.goalTimeVerified===true,
    timingMethod:x.origin==='audio'?(x.goalTimeVerified===true?'video-reviewed':'comment-minus-5s'):'manual',
    quote:clip(x.quote,240),scorer:clip(x.scorer),
    assistStatus:x.assistStatus,
    assist:x.assistStatus==='named'?clip(x.assist):null,
    matchSeq:clip(String(x.matchSeq||''))?Number(x.matchSeq):null,
    matchLabel:clip(x.matchLabel),teamA:clip(x.teamA),teamB:clip(x.teamB),
    confirmedAt:x.confirmedAt||null,note:clip(x.note,400)});
  }
 }
 return {kind:'peakstamp-confirmed-goals',version:2,
  exportedAt:new Date().toISOString(),status:'local-confirmed-not-uploaded',
  needsMatchSeq:rows.filter(x=>x.matchSeq===null).length,
  goals:rows};
}
