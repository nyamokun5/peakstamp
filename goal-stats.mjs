/**
 * PS-local goals draft. No Shoot Sunday API writes.
 * Audio statements are merely candidates until a human confirms the video.
 * Storage is keyed to the full file fingerprint (name, size, lastModified).
 */
export const GOAL_STORE_PREFIX='peakstamp_confirmed_goals_v1:';
export const DEFAULT_GOAL_COMMENT_LAG_SECONDS=10;
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
const GEMINI_RESULT_CACHE_KEY='peakstamp_gemini_primary_json_v1';
const GEMINI_GOAL_CONFIDENCES=new Set(['high','medium','low']);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
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
 const cached=readJson(storage,GEMINI_RESULT_CACHE_KEY)?.[key];
 const unified=Array.isArray(cached?.utterances)?cached.utterances:null;
 let legacy=null;
 for(const prefix of TRANSCRIPT_PREFIXES){
  for(const scope of ['whole','first']){
   const data=readJson(storage,prefix+key+'::'+scope);
   if(Array.isArray(data?.utterances)){
    legacy={data,scope,legacy:prefix===TRANSCRIPT_PREFIXES[1]};break;
   }
  }
  if(legacy)break;
 }
 if(!unified)return legacy;
 // One request produces independent highlight events and explicit goal calls.
 // Bring over distinct old pilot utterances without reanalyzing or guessing.
 const rows=unified.map(x=>({...x}));
 for(const extra of legacy?.data?.utterances||[]){
  const prior=rows.find(x=>x.kind===extra.kind &&
   Math.abs(Number(x.time_seconds)-Number(extra.time_seconds))<=4 &&
   (!x.scorer||!extra.scorer||x.scorer===extra.scorer));
  if(prior){
   for(const key of ['scorer','assist','match_label','team_a','team_b'])
    if(!prior[key]&&extra[key])prior[key]=extra[key];
  }else rows.push(extra);
 }
 rows.sort((a,b)=>Number(a.time_seconds)-Number(b.time_seconds));
 return {data:{utterances:rows},scope:'unified',legacy:false};
}
/** Promote audio-only Gemini goal_reaction results to UNCONFIRMED video-review candidates. */
export function readGeminiGoalReactions(source,storage){
 const key=goalSourceKey(source);
 if(!key)return [];
 const all=readJson(storage,GEMINI_RESULT_CACHE_KEY);
 const cached=all&&typeof all==='object'?all[key]:null;
 const duration=Number(source?.duration)||Number(cached?.duration_seconds)||0;
 const normalize=(e,fromEditor=false)=>{
  const kind=fromEditor?e?.geminiType:e?.type;
  const confidence=fromEditor?e?.geminiConfidence:e?.confidence;
  const rawTime=fromEditor?e?.peakSeconds:e?.reaction_time_seconds;
  const t=Number(rawTime);
  if(kind!=='goal_reaction'||!GEMINI_GOAL_CONFIDENCES.has(confidence)||
   !Number.isFinite(t)||rawTime==null||t<0||(duration>0&&t>duration+2))return null;
  const time=roundTime(duration>0?Math.min(duration,t):t);
  const requestedStart=e?.suggested_clip_start_seconds;
  const requestedEnd=e?.suggested_clip_end_seconds;
  const start=typeof requestedStart==='number'&&Number.isFinite(requestedStart)?requestedStart:time-8;
  const end=typeof requestedEnd==='number'&&Number.isFinite(requestedEnd)?requestedEnd:time+5;
  const upper=Math.max(duration,time);
  return {time,confidence,
   quote:clip(fromEditor?e.geminiQuote:e.quote,240),
   clue:clip(fromEditor?e.geminiReason:e.audible_clue,400),
   start:roundTime(clamp(start,0,upper)),end:roundTime(clamp(end,0,upper))};
 };
 if(Array.isArray(cached?.events))
  return cached.events.map(event=>normalize(event)).filter(Boolean);
 // Safari may preserve editor proposals even when localStorage is unavailable.
 if(source?.analysisEngine==='gemini'&&Array.isArray(source?.candidates))
  return source.candidates.filter(e=>e?.origin==='gemini')
   .map(e=>normalize(e,true)).filter(Boolean);
 return [];
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
 return {label:clip(r.match_label),teamA:clip(r.team_a),teamB:clip(r.team_b),
  time:Number(r.time_seconds)};
}
/**
 * Prefill only explicitly detected names/matchup facts. Keep user edits,
 * manually added goals, and already confirmed goals authoritative.
 */
