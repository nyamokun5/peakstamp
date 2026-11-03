// Pure guard: independent fixture plans must exactly match a fresh official inspect.
// This never authorizes or sends a write.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function verifyIndependentWorkerPreflight(plan,official,{environment='PRODUCTION'}={}){
 if(!['PRODUCTION','TEST'].includes(environment))throw Error('不正な環境指定です');
 if(plan?.layout_mode!=='independent-fixtures-v1'||!UUID.test(plan.event_id||'')||
    official?.environment!==environment||
    String(official.event_id||'').toLowerCase()!==plan.event_id.toLowerCase()||
    !Number.isInteger(plan.fixture_count)||plan.fixture_count<1||plan.fixture_count>24||
    !Array.isArray(official.matches)||!Array.isArray(plan.operations))
  throw Error('独立試合の正式な登録先を確認できません');
 const fixtures=official.matches.filter(m=>Number.isInteger(m.seq)&&m.seq>0);
 if(fixtures.length!==official.matches.length||fixtures.length!==plan.fixture_count)
  throw Error('公式試合件数が登録計画と一致しません');
 const ids=new Map();
 for(const fixture of fixtures){
  const id=String(fixture.match_id||'').toLowerCase();
  if(!UUID.test(id)||fixture.status!=='scheduled'||fixture.seq>plan.fixture_count||
     ids.has(fixture.seq)||[...ids.values()].includes(id))
   throw Error('公式試合ID・番号・未開始状態が不正です');
  ids.set(fixture.seq,id);
 }
 for(let seq=1;seq<=plan.fixture_count;seq++)
  if(!ids.has(seq))throw Error('公式試合番号が連続していません');
 const finished=new Set();
 for(const op of plan.operations){
  if(!['create','finish'].includes(op.action)||
     !ids.has(op.seq)||String(op.expected_match_id||'').toLowerCase()!==ids.get(op.seq)||
     finished.has(op.seq))
   throw Error('Worker登録操作と公式試合IDが一致しません');
  if(op.action==='finish')finished.add(op.seq);
 }
 if(finished.size!==plan.fixture_count)throw Error('全公式試合の終了操作が必要です');
 return true;
}
