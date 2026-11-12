import {goalSourceKey,readGoalTranscript} from './goal-stats.mjs';
const prefix='peakstamp_matchup_v1:';
const clean=v=>String(v??'').trim().slice(0,60);
export function matchupFromUtterance(row){
 const explicitA=clean(row?.team_a),explicitB=clean(row?.team_b);
 if(explicitA&&explicitB)return {teamA:explicitA,teamB:explicitB};
 const phrase=clean(row?.match_label||row?.quote).normalize('NFKC');
 // Only parse an explicit pair in a match_start record, never an arbitrary score.
 const match=phrase.match(/(?:チーム\\s*)?([1-9][0-9]?)\\s*(?:対|vs?\\.?|と)\\s*(?:チーム\\s*)?([1-9][0-9]?)/i);
 return match?{teamA:match[1],teamB:match[2]}:null;
}
export function videoMatchup(source,storage){
 const key=goalSourceKey(source);if(!key)return {teamA:'',teamB:'',origin:'unknown'};
 let saved=null;
 try{saved=JSON.parse(storage?.getItem(prefix+key)||'null');}catch{}
 if(saved?.origin==='manual')return {teamA:clean(saved.teamA),teamB:clean(saved.teamB),origin:'manual'};
 const starts=(readGoalTranscript(source,storage)?.data?.utterances||[])
  .filter(x=>x?.kind==='match_start'&&matchupFromUtterance(x))
  .sort((a,b)=>Number(a.time_seconds)-Number(b.time_seconds));
 // Never infer a single video-level matchup when the video contains multiple fixtures.
 const pairs=[...new Set(starts.map(x=>{const m=matchupFromUtterance(x);return m.teamA+'|'+m.teamB;}))];
 if(pairs.length!==1)return {teamA:'',teamB:'',origin:pairs.length?'ambiguous':'unknown'};
 return {...matchupFromUtterance(starts[0]),origin:'audio'};
}
export function saveVideoMatchup(source,storage,teamA,teamB){
 const key=goalSourceKey(source);if(!key)return false;
 try{storage.setItem(prefix+key,JSON.stringify({origin:'manual',teamA:clean(teamA),teamB:clean(teamB)}));return true;}catch{return false;}
}