export function prefillDetectedGoalFields(goal,event,utterances=[]){
 if(!goal||!event||goal.status!=='draft'||goal.origin==='manual')return goal;
 const edited=new Set(Array.isArray(goal.userEditedGoalFields)?goal.userEditedGoalFields:[]);
 const fill=(field,value)=>{
  const proposed=clip(value);
  if(proposed&&!edited.has(field)&&!clip(goal[field]))goal[field]=proposed;
 };
 const context=matchContext(utterances,event.time_seconds);
 fill('scorer',event.scorer);
 if(!goal.rawScorer&&clip(event.scorer))goal.rawScorer=clip(event.scorer);
 if(!goal.rawAssist&&clip(event.assist))goal.rawAssist=clip(event.assist);
 if(!edited.has('assistStatus')&&!edited.has('assist')&&goal.assistStatus!=='none'){
  fill('assist',event.assist);
  if(clip(goal.assist)&&goal.assistStatus!=='named')goal.assistStatus='named';
  else if(goal.assistStatus==='unknown'&&!clip(goal.assist)&&
   /アシストなし|アシスト無し|no assist/i.test(String(event.quote||'')))
   goal.assistStatus='none';
 }
 fill('matchLabel',event.match_label||context?.label);
 fill('teamA',event.team_a||context?.teamA);
 fill('teamB',event.team_b||context?.teamB);
 return goal;
}
/** Goal calls are primary; find the latest preceding goal reaction within fifteen seconds. */
export function reactionBeforeGoalCall(reactions,callTime){
 const t=Number(callTime);
 if(!Number.isFinite(t))return null;
 const eligible=(reactions||[]).filter(r=>Number.isFinite(Number(r.time))&&Number(r.time)<=t&&t-Number(r.time)<=15);
 return eligible.sort((a,b)=>Number(b.time)-Number(a.time))[0]||null;
}
export function createGoalDrafts(source,storage){
 const key=goalSourceKey(source);
 if(!key)return {items:[],transcript:null};
 const transcript=readGoalTranscript(source,storage);
 const prior=readJson(storage,GOAL_STORE_PREFIX+key);
 const items=(Array.isArray(prior?.items)?prior.items:[])
  .filter(x=>x&&typeof x.id==='string'&&validTime(x.timeSeconds))
  .map(x=>{
   // v38 had no goalTimeSeconds. v39 estimated speech-5s. Upgrade only
   // an UNVERIFIED automatic -5s proposal; never shift any hand-edited
   // or previously confirmed goal time.
   const oldTime=actualGoalTime(x);
   const isOldAutoFive=x.origin==='audio'&&x.goalTimeVerified!==true&&
    x.goalTimeEdited!==true&&x.status!=='confirmed'&&
    Math.abs(oldTime-estimateGoalTime(x.timeSeconds,5))<.051;
   return {...x,goalTimeSeconds:isOldAutoFive
     ?estimateGoalTime(x.timeSeconds):oldTime,
    goalTimeVerified:x.goalTimeVerified===true};
  });
 const events=transcript?.data?.utterances||[];
 // Remove previously cached commentary-only match labels, but never touch
 // an organizer-edited card or a genuine match_label supplied by Gemini.
 for(const item of items){
  if(!item.matchLabel||item.userEditedGoalFields?.includes('matchLabel'))continue;
  const start=(events||[]).filter(e=>e?.kind==='match_start'&&validTime(e.time_seconds)&&
   Number(e.time_seconds)<=Number(item.timeSeconds))
   .sort((a,b)=>Number(b.time_seconds)-Number(a.time_seconds))[0];
  if(start&&clip(item.matchLabel)===clip(start.quote)&&
     clip(start.match_label)!==clip(start.quote)&&
     !clip(start.match_label))item.matchLabel='';
 }
 const reactions=readGeminiGoalReactions(source,storage);
 for(const event of events){
  if(event?.kind!=='goal_call'||!validTime(event.time_seconds))continue;
  const time=Number(event.time_seconds),id=goalCandidateId(time,event.quote||'');
  // Re-analysis may shift timestamp; do not generate duplicate confirmed goals.
  // Two different spoken calls may describe the SAME goal reaction, even when
  // Gemini transcribes the scorer differently. Only collapse when both calls
  // point to one explicitly detected reaction; never merge on name alone.
  const linkedReaction=reactionBeforeGoalCall(reactions,time);
  const sameReaction=linkedReaction&&items.find(r=>{
   if(r.origin!=='audio'||r.status==='excluded'||r.goalTimeEdited===true||
      Math.abs(Number(r.timeSeconds)-time)>15)return false;
   // An organizer may verify a different playback time. In that case,
   // compare the original reaction clip rather than the edited timestamp.
   if(r.goalTimeVerified===true){
    const start=Number(r.clipStartSeconds),end=Number(r.clipEndSeconds);
    const rs=Number(linkedReaction.start),re=Number(linkedReaction.end);
    return [start,end,rs,re].every(Number.isFinite)&&end>start&&re>rs&&
     Math.max(0,Math.min(end,re)-Math.max(start,rs))/
      Math.min(end-start,re-rs)>=0.75;
   }
   return Math.abs(Number(r.goalTimeSeconds)-(linkedReaction.time-2))<=0.11;
  });
  const already=sameReaction||items.find(r=>r.id===id ||
   (r.origin==='manual'?
    time-actualGoalTime(r)>=-2 && time-actualGoalTime(r)<=15:
    r.origin==='gemini'?
     time-Number(r.timeSeconds)>=-2 && time-Number(r.timeSeconds)<=15:
     Math.abs(Number(r.timeSeconds)-time)<=6 &&
     (!clip(r.scorer)||!clip(event.scorer)||
      clip(r.scorer).toLowerCase()===clip(event.scorer).toLowerCase()||
      clip(r.rawScorer).toLowerCase()===clip(event.scorer).toLowerCase()||
      // An organizer corrected this scorer, or already confirmed the goal.
      // Keep that human decision rather than generating another AI goal.
      r.status==='confirmed'||
      (Array.isArray(r.userEditedGoalFields)&&
       r.userEditedGoalFields.includes('scorer')))));
  if(already){
   // Goal scenes may have been stored before Gemini learned the names.
   // Add only newly detected details, never overwrite confirmed/manual edits.
   prefillDetectedGoalFields(already,event,events);
   continue;
  }
  const match=matchContext(events,time);
  // Relate voice announcements to the earlier goal reaction, keeping the shot.
  const linked=reactionBeforeGoalCall(reactions,time);
  const fresh=transcript?.scope==='unified';
  const start=linked?.start??(fresh?Math.max(0,time-12):null);
  const end=linked?.end??(fresh?Math.min(Number(source.duration)||time+2,time+2):null);
  items.push({id,origin:'audio',timeSeconds:time,
   ...(start!==null?{clipStartSeconds:roundTime(start)}:{}),
   ...(end!==null?{clipEndSeconds:roundTime(end)}:{}),
   goalTimeSeconds:linked?roundTime(Math.max(0,linked.time-2)):estimateGoalTime(time),goalTimeVerified:false,goalTimeEdited:false,
   quote:clip(event.quote,240),
   scorer:clip(event.scorer),assist:clip(event.assist),
   rawScorer:clip(event.scorer),rawAssist:clip(event.assist),
   assistStatus:clip(event.assist)?'named':(/アシストなし|アシスト無し|no assist/i.test(String(event.quote||''))?'none':'unknown'),
   matchLabel:clip(event.match_label||match?.label),
   teamA:clip(event.team_a||match?.teamA),
   teamB:clip(event.team_b||match?.teamB),
   matchSeq:'',status:'draft',confirmedAt:null,note:''});
 }
 // Reconcile previously persisted duplicate AI drafts only when they clearly
 // share the same detected reaction. Never discard a human-reviewed decision.
 for(const reaction of reactions){
  const related=items.filter(x=>x.origin==='audio'&&
   x.goalTimeEdited!==true&&x.goalTimeVerified!==true&&
   Math.abs(Number(x.goalTimeSeconds)-(reaction.time-2))<=0.11&&
   Number(x.timeSeconds)>=reaction.time-2&&
   Number(x.timeSeconds)<=reaction.time+15);
  if(related.length<2)continue;
  const keep=related.find(x=>x.videoDecision==='kept'||x.status==='confirmed'||
   (x.userEditedGoalFields||[]).length>0)||related[0];
  for(const duplicate of related){
   if(duplicate===keep||duplicate.videoDecision||duplicate.status==='confirmed'||
      (duplicate.userEditedGoalFields||[]).length>0)continue;
   const index=items.indexOf(duplicate);
   if(index>=0)items.splice(index,1);
  }
 }
 // Keep existing commentary and manual goal decisions; never create duplicates.
 for(const event of reactions){
  const existing=items.find(item=>
   item.origin==='manual'
    ? Math.abs(actualGoalTime(item)-event.time)<=8
    : item.origin==='audio'
     ? Number(item.timeSeconds)-event.time>=-2 &&
       Number(item.timeSeconds)-event.time<=15
     : Math.abs(Number(item.timeSeconds)-event.time)<=8);
  if(existing)continue;
  items.push({
   id:'gemini-goal-'+Math.round(event.time*10),origin:'gemini',
   timeSeconds:event.time,goalTimeSeconds:roundTime(Math.max(0,event.time-3)),
   goalTimeVerified:false,goalTimeEdited:false,
   clipStartSeconds:event.start,clipEndSeconds:Math.max(event.start+.3,event.end),
   quote:event.quote,audioClue:event.clue,geminiConfidence:event.confidence,
   scorer:'',assist:'',assistStatus:'unknown',
   matchLabel:'',teamA:'',teamB:'',matchSeq:'',
   status:'draft',confirmedAt:null,note:''
  });
 }
 // A later Gemini pass may add only a match_start announcement, without
 // repeating any goal_call. Propagate the announced matchup to existing
 // unconfirmed goals while preserving all organizer-edited fields.
 for(const item of items){
  if(item.status!=='draft'||item.origin==='manual')continue;
  const context=matchContext(events,item.timeSeconds);
  if(!context)continue;
  const edited=new Set(item.userEditedGoalFields||[]);
  for(const [field,value] of [['matchLabel',context.label],['teamA',context.teamA],['teamB',context.teamB]]){
   if(value&&!edited.has(field)&&!clip(item[field]))item[field]=value;
  }
 }
 // Propagate video-level matchup (manual or Gemini) to every goal card.
 const saved=readJson(storage,'peakstamp_matchup_v1:'+key);
 const manual=saved?.origin==='manual'&&clip(saved.teamA)&&clip(saved.teamB)
  ?{teamA:clip(saved.teamA),teamB:clip(saved.teamB)}:null;
 const primary=readJson(storage,GEMINI_RESULT_CACHE_KEY)?.[key];
 const calls=(Array.isArray(primary?.utterances)?primary.utterances:[])
  .filter(x=>x?.kind==='match_start').map(x=>{
   const a=clip(x.team_a),b=clip(x.team_b);
   if(a&&b)return {teamA:a,teamB:b,time:Number(x.time_seconds)};
   const m=clip(x.match_label||x.quote).normalize('NFKC').match(/(?:チーム\\s*)?([1-9][0-9]?)\\s*(?:対|vs?\\.?|と)\\s*(?:チーム\\s*)?([1-9][0-9]?)/i);
   return m?{teamA:m[1],teamB:m[2],time:Number(x.time_seconds)}:null;
  }).filter(Boolean);
 const opening=calls.filter(x=>x.time>=0&&x.time<=30);
 const candidates=opening.length?opening:calls;
 const unique=[...new Set(candidates.map(x=>x.teamA+'|'+x.teamB))];
 const resolved=manual||(unique.length===1?candidates[0]:null);
 if(resolved)for(const item of items){
  // A confirmed goal still needs the video's manually corrected matchup.
  // Excluded goals remain untouched; individual field edits take precedence.
  if(item.status==='excluded')continue;
  const edited=new Set(item.userEditedGoalFields||[]);
  for(const [field,value] of [['teamA',resolved.teamA],['teamB',resolved.teamB],
   ['matchLabel',resolved.teamA+' vs '+resolved.teamB]]){
   if(!edited.has(field)&&(manual||!clip(item[field])))item[field]=String(value).trim().slice(0,60);
  }
 }
 // The organizer assigns a match number to the VIDEO, once.
 // Match-number edits are reflected across all auto-filled goal drafts.
 if(Number.isInteger(source?.matchNumber)&&source.matchNumber>=1)
  for(const item of items){
   // Legacy data can contain a manually selected matchSeq with no edit flag.
   // Preserve that value. Only update blank or already auto-filled fields.
   if(Array.isArray(item.userEditedGoalFields)&&
      item.userEditedGoalFields.includes('matchSeq'))continue;
   if(!String(item.matchSeq||'').trim()||item.sourceMatchSeqAutofill===true){
    item.matchSeq=String(source.matchNumber);
    item.sourceMatchSeqAutofill=true;
   }
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
  origin:'manual',timeSeconds:t,goalTimeSeconds:t,goalTimeVerified:false,goalTimeEdited:false,
  quote:'手動で追加',
  scorer:'',assist:'',assistStatus:'unknown',matchSeq:source?.matchNumber?String(source.matchNumber):'',
  sourceMatchSeqAutofill:Boolean(source?.matchNumber),
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
    reactionTimeSeconds:['audio','gemini'].includes(x.origin)?Number(x.timeSeconds):null,
    goalTimeVerified:x.goalTimeVerified===true,
    timingMethod:x.origin==='audio'?(x.goalTimeVerified===true?'video-reviewed':'comment-minus-10s'):x.origin==='gemini'?(x.goalTimeVerified===true?'video-reviewed':'audio-reaction-estimate'):'manual',
    quote:clip(x.quote,240),scorer:clip(x.scorer),
    ...(x.ssIdentity?{ssIdentity:x.ssIdentity,rawScorer:x.rawScorer??x.scorer,rawAssist:x.rawAssist??x.assist}:{}),
    assistStatus:x.assistStatus,
    assist:x.assistStatus==='named'?clip(x.assist):null,
    matchSeq:clip(String(x.matchSeq||''))?Number(x.matchSeq):null,
    matchLabel:clip(x.matchLabel),teamA:clip(x.teamA),teamB:clip(x.teamB),
    confirmedAt:x.confirmedAt||null,note:clip(x.note,400)});
  }
 }
 return {kind:'peakstamp-confirmed-goals',version:3,
  exportedAt:new Date().toISOString(),status:'local-confirmed-not-uploaded',
  needsMatchSeq:rows.filter(x=>x.matchSeq===null).length,
  goals:rows};
}

