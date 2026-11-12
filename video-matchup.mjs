import {goalSourceKey,readGoalTranscript} from './goal-stats.mjs';
const prefix='peakstamp_matchup_v1:';
const clean=v=>String(v??'').trim().slice(0,60);
export function videoMatchup(source,storage){
 const key=goalSourceKey(source);if(!key)return {teamA:'',teamB:'',origin:'unknown'};
 let saved=null;
 try{saved=JSON.parse(storage?.getItem(prefix+key)||'null');}catch{}
 if(saved?.origin==='manual')return {teamA:clean(saved.teamA),teamB:clean(saved.teamB),origin:'manual'};
 const starts=(readGoalTranscript(source,storage)?.data?.utterances||[])
  .filter(x=>x?.kind==='match_start'&&clean(x.team_a)&&clean(x.team_b))
  .sort((a,b)=>Number(a.time_seconds)-Number(b.time_seconds));
 // Never infer a single video-level matchup when the video contains multiple fixtures.
 const pairs=[...new Set(starts.map(x=>clean(x.team_a)+'|'+clean(x.team_b)))];
 if(pairs.length!==1)return {teamA:'',teamB:'',origin:pairs.length?'ambiguous':'unknown'};
 return {teamA:clean(starts[0].team_a),teamB:clean(starts[0].team_b),origin:'audio'};
}
export function saveVideoMatchup(source,storage,teamA,teamB){
 const key=goalSourceKey(source);if(!key)return false;
 try{storage.setItem(prefix+key,JSON.stringify({origin:'manual',teamA:clean(teamA),teamB:clean(teamB)}));return true;}catch{return false;}
}
