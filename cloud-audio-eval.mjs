/** Cloud audio experiment: parse AI reaction times without claiming true shot detection. */
const TYPES = new Set(['goal_reaction','shot_reaction','save_reaction','excited_reaction','other','uncertain']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const AUDIO_PROMPT_VERSION='audio-reaction-pilot-1';
export function makeAudioAnalysisPrompt(seconds){
 const duration=Math.max(1,Math.round(Number(seconds)||420));
 return [
 'You are hearing AUDIO ONLY recorded at an amateur Japanese/English soccer (football/futsal) match.',
 'Recording length: '+duration+' seconds. Analyze the WHOLE recording, not only loudest moments.',
 'Identify at most 20 DISTINCT audible reactions plausibly connected to a shot, goal, goalkeeper save or near miss.',
 'Listen for Japanese ナイシュー、ナイスシュート、ゴール、惜しい、ナイスキー、うまい and English reactions.',
 'Do NOT assume that loudness, a kick-like impact or a shout proves a shot occurred. You have NO VIDEO.',
 'Use onset of AUDIBLE REACTION as reaction_time_seconds from start of audio. This is not kick time.',
 'Only provide timestamps you can place from the audio. Never invent events, words or precise timecodes.',
 'Include plausible but uncertain reactions with type uncertain. Zero events is valid.',
 'Type must be: goal_reaction, shot_reaction, save_reaction, excited_reaction, other, uncertain.',
 'Confidence must be high, medium or low. Quote only clearly audible words; otherwise empty string.',
 'Suggested clip starts 8s before reaction and ends 5s after, within audio duration.',
 'Return ONLY VALID JSON (no markdown, no explanatory text) with schema:',
 JSON.stringify({duration_seconds:duration,events:[{reaction_time_seconds:123.4,type:'uncertain',confidence:'low',audible_clue:'describe what is audible',quote:'',suggested_clip_start_seconds:115.4,suggested_clip_end_seconds:128.4}],limitations:'Audio only; not proof of shots/goals.'}),
 'IMPORTANT: The example event at 123.4 seconds is fictional, only a schema example. Do NOT copy it unless actually detected.'
 ].join('\n');
}
export function parseAudioEvents(text,durationSeconds){
 if(typeof text!=='string')throw Error('GeminiのJSONを貼り付けてください。');
 const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 if(cleaned.length>120000)throw Error('JSON回答が長すぎます。');
 let data;
 try{data=JSON.parse(cleaned)}catch(e){
  const i=cleaned.indexOf('{'),j=cleaned.lastIndexOf('}');
  try{data=JSON.parse(cleaned.slice(i,j+1))}catch(_){throw Error('JSON形式で読み取れません。GeminiにJSONのみ再出力させてください。')}
 }
 if(!data||!Array.isArray(data.events))throw Error('JSONのevents配列がありません。');
 if(data.events.length>60)throw Error('イベントは最大60件です。');
 const duration=Number(durationSeconds);
 if(!(duration>0))throw Error('動画の長さが不正です。');
 const found=[];
 for(const v of data.events){
  const t=Number(v?.reaction_time_seconds);
  if(!Number.isFinite(t)||t<0||t>duration+2)continue;
  const start=Number(v?.suggested_clip_start_seconds),end=Number(v?.suggested_clip_end_seconds);
  const safeStart=Number.isFinite(start)?Math.min(clamp(start,0,duration),t):Math.max(0,t-8);
  const safeEnd=Number.isFinite(end)?Math.max(clamp(end,0,duration),Math.min(duration,t)):Math.min(duration,t+5);
  found.push({timeSeconds:+t.toFixed(1),type:TYPES.has(v.type)?v.type:'uncertain',
   confidence:['high','medium','low'].includes(v.confidence)?v.confidence:'low',
   audibleClue:String(v.audible_clue||'').slice(0,350),quote:String(v.quote||'').slice(0,100),
   clipStartSeconds:+safeStart.toFixed(1),clipEndSeconds:+safeEnd.toFixed(1)});
 }
 found.sort((a,b)=>a.timeSeconds-b.timeSeconds);
 const events=[];
 for(const v of found){
  const prev=events.at(-1);
  if(prev&&v.timeSeconds-prev.timeSeconds<1.5){if(v.confidence==='high'&&prev.confidence!=='high')events[events.length-1]=v}
  else events.push(v);
 }
 return {events:events.slice(0,40),returnedCount:data.events.length,discardedCount:data.events.length-events.length};
}
export function compareAudioCandidates(events,normalCandidates,broadCandidates,toleranceSeconds=7){
 const tol=clamp(Number(toleranceSeconds)||7,1,20);
 const ts=items=>(items||[]).map(x=>Number(x.peakSeconds)).filter(Number.isFinite);
 const normal=ts(normalCandidates),broad=ts(broadCandidates);
 const annotated=(events||[]).map(e=>({...e,
  nearNormal:normal.some(x=>Math.abs(x-e.timeSeconds)<=tol),
  nearBroad:broad.some(x=>Math.abs(x-e.timeSeconds)<=tol),
  additional:!broad.some(x=>Math.abs(x-e.timeSeconds)<=tol)
 }));
 return {total:annotated.length,nearNormal:annotated.filter(x=>x.nearNormal).length,
  nearBroad:annotated.filter(x=>x.nearBroad).length,outsideBroad:annotated.filter(x=>x.additional).length,
  toleranceSeconds:tol,events:annotated,
  caveat:'音声AI候補と従来音声候補の時刻だけを比較。実際のシュートの検出率・正解率ではありません。'};
}
