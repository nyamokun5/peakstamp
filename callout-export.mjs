/**
 * Portable export helpers for the isolated commentary experiment.
 * Do not use blob: navigation as the default on iOS: Safari may show a blob
 * URL instead of saving a .json file.
 */
export function calloutExportText(result,source,missed){
 if(!result||!Array.isArray(result.utterances)||!source?.file)
  throw Error('書き出す実況解析結果がありません。');
 const payload={
  ...result,
  missed:String(missed||'').slice(0,3000),
  source:{name:source.file.name,size:source.file.size,
   lastModified:source.file.lastModified}
 };
 return JSON.stringify(payload,null,2);
}
export function calloutExportFilename(date=new Date()){
 return 'PeakStamp_Callout_Test_'+date.toISOString().slice(0,10)+'.json';
}
/**
 * Must be invoked by a direct user click. The await occurs AFTER navigator.share
 * has been called to preserve transient user activation on iOS.
 */
export async function shareCalloutJson(text,filename,{nav=globalThis.navigator,FileType=globalThis.File}={}){
 if(typeof nav?.share!=='function'||typeof nav?.canShare!=='function'||
    typeof FileType!=='function')return 'unsupported';
 let file;
 try{file=new FileType([text],filename,{type:'application/json'});}
 catch(_){return 'unsupported';}
 try{if(!nav.canShare({files:[file]}))return 'unsupported';}
 catch(_){return 'unsupported';}
 try{
  await nav.share({files:[file],title:'PeakStamp 実況解析結果'});
  return 'completed';
 }catch(e){
  if(e?.name==='AbortError')return 'cancelled';
  throw e;
 }
}
export async function copyCalloutJson(text,{nav=globalThis.navigator,
 documentObj=globalThis.document,textarea=null}={}){
 if(typeof nav?.clipboard?.writeText==='function'){
  try{await nav.clipboard.writeText(text);return true;}catch(_){}
 }
 if(!textarea||typeof textarea.select!=='function')return false;
 try{
  textarea.value=text;
  textarea.focus();
  textarea.select();
  if(typeof textarea.setSelectionRange==='function')
   textarea.setSelectionRange(0,text.length);
  return typeof documentObj?.execCommand==='function'&&
   documentObj.execCommand('copy')===true;
 }catch(_){return false;}
}
