/** Standalone SpoSched goal drafts for match reports without a PeakStamp
 * video or Gemini detection. Only goal metadata is stored, never tokens.
 * The test bridge still performs human review, official UUID matching,
 * signed preview and final confirmation before any write.
 */
export const MANUAL_KEY_PREFIX='peakstamp_ss_manual_goals_v1:';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function manualStoreKey(environment,eventId){
 if(!['staging','production'].includes(environment)||!UUID.test(String(eventId||'')))
  throw Error('SSイベントと接続先を確認してください');
 return MANUAL_KEY_PREFIX+environment+':'+eventId;
}
export function makeManualGoal(id){
 if(!UUID.test(String(id||'')))throw Error('手動ゴールIDが不正です');
 return {id,source:{name:'SS手動入力'},quote:'映像なし・手動登録',
  scorer:'',assist:'',assistStatus:'unknown',matchSeq:null,goalTimeSeconds:null,
  manual:true,sent:false};
}
const validGoal=g=>Boolean(g&&UUID.test(String(g.id||''))&&g.manual===true&&
 g.source?.name==='SS手動入力'&&(g.sent===true||g.sent===false));
export function restoreManualGoals(storage,environment,eventId){
 let entries=[];
 try{
  const value=JSON.parse(storage?.getItem(manualStoreKey(environment,eventId))||'[]');
  if(Array.isArray(value))entries=value.filter(validGoal).slice(0,100);
 }catch{}
 const ids=new Set();
 return entries.filter(x=>!ids.has(x.id)&&ids.add(x.id))
  .map(g=>({...makeManualGoal(g.id),sent:g.sent===true}));
}
export function storeManualGoals(storage,environment,eventId,goals){
 if(!Array.isArray(goals)||goals.length>100||goals.some(g=>!validGoal(g)))
  throw Error('手動ゴールデータを保存できません');
 storage.setItem(manualStoreKey(environment,eventId),JSON.stringify(goals.map(
  g=>({id:g.id,source:{name:'SS手動入力'},manual:true,sent:g.sent===true})
 )));
}
export function markManualCompleted(goals,keys){
 const done=new Set(keys);
 return goals.map(g=>done.has('SS手動入力::'+g.id)?{...g,sent:true}:g);
}
export function unsentManualGoals(goals){return goals.filter(g=>g.sent!==true)}
