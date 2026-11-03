// Worker-independent batch payload adapter. Pure: never sends a request.
import {previewIndependentFixtures} from './sposched-independent-preview.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function prepareIndependentWorkerBatch({snapshot,rows,decisions,requestId}){
 if(!UUID.test(requestId||''))throw Error('正式な一括登録リクエストIDが必要です');
 const plan=previewIndependentFixtures({snapshot,rows,decisions});
 if(plan.operations.length>64)throw Error('Workerの最大64操作を超えています');
 return {...plan,request_id:requestId.toLowerCase(),
  confirm:'PRODUCTION EVENT BATCH WRITE'};
}
