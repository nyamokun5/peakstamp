/** User-initiated, narrowly scoped cleanup of per-file local goal review data.
 * Never touch Gemini transcript caches, video files, general app settings or
 * unrelated files. In particular, do not call localStorage.clear().
 */
import {GOAL_STORE_PREFIX} from './goal-stats.mjs?v=40';

export function savedGoalSessions(storage){
 const sessions=[];
 if(!storage)return sessions;
 for(let i=0;i<(storage.length||0);i++){
  const key=storage.key(i);
  if(typeof key!=='string'||!key.startsWith(GOAL_STORE_PREFIX))continue;
  let data=null;
  try{data=JSON.parse(storage.getItem(key)||'null')}catch{}
  const source=data?.source||{};
  const suffix=key.slice(GOAL_STORE_PREFIX.length);
  const values=suffix.split('::');
  const name=String(source.name||values[0]||'(名前なし)');
  const lastModified=Number(source.lastModified)||Number(values.at(-1))||0;
  const items=Array.isArray(data?.items)?data.items:[];
  const summary={
   key,name,
   lastModified,
   total:items.length,
   kept:items.filter(item=>item?.videoDecision==='kept').length,
   rejected:items.filter(item=>item?.videoDecision==='rejected').length,
   edited:items.filter(item=>item&&(item.clipStartSeconds!==undefined||
     item.clipEndSeconds!==undefined||item.clipZoom!==undefined||
     item.goalTimeEdited===true)).length,
   confirmed:items.filter(item=>item?.status==='confirmed').length
  };
  sessions.push(summary);
 }
 // This is the SOURCE FILE modification date, not an unverifiable "last
 // edited" date. Display it explicitly to avoid deleting the wrong session.
 return sessions.sort((a,b)=>b.lastModified-a.lastModified||
  a.name.localeCompare(b.name));
}

export function deleteGoalSessions(storage,selectedKeys){
 if(!storage||!Array.isArray(selectedKeys))throw new TypeError('Invalid storage or selection');
 const allowed=new Set(savedGoalSessions(storage).map(session=>session.key));
 const keys=[...new Set(selectedKeys)];
 if(!keys.length)throw new Error('Select one or more videos first');
 if(keys.some(key=>!allowed.has(key)||!key.startsWith(GOAL_STORE_PREFIX)))
  throw new Error('One or more selected goal sessions no longer exist');
 for(const key of keys)storage.removeItem(key);
 return keys.length;
}
