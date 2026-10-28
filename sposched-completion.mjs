/** TEST-only verified completion time and explicit SS app event links.
 * Event UUIDs are authoritative for job timing; an app URL is never guessed
 * from that UUID because the external app uses its own encoded event slug.
 */
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const KNOWN_TEST_ACTIVITY_URL=
 'https://testsundayfront.web.app/app/shoot/activity/?event=%E6%97%A5%E6%9B%9C%E5%AE%9A%E6%9C%9F%252825+Oct%2529';
export const workerTimeKey=eventId=>'peakstamp:ss:test:worker-elapsed-v1:'+eventId;
export const resultLinkKey=(env,eventId)=>'peakstamp:ss:activity-url-v1:'+env+':'+eventId;
export const elapsedSeconds=(startedAt,finishedAt)=>{
 if(!Number.isFinite(startedAt)||!Number.isFinite(finishedAt)||
    startedAt<=0||finishedAt<startedAt)return null;
 return Number(((finishedAt-startedAt)/1000).toFixed(1));
};
/** Use the Worker completed timestamp when available so reconnecting later
 * does not inflate the elapsed time. The start remains a CLIENT button click.
 * A missing timestamp falls back to the browser observing completion.
 */
export function completionSeconds(startedAt,serverCompletedAt,observedAt=Date.now()){
 const done=Number.isFinite(serverCompletedAt)&&serverCompletedAt>=startedAt&&
  serverCompletedAt<=observedAt+30000?serverCompletedAt:observedAt;
 return elapsedSeconds(startedAt,done);
}
export function storeWorkerTiming(storage,eventId,requestId,startedAt){
 if(!UUID.test(eventId)||!UUID.test(requestId)||!Number.isFinite(startedAt)||startedAt<=0)
  throw Error('TEST登録の計測情報が不正です');
 storage.setItem(workerTimeKey(eventId),JSON.stringify({requestId,startedAt}));
}
export function readWorkerTiming(storage,eventId,requestId){
 if(!UUID.test(eventId)||!UUID.test(requestId))return null;
 try{
  const record=JSON.parse(storage.getItem(workerTimeKey(eventId))||'null');
  return record?.requestId===requestId&&Number.isFinite(record?.startedAt)&&record.startedAt>0
   ?record.startedAt:null;
 }catch{return null}
}
export function expectedSSAppLink(env,date){
 // Only the exact supplied October 25 event is verified; do not accidentally
 // link a different TEST match to Oct 25 as new events are created.
 return env==='staging'&&date==='2026-10-25'?KNOWN_TEST_ACTIVITY_URL:'';
}
export function validatedSSAppLink(value,env='staging'){
 const raw=typeof value==='string'?value.trim():'';
 if(!raw)throw Error('SSアプリのイベントURLを入力してください');
 let url;
 try{url=new URL(raw)}catch{throw Error('SSアプリのURL形式が不正です')}
 if(env!=='staging')throw Error('本番SSアプリのリンクはまだ設定されていません');
 if(url.protocol!=='https:'||url.host!=='testsundayfront.web.app'||
  url.username||url.password||url.pathname!=='/app/shoot/activity/'||
  !url.searchParams.has('event')||!url.searchParams.get('event')||
  url.hash)
  throw Error('TEST版SSの試合結果ページURLを指定してください');
 return url.href;
}
export function savedSSAppLink(storage,env,eventId,date){
 if(!UUID.test(eventId))return '';
 try{
  const stored=storage.getItem(resultLinkKey(env,eventId));
  if(stored)return validatedSSAppLink(stored,env);
 }catch{return ''}
 return expectedSSAppLink(env,date);
}
