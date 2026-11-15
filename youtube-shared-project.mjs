import {saveHighlightHistory,restoreHighlightHistory} from './highlight-history.mjs?v=history1';
import {confirmedCard} from './match-review.mjs';
import {videoMatchup} from './video-matchup.mjs';
import {GOAL_STORE_PREFIX,goalSourceKey,createGoalDrafts,saveGoalDrafts} from './goal-stats.mjs';
import {geminiEventsToCandidates} from './gemini-candidates.mjs';
import {getCandidateEnd} from './editing-rules.mjs';
import {matchName} from './youtube-session.mjs';
export function hydrateYouTubeSource(saved,index,storage){
 const s={...saved,youtubeId:saved.id,file:{name:'YouTube-'+saved.id,size:0,lastModified:0},objectUrl:'https://www.youtube.com/watch?v='+saved.id,matchNumber:Number(saved.matchNumber)||index+1,candidates:(saved.candidates||[]).map(c=>c.goalHint&&!c.geminiType?{...c,geminiType:'goal_reaction',geminiConfidence:'low'}:c),...(saved.analyzed?{analysisEngine:'gemini'}:{})};
 // Migrate once before inferred reaction drafts are generated. Shared edits win.
 let savedGoals=[];try{savedGoals=JSON.parse(storage.getItem(GOAL_STORE_PREFIX+goalSourceKey(s))||'null')?.items||[]}catch{}
 if(!savedGoals.length){const goals=s.candidates.flatMap(c=>c.goal?[{...c.goal,...(!c.goal.videoDecision&&c.enabled===true?{videoDecision:'kept'}:!c.goal.videoDecision&&c.rejected===true?{videoDecision:'rejected'}:{})}]:[]);if(goals.length&&!saveGoalDrafts(s,storage,goals))throw Error('ゴール情報を保存できませんでした。')}
 const goals=createGoalDrafts(s,storage).items;
 for(const c of s.candidates)if(c.goal&&goals.some(g=>g.id===c.goal.id)){c.goalRecordId=c.goal.id;delete c.goal}
 return s;
}
export function storeYouTubeAnalysis(source,parsed,storage){
 const duration=Number(parsed?.duration_seconds);
 if(!(duration>0)||!Array.isArray(parsed.events)||!Array.isArray(parsed.utterances))throw Error('解析結果を確認できませんでした。');
 const key='peakstamp_gemini_primary_json_v1';
 const cache=JSON.parse(storage.getItem(key)||'{}');cache[goalSourceKey(source)]=parsed;
 storage.setItem(key,JSON.stringify(cache));
 saveHighlightHistory(source,storage);
 const conversion=geminiEventsToCandidates(parsed.events.map(e=>({...e,timeSeconds:e.reaction_time_seconds,clipStartSeconds:e.suggested_clip_start_seconds,clipEndSeconds:e.suggested_clip_end_seconds,audibleClue:e.audible_clue})),source.id,duration,source.candidates);
 const preserved=(source.candidates||[]).filter(c=>(c.enabled||c.rejected)&&!conversion.items.some(x=>Math.abs(x.peakSeconds-c.peakSeconds)<=4));
 Object.assign(source,{duration,candidates:[...conversion.items,...preserved].sort((a,b)=>a.peakSeconds-b.peakSeconds),analyzed:true,analysisEngine:'gemini',error:''});
 source.candidates=restoreHighlightHistory(source,source.candidates,storage);
 const match=parsed.utterances.find(u=>u.kind==='match_start');
 for(const [k,field] of [['teamA','team_a'],['teamB','team_b']])if(!source.info[k]&&match?.[field])source.info[k]=match[field];
 return source;
}
export function confirmedYouTubePair(source,storage){
 const card=confirmedCard(source,storage);if(card)return {teamA:card.a,teamB:card.b};
 const saved=videoMatchup(source,storage);return saved.origin==='manual'&&saved.teamA&&saved.teamB?{teamA:saved.teamA,teamB:saved.teamB}:null;
}
export function youtubeDisplayName(source,storage){return matchName({...source,info:{...source.info,...confirmedYouTubePair(source,storage)}})}
export function selectedYouTubeClips(sources,storage){
 return sources.filter(s=>!s.info?.drone).flatMap(s=>{
 const goals=createGoalDrafts(s,storage).items;
 return (s.candidates||[]).filter(c=>c.enabled===true&&!c.rejected).sort((a,b)=>a.time-b.time).map(c=>{
 const goal=goals.find(g=>g.id===(c.goalRecordId||c.goal?.id)&&g.status==='confirmed');
 return {video:s.id,match:youtubeDisplayName(s,storage),start:c.time,end:getCandidateEnd(s,c,{}),label:goal?'⚽ ゴール':c.title,scorer:goal?.scorer||'',assist:goal?.assistStatus==='named'?goal.assist:''};
 });});
}
