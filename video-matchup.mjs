import {goalSourceKey,readGoalTranscript} from './goal-stats.mjs';
const prefix='peakstamp_matchup_v1:';
const clean=v=>String(v??'').trim().slice(0,60);
export function matchupFromUtterance(row){
 const explicitA=clean(row?.team_a),explicitB=clean(row?.team_b);
 if(explicitA&&explicitB)return {teamA:explicitA,teamB:explicitB};
 const phrase=clean(row?.match_label||row?.quote).normalize('NFKC');
 // Only parse an explicit pair in a match_start record, never an arbitrary score.
 const match=phrase.match(/(?:チーム\s*)?([1-9][0-9]?)\s*(?:対|vs?\.?|と)\s*(?:チーム\s*)?([1-9][0-9]?)/i);
 return match?{teamA:match[1],teamB:match[2]}:null;
}
export function videoMatchup(source,storage){
 const key=goalSourceKey(source);if(!key)return {teamA:'',teamB:'',origin:'unknown'};
 let saved=null;
 try{saved=JSON.parse(storage?.getItem(prefix+key)||'null');}catch{}
 if(saved?.origin==='manual'&&clean(saved.teamA)&&clean(saved.teamB))return {teamA:clean(saved.teamA),teamB:clean(saved.teamB),origin:'manual'};
 // Prefer current Gemini utterances; legacy pilot transcripts can contain unrelated match calls.
 let primary=[];
 try{const all=JSON.parse(storage?.getItem('peakstamp_gemini_primary_json_v1')||'{}');primary=all[key]?.utterances||[];}catch{}
 const rows=Array.isArray(primary)&&primary.some(x=>x?.kind==='match_start'&&matchupFromUtterance(x))
  ?primary:(readGoalTranscript(source,storage)?.data?.utterances||[]);
 const starts=rows
  .filter(x=>x?.kind==='match_start'&&matchupFromUtterance(x))
  .sort((a,b)=>Number(a.time_seconds)-Number(b.time_seconds));
 // A match announcement in the opening 30 seconds identifies this recording.
 // Ignore later unrelated stadium PA calls (e.g. other pitches), but remain
 // conservative when two different matchups are announced in the opening.
 const opening=starts.filter(x=>Number(x.time_seconds)>=0&&Number(x.time_seconds)<=30);
 const selected=opening.length?opening:starts;
 const pairs=[...new Set(selected.map(x=>{const m=matchupFromUtterance(x);return m.teamA+'|'+m.teamB;}))];
 if(pairs.length!==1)return {teamA:'',teamB:'',origin:pairs.length?'ambiguous':'unknown'};
 return {...matchupFromUtterance(selected[0]),origin:'audio'};
}
export function saveVideoMatchup(source,storage,teamA,teamB){
 const key=goalSourceKey(source);if(!key)return false;
 try{storage.setItem(prefix+key,JSON.stringify({origin:'manual',teamA:clean(teamA),teamB:clean(teamB)}));return true;}catch{return false;}
}
