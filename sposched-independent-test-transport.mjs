// Independent fixture batch transport for an explicitly enabled TEST Worker only.
// Never fall back to production; no caller in the production UI enables this.
import {verifyIndependentWorkerPreflight} from './sposched-independent-preflight.mjs';
export const INDEPENDENT_TEST_WORKER='https://shoot-sunday-sync-staging.yomax1979.workers.dev';
export async function startIndependentTestBatch({
 plan,official,bridgeToken,allowTestWrites=false,workerContract=null,fetchImpl=fetch
}){
 if(allowTestWrites!==true)throw Error('TESTへの書き込みが明示的に許可されていません');
 // Current independent batch implementation is a PRODUCTION-only Durable Object.
 // A staging hostname alone does not establish a TEST-safe batch route.
 if(workerContract!=='independent-test-batch-v1')
  throw Error('TEST Workerの独立試合登録契約が未確認です。送信を停止しました');
 if(typeof bridgeToken!=='string'||!bridgeToken.trim())throw Error('TEST Workerの認証が必要です');
 verifyIndependentWorkerPreflight(plan,official,{environment:'TEST'});
 const response=await fetchImpl(INDEPENDENT_TEST_WORKER+'/production/batch/start',{
  method:'POST',mode:'cors',cache:'no-store',
  headers:{'Content-Type':'application/json','X-SS-Bridge-Token':bridgeToken.trim()},
  body:JSON.stringify(plan)
 });
 let result;
 try{result=await response.json();}catch{throw Error('TEST Workerの応答がJSONではありません。再送せずジョブを確認してください');}
 if(!response.ok)throw Error(result?.error?.message||'TEST Worker HTTP '+response.status+'。再送せずジョブを確認してください');
 if(result?.environment!=='TEST'||result?.event_id!==plan.event_id||
    result?.request_id!==plan.request_id||
    result?.layout_mode!=='independent-fixtures-v1'||
    result?.fixture_count!==plan.fixture_count)
  throw Error('TEST Workerの応答が期待する独立試合ジョブと一致しません。再送しないでください');
 return result;
}
