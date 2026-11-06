// Explicit, validation-only adapter for the isolated independent TEST Worker.
// The endpoint must be supplied from a verified deployment; no URL is assumed.
import {verifyIndependentWorkerPreflight} from './sposched-independent-preflight.mjs';
export async function validateIndependentTestBatch({
 plan,official,bridgeToken,validationWorkerUrl,fetchImpl=fetch
}){
 if(typeof validationWorkerUrl!=='string'||!validationWorkerUrl.trim())
  throw Error('検証用TEST WorkerのデプロイURLが必要です');
 let endpoint;
 try{endpoint=new URL(validationWorkerUrl);}catch{throw Error('検証用Worker URLが不正です');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
    endpoint.pathname!=='/'||endpoint.search||endpoint.hash||
    !/^shoot-sunday-independent-validation-test\.[a-z0-9-]+\.workers\.dev$/i.test(endpoint.hostname))
  throw Error('独立試合の検証専用Worker以外には送信できません');
 if(typeof bridgeToken!=='string'||!bridgeToken.trim())
  throw Error('検証用TEST Workerの認証が必要です');
 verifyIndependentWorkerPreflight(plan,official,{environment:'TEST'});
 const base=endpoint.origin;
 const capabilityResponse=await fetchImpl(base+'/batch/capabilities',{
  method:'GET',mode:'cors',cache:'no-store',redirect:'error'
 });
 let capability;
 try{capability=await capabilityResponse.json();}catch{
  throw Error('検証用Workerの機能確認に失敗しました');
 }
 if(!capabilityResponse.ok||capability?.environment!=='TEST'||
    capability?.independent_fixture_contract!=='independent-fixtures-v1'||
    capability?.independent_test_validation!==true||
    capability?.independent_test_batch_writes!==false)
  throw Error('検証専用TEST Workerの機能を確認できません');
 const response=await fetchImpl(base+'/batch/validate',{
  method:'POST',mode:'cors',cache:'no-store',redirect:'error',
  headers:{'Content-Type':'application/json','X-SS-Bridge-Token':bridgeToken.trim()},
  body:JSON.stringify(plan)
 });
 let result;
 try{result=await response.json();}catch{throw Error('検証用Workerの応答がJSONではありません');}
 if(!response.ok||result?.valid!==true||result?.validation_only!==true||
    result?.environment!=='TEST'||result?.event_id!==plan.event_id||
    result?.request_id!==plan.request_id||
    result?.layout_mode!==plan.layout_mode||
    result?.fixture_count!==plan.fixture_count||
    result?.operation_count!==plan.operations.length)
  throw Error('TEST Workerでの独立試合データ検証に失敗しました');
 return result;
}