/**
 * Flag likely duplicate AI goals for human review; never delete or merge them.
 * Use same-source overlap plus nearby commentary, not scorer transcription.
 */
export function suspectedDuplicateGoalIds(items){
 const result=new Set(),rows=(items||[]).filter(x=>x&&x.status!=='excluded'&&x.origin!=='manual');
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j];
  if(Math.abs(Number(a.timeSeconds)-Number(b.timeSeconds))>8)continue;
  const as=Number(a.clipStartSeconds),ae=Number(a.clipEndSeconds);
  const bs=Number(b.clipStartSeconds),be=Number(b.clipEndSeconds);
  if(![as,ae,bs,be].every(Number.isFinite)||ae<=as||be<=bs)continue;
  const overlap=Math.max(0,Math.min(ae,be)-Math.max(as,bs));
  if(overlap/Math.min(ae-as,be-bs)<0.75)continue;
  // Prefer preserving the already-confirmed or kept goal.
  const protect=x=>x.status==='confirmed'||x.videoDecision==='kept'||x.goalTimeVerified===true;
  if(protect(a)&&!protect(b))result.add(b.id);
  else if(protect(b)&&!protect(a))result.add(a.id);
  else if(!protect(a)&&!protect(b))result.add(b.id);
 }
 return result;
}
