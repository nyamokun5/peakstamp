/**
 * Current PeakStamp session/project membership for SS bulk goal registration.
 * Only file fingerprints and display order are stored; MOV/MP4 blobs, API
 * keys, player data, and transcripts NEVER enter the project manifest.
 *
 * The source file's lastModified is a file-system timestamp, not a verified
 * football-event date. Project membership is based on explicit import session.
 */
export const CURRENT_GOAL_PROJECT_KEY='peakstamp_current_video_project_v1';
const MAX_SOURCES=12;
const validFile=file=>file&&typeof file.name==='string'&&file.name.length>0&&
 Number.isFinite(file.size)&&file.size>=0&&
 Number.isFinite(file.lastModified)&&file.lastModified>=0;
export function projectFileInfo(source){
 const f=source?.file||source;
 if(!validFile(f))return null;
 return {name:f.name,size:f.size,lastModified:f.lastModified};
}
export function projectFileKey(source){
 const f=projectFileInfo(source);
 return f?[f.name,f.size,f.lastModified].join('::'):null;
}
export function projectFiles(sources){
 const result=[],seen=new Set();
 for(const source of Array.isArray(sources)?sources:[]){
  const f=projectFileInfo(source),key=projectFileKey(f);
  if(!f||seen.has(key))continue;
  result.push(f);seen.add(key);
  if(result.length>=MAX_SOURCES)break;
 }
 return result;
}
export function readCurrentGoalProject(storage){
 try{
  const raw=JSON.parse(storage?.getItem(CURRENT_GOAL_PROJECT_KEY)||'null');
  if(raw?.version!==1||typeof raw.projectId!=='string'||!Array.isArray(raw.files))return null;
  const files=projectFiles(raw.files);
  return {version:1,projectId:raw.projectId,updatedAt:Number(raw.updatedAt)||0,files};
 }catch{return null}
}
export function saveCurrentGoalProject(storage,sources,{newProject=false,now=Date.now()}={}){
 const files=projectFiles(sources);
 const existing=newProject?null:readCurrentGoalProject(storage);
 const project={version:1,
  projectId:existing?.projectId||'session-'+String(now),
  updatedAt:now,
  files
 };
 storage.setItem(CURRENT_GOAL_PROJECT_KEY,JSON.stringify(project));
 return project;
}
export function matchSavedGoalsToProject(saved,project){
 const keys=(project?.files||[]).map(projectFileKey).filter(Boolean);
 const byFile=new Map();
 for(const item of Array.isArray(saved)?saved:[]){
  const key=projectFileKey(item.source);
  if(key&&!byFile.has(key))byFile.set(key,item);
 }
 const selected=keys.map(k=>byFile.get(k)).filter(Boolean);
 return {selected,projectFileCount:keys.length,
  matchingSourceCount:selected.length,
  confirmedGoals:selected.reduce((n,item)=>n+(Number(item.count)||0),0)};
}
const calendarDay=timestamp=>{
 if(!Number.isFinite(timestamp)||timestamp<=0)return null;
 const d=new Date(timestamp);
 if(Number.isNaN(d.getTime()))return null;
 return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),
  String(d.getDate()).padStart(2,'0')].join('-');
};
/** Legacy data have no trusted session ID. Group by FILE modification date
 * for user convenience, but label it as an unverified approximation; do not
 * silently join all historic localStorage goals across separate weeks.
 */
export function approximateLegacyDayGroups(saved){
 const groups=new Map();
 for(const item of Array.isArray(saved)?saved:[]){
  const day=calendarDay(item?.source?.lastModified)||'日付不明';
  if(!groups.has(day))groups.set(day,[]);
  groups.get(day).push(item);
 }
 return [...groups].map(([day,items])=>({
  day,items:items.sort((a,b)=>
   Number(a.source?.lastModified||0)-Number(b.source?.lastModified||0)||
   String(a.source?.name||'').localeCompare(String(b.source?.name||''))),
  confirmedGoals:items.reduce((n,v)=>n+(Number(v.count)||0),0)
 })).sort((a,b)=>b.day.localeCompare(a.day,'ja'));
}
export function defaultGoalCollection(saved,project){
 if(project){
  const result=matchSavedGoalsToProject(saved,project);
  return {...result,mode:'project',items:result.selected,approximate:false};
 }
 const groups=approximateLegacyDayGroups(saved);
 return {mode:'legacy',items:groups[0]?.items||[],groups,
  approximate:true,projectFileCount:0,
  matchingSourceCount:groups[0]?.items.length||0,
  confirmedGoals:groups[0]?.confirmedGoals||0};
}
