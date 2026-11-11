import {normalizeTeam,fixturePlayerOptions} from './sposched-review-core.mjs';

// TEST-only local draft of a HUMAN choice. This stores no credentials, video,
// audio, SS goal record or score. The official SS snapshot is always reloaded.
const PREFIX='peakstamp_ss_goal_selection_v1:';
const text=value=>typeof value==='string'?value.trim():'';
const equalTeam=(a,b)=>Boolean(text(a)&&text(b)&&normalizeTeam(a)===normalizeTeam(b));
const sourceKey=row=>{
 const g=row?.goal,source=g?.source;
 if(!text(source?.name)||g?.id==null||!text(String(g.id))||
    !Number.isFinite(Number(source?.size))||
    !Number.isFinite(Number(source?.lastModified)))return null;
 return [source.name,Number(source.size),Number(source.lastModified),String(g.id)];
};
export function goalSelectionStorageKey(eventId,row){
 const source=sourceKey(row);
 return text(eventId)&&source?PREFIX+encodeURIComponent(JSON.stringify([eventId,...source])):null;
}
const official=s=>s?.rosterSource==='official-current-event-teams'&&
 s?.playerTeam instanceof Map&&Array.isArray(s?.matches);
const memberId=(snapshot,name)=>text(snapshot?.playerIds?.get(name));
function validPlayer(snapshot,match,name,team,oldId=''){
 if(!name)return true;
 if(!fixturePlayerOptions(snapshot,match.seq,team).includes(name))return false;
 if(oldId&&memberId(snapshot,name)!==oldId)return false;
 return true;
}
export function saveConfirmedGoalSelection(storage,snapshot,row){
 if(!official(snapshot)||row?.goal?.manual||row?.guest||!row?.quickEdited)return false;
 const key=goalSelectionStorageKey(snapshot.eventId,row);
 const match=snapshot.matches.find(m=>m.seq===Number(row.seq));
 if(!key||!match)return false;
 const rf=row.quickReviewedFields||{};
 if(!['match','scorer','assist','team'].some(field=>rf[field]===true))return false;
 const scorer=rf.scorer===true?text(row.scorer):'';
 const assistMode=rf.assist===true?row.assistMode:'unknown';
 const assist=rf.assist===true&&assistMode==='named'?text(row.assist):'';
 const team=text(row.team);
 // Semi-final derived slots can temporarily have no opposing teams.
 // Preserve the operator's candidate as a NOTE, not an approved choice.
 // On reload a WAITING match never restores any confirmed scorer/team.
 const eligible=name=>match.status==='waiting'
  ?Boolean(snapshot.playerTeam.has(name)&&
    (!team||equalTeam(snapshot.playerTeam.get(name),team)))
  :validPlayer(snapshot,match,name,team);
 if(scorer&&!eligible(scorer))return false;
 if(assist&&!eligible(assist))return false;
 if(team&&match.status!=='waiting'&&![match.leftTeam,match.rightTeam].some(t=>equalTeam(team,t)))return false;
 const data={version:1,seq:match.seq,matchId:text(match.matchId),
  leftTeam:text(match.leftTeam),rightTeam:text(match.rightTeam),
  goalTime:Number(row.goal.goalTimeSeconds??row.goal.timeSeconds),
  scorer,scorerId:scorer?memberId(snapshot,scorer):'',
  assistMode,assist,assistId:assist?memberId(snapshot,assist):'',
  team,include:row.include!==false,
  reviewed:Object.fromEntries(['match','scorer','assist','team'].map(x=>[x,rf[x]===true]))};
 try{storage.setItem(key,JSON.stringify(data));return true}catch{return false}
}
export function restoreConfirmedGoalSelections(storage,snapshot,rows){
 if(!official(snapshot)||!Array.isArray(rows))return rows;
 return rows.map(row=>{
  if(row?.goal?.manual||row?.guest||row?.quickEdited)return row;
  const key=goalSelectionStorageKey(snapshot.eventId,row);
  if(!key)return row;
  let old;
  try{old=JSON.parse(storage.getItem(key)||'null')}catch{return row}
  if(!old||old.version!==1||!Number.isInteger(old.seq)||old.seq<1)return row;
  const current=snapshot.matches.find(m=>m.seq===old.seq);
  if(!current)return row;
  const time=Number(row.goal.goalTimeSeconds??row.goal.timeSeconds);
  if(!Number.isFinite(old.goalTime)||!Number.isFinite(time)||Math.abs(time-old.goalTime)>2)return row;
  const scorer=text(old.scorer),assist=text(old.assist),team=text(old.team);
  const note={scorer,assist,assistMode:old.assistMode,team};
  const matchUnchanged=Boolean(old.matchId&&current.matchId&&
   old.matchId.toLowerCase()===String(current.matchId).toLowerCase()&&
   equalTeam(old.leftTeam,current.leftTeam)&&equalTeam(old.rightTeam,current.rightTeam)&&
   current.status!=='waiting');
  const namesValid=(!scorer||validPlayer(snapshot,current,scorer,team,text(old.scorerId)))&&
   (!assist||validPlayer(snapshot,current,assist,team,text(old.assistId)))&&
   (!team||[current.leftTeam,current.rightTeam].some(t=>equalTeam(t,team)))&&
   (!scorer||!assist||scorer!==assist);
  if(!matchUnchanged||!namesValid){
   // The previous names remain visible for re-entry, but NEVER become
   // approved selections after a bracket reset or SS roster/ID change.
   row.previousGoalSelection=note;
   return row;
  }
  const rf=old.reviewed||{};
  row.seq=old.seq;
  if(rf.scorer===true&&scorer)row.scorer=scorer;
  if(rf.assist===true&&['none','named'].includes(old.assistMode)){
   row.assistMode=old.assistMode;
   row.assist=old.assistMode==='named'?assist:'';
  }
  if((rf.team===true||rf.scorer===true)&&team)row.team=team;
  row.quickReviewedFields={...row.quickReviewedFields,
   match:rf.match===true,scorer:rf.scorer===true&&Boolean(scorer),
   assist:rf.assist===true&&(old.assistMode==='none'||Boolean(assist)),
   team:rf.team===true};
  row.quickEdited=true;
  row.include=old.include!==false;
  row.draftRestored=true;
  return row;
 });
}
