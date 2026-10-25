/** Display-only match labels. File fingerprint/Blob is never changed. */
export const MATCH_NUMBER_PREFIX='peakstamp_match_number_v1:';
export const validMatchNumber=value=>{
 const v=String(value??'').trim();
 return /^[0-9]{1,3}$/.test(v)&&Number(v)>=1&&Number(v)<=999;
};
export function matchStorageKey(source){
 const f=source?.file;
 return f&&typeof f.name==='string'&&Number.isFinite(f.size)&&Number.isFinite(f.lastModified)
  ?MATCH_NUMBER_PREFIX+[f.name,f.size,f.lastModified].join('::'):null;
}
export function assignMatchNumber(source,index=0,storage=null){
 if(!source?.file)return null;
 const key=matchStorageKey(source);
 let saved=null;
 try{saved=storage?.getItem(key)}catch{}
 const choice=validMatchNumber(saved)?Number(saved):index+1;
 source.matchNumber=choice;
 return choice;
}
export function setMatchNumber(source,value,storage=null){
 if(!source?.file||!validMatchNumber(value))return false;
 source.matchNumber=Number(value);
 try{const key=matchStorageKey(source);if(key)storage?.setItem(key,String(source.matchNumber))}catch{}
 return true;
}
export function sourceDisplayName(source,index=null){
 if(validMatchNumber(source?.matchNumber))return '第'+Number(source.matchNumber)+'試合';
 if(index!==null&&Number.isFinite(index)&&index>=0)return '動画'+(index+1);
 return '動画';
}

/**
 * Natural numeric filename ordering, never the browser's selected-file order.
 * IMG_9.MOV comes before IMG_10.MOV. Sorting references (not File objects)
 * leaves all source IDs, object URLs, Gemini caches and goal drafts intact.
 */
const filenameCollator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
const compareNames=(a,b)=>filenameCollator.compare(String(a||''),String(b||''));
export function sortFilesByFilename(files){
 return [...(files||[])].sort((a,b)=>compareNames(a?.name,b?.name));
}
export function sortSourcesByFilename(sources){
 sources.sort((a,b)=>compareNames(a?.file?.name,b?.file?.name));
 return sources;
}
/** Used only for an explicit user request to restore automatic 1,2,3... */
export function resetMatchNumbersToFilenameOrder(sources,storage=null){
 sortSourcesByFilename(sources);
 for(const [index,source] of sources.entries()){
  const key=matchStorageKey(source);
  try{if(key)storage?.removeItem?.(key)}catch{}
  source.matchNumber=index+1;
 }
 return sources;
}
