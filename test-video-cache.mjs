/** Temporary TEST-only local video cache. No uploads or server calls. */
const DB='peakstamp-test-video-cache-v1';
const STORE='files';
function database(){
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB)return reject(Error('このブラウザでは端末保存を利用できません'));
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'key'});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('動画保存領域を開けません'));
 });
}
async function transaction(mode,work){
 const db=await database();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
  let value;
  tx.oncomplete=()=>resolve(value);
  tx.onerror=()=>reject(tx.error||Error('動画の端末保存に失敗しました'));
  tx.onabort=()=>reject(tx.error||Error('保存容量が不足しています'));
  try{work(store,result=>{value=result;});}catch(e){tx.abort();reject(e);}
 });}finally{db.close();}
}
export async function saveTestVideos(files){
 const list=Array.from(files||[]);
 if(!list.length)throw Error('保存する動画がありません');
 // Keep prior cache intact if new writes fail; replace only after success.
 const records=list.map((file,index)=>({
  key:'video:'+index,file,name:file.name,lastModified:file.lastModified
 }));
 await transaction('readwrite',(store)=>{
  store.clear();
  for(const record of records)store.put(record);
 });
 return records.length;
}
export async function restoreTestVideos(){
 const records=await transaction('readonly',(store,done)=>{
  const request=store.getAll();
  request.onsuccess=()=>done(request.result);
 });
 return (records||[]).filter(r=>r.key.startsWith('video:')&&r.file instanceof Blob)
  .sort((a,b)=>Number(a.key.slice(6))-Number(b.key.slice(6)))
  .map(r=>new File([r.file],r.name,{type:r.file.type,lastModified:r.lastModified}));
}
export async function clearTestVideos(){
 await transaction('readwrite',store=>store.clear());
}
