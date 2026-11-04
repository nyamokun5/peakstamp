// Independent fixture batch transport for an explicitly enabled TEST Worker only.
// Never fall back to production; no caller in the production UI enables this.
import {verifyIndependentWorkerPreflight} from './sposched-independent-preflight.mjs';
export const INDEPENDENT_TEST_WORKER='https://shoot-sunday-sync-staging.yomax1979.workers.dev';
export async function startIndependentTestBatch({
 plan,official,bridgeToken,allowTestWrites=false,fetchImpl=fetch
}){
 if(allowTestWrites!==true)throw Error('TESTへの書き込みが明示的に許可されていません');
 if(typeof bridgeToken!=='string'||!bridgeToken.trim())throw Error('TEST Workerの認証が必要です');
 verifyIndependentWorkerPreflight(plan,official,{environment:'TEST'});
 // Fetch a live capability assertion from the exact TEST host immediately before POST.
 // Caller-controlled flags or a staging hostname are not proof of TEST support.
 const capabilityResponse=await fetchImpl(INDEPENDENT_TEST_WORKER+'/batch/capabilities',{
  method:'GET',mode:'cors',cache:'no-store',redirect:'error'
 });
 let capability;
 try{capability=await capabilityResponse.json();}catch{
  throw Error('TEST Workerの機能確認に失敗しました。登録は送信していません');
 }
 if(!capabilityResponse.ok||capability?.environment!=='TEST'||
    capability?.independent_fixture_contract!=='independent-fixtures-v1'||
    capability?.independent_test_batch_writes!==true||
    capability?.independent_test_batch_contract!=='independent-test-batch-v1'||
    capability?.batch_start_path!=='/staging/batch/start')
  throw Error('TEST Workerは独立試合の書き込みに対応していません。登録は送信していません');

 const response=await fetchImpl(INDEPENDENT_TEST_WORKER+'/staging/batch/start',{
  method:'POST',mode:'cors',cache:'no-store',
  headers:{'Content-Type':'application/json','X-SS-Bridge-Token':bridgeToken.trim()},
  redirect:'error',body:JSON.stringify({...plan,confirm:'TEST-ONLY BATCH WRITE'})
 });
 let result;
 try{result=await response.json();}catch{throw Error('TEST Workerの応答がJSONではありません。再送せずジョブを確認してください');}
 if(!response.ok)throw Error(result?.error?.message||'TEST Worker HTTP '+response.status+'。再送せずジョブを確認してください');
 if(result?.environment!=='STAGING ONLY'||result?.event_id!==plan.event_id||
    result?.request_id!==plan.request_id||
    result?.layout_mode!=='independent-fixtures-v1'||
    result?.fixture_count!==plan.fixture_count)
  throw Error('TEST Workerの応答が期待する独立試合ジョブと一致しません。再送しないでください');
 return result;
}
