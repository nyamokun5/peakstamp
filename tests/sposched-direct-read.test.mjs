import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This page is a module script embedded in HTML, so Node cannot import it.
// Compile its script separately to catch syntax errors without loading the DOM.
const html = readFileSync(new URL('../sposched-review.html', import.meta.url),'utf8');

test('SpoSched direct import defaults to production read-only with an explicit staging switch',()=>{
  assert.match(html,/id="ssBridgeToken"/);
  assert.match(html,/id="ssLoadEvents"/);
  assert.match(html,/id="ssEventSelect"/);
  assert.match(html,/id="ssLoadSnapshot"/);
  assert.match(html,/\/events\?limit=100/);
  assert.match(html,/\/snapshot\?event_id=/);
  assert.match(html,/method:'GET'/);
  assert.doesNotMatch(html,/fetch\(SS_GATEWAY\s*\+\s*path\s*,\s*\{[^}]*method:'POST'/);
  assert.doesNotMatch(html,/localStorage\.setItem\([^)]*ssBridgeToken/);
});

test('existing goal review remains available and old JSON import is retained',()=>{
  assert.match(html,/id="loadSnapshot"/);
  assert.match(html,/id="snapshotText"/);
  assert.match(html,/snapshot=normalizeSpoSnapshot\(data\)/);
  assert.match(html,/buildReviewPayload\(snapshot,rows,scores\)/);
});

test('embedded module JavaScript parses without runtime DOM initialization',()=>{
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(module,'Embedded module script should exist');
  const body = module[1].split('\n').filter(line=>!line.startsWith('import ')).join('\n');
  assert.doesNotThrow(()=>new Function(body));
});

test('verified already-registered goals show no update rather than an error',()=>{
  assert.match(html,/matchingAndSkipped/);
  assert.match(html,/rows\.every\(row=>!row\.include&&matchingExistingGoals\(row,snapshot\)\.length>0\)/);
  assert.match(html,/noScoreChanges/);
  assert.match(html,/追加・更新する操作はありません/);
});

test('existing-goal correction requires selecting a real goal ID and explicit confirmation',()=>{
 assert.match(html,/id="ssLoadSnapshot"/);
 assert.match(html,/修正対象の既存ゴールを選択/);
 assert.match(html,/row\.updateGoalId=selected\.id/);
 assert.match(html,/row\.confirmed=false;confirm\.checked=false/);
 assert.match(html,/この登録済みゴールを修正対象に指定/);
 assert.match(html,/未送信/);
 assert.match(html,/id="ssEnvironment"/);
 assert.match(html,/id="stagingPreview"/);
 assert.match(html,/id="stagingApprove"/);
 assert.match(html,/id="stagingExecute"/);
 assert.match(html,/confirm:'TEST-ONLY WRITE'/);
 assert.match(html,/SS_GATEWAYS/);
 assert.match(html,/staging:'https:\/\/shoot-sunday-sync-staging\.yomax1979\.workers\.dev'/);
 assert.match(html,/production:'https:\/\/shoot-sunday-sync\.yomax1979\.workers\.dev'/);
 assert.match(html,/if\(\$\('ssEnvironment'\)\.value!=='staging'\|\|!loadedFromStagingDirect\)/);
 assert.doesNotMatch(html,/fetch\(SS_GATEWAYS\.production\s*\+\s*path\s*,\s*\{[^}]*method:'POST'/);
});

test('second confirmed goal stays editable after first sent and official SS refresh',()=>{
 assert.match(html,/id="goalJump"/);
 assert.match(html,/const prepared=prepareGoalRows\(\{goals:source\},snapshot\)/);
 assert.match(html,/rows=preserveReviewRows\(applyManualRowEdits\(prepared,manualGoals,snapshot\)/);
 assert.match(html,/completedKeys:completedKey\?\[completedKey\]:\[\]/);
 assert.match(html,/const completedKeys=completed\.map\(x=>goalKeyOfOperation\(x\.operation\)\)/);
 assert.match(html,/rebuild\(\{preserveEdits:true,completedKeys\}\)/);
 assert.match(html,/rebuild\(\{preserveEdits:true\}\)/);
 assert.match(html,/const saved=row\.updateGoalId\|\|updateSelect\.value/);
 assert.match(html,/article\.id='review-goal-'/);
 // Only the row being edited is updated: rerendering goal #2 does not reset all fields.
 assert.match(html,/row\.scorer=scorerSelect\.value;invalidate\('scorer'\)/);
 assert.match(html,/row\.assist=assistSelect\.value;invalidate\('assist'\)/);
 assert.doesNotMatch(html,/scorerSelect\.addEventListener\('change',[^\n]*rebuild\(/);
});

test('manual goal without video is available in TEST-only review and existing batch',()=>{
 assert.match(html,/id="manualAddWrap"/);
 assert.match(html,/id="manualAddGoal"/);
 assert.match(html,/id="manualAddStatus"/);
 assert.match(html,/makeManualGoal\(crypto\.randomUUID\(\)\)/);
 assert.match(html,/unsentManualGoals\(manualGoals\)/);
 assert.match(html,/prepareGoalRows\(\{goals:source\},snapshot\)/);
 assert.match(html,/storeManualGoals\(localStorage,'staging'/);
 assert.match(html,/restoreManualGoals\(localStorage,'staging'/);
 assert.match(html,/manualGoals=markManualCompleted\(manualGoals/);
 assert.match(html,/g\.manual\?'SS手動登録（動画なし）'/);
 assert.match(html,/loadedFromStagingDirect&&\$\('ssEnvironment'\)\.value==='staging'/);
 assert.match(html,/id="batchPreview"/);
 assert.match(html,/id="batchExecute"/);
});

test('staging write recovery cannot silently retry failed requests',()=>{
 assert.match(html,/id="recoveryPanel"/);
 assert.match(html,/id="recoveryReload"/);
 assert.match(html,/id="recoveryDetails"/);
 assert.match(html,/pendingAttempts\(localStorage,snapshot\.eventId\)/);
 assert.match(html,/beginAttempt\(localStorage,snapshot\.eventId,goalKeyOfOperation\(item\.operation\),action,before\)/);
 assert.match(html,/beginAttempt\(localStorage,snapshot\.eventId,completedKey,request,before\)/);
 assert.match(html,/clearAttempt\(localStorage,snapshot\.eventId,goalKeyOfOperation\(item\.operation\)\)/);
 assert.match(html,/inspectAttempt\(entry,match\)/);
 assert.match(html,/SSに登録済みと確認 → 再送せず終了/);
 assert.match(html,/SSに未登録と確認 → 再審査に戻す/);
 assert.match(html,/前回の送信結果が未確認です/);
});

test('production remains read-only review and manual-detail editor stays open after refresh',()=>{
 assert.match(html,/const quickMode=loadedFromStagingDirect&&\$\('ssEnvironment'\)\.value==='staging'/);
 assert.match(html,/\$\('reviewArea'\)\.hidden=quickMode&&!\(preserveEdits&&wasEditing\)/);
 assert.match(html,/const wasEditing=!\$\('reviewArea'\)\.hidden/);
 assert.match(html,/\$\('quickPanel'\)\.hidden=!active/);
 assert.match(html,/renderGoals\(\);renderScores\(\);renderQuick\(\)/);
 // Production SS is still never used for a POST.
 assert.doesNotMatch(html,/fetch\(SS_GATEWAYS\.production\s*\+\s*path\s*,\s*\{[^}]*method:'POST'/);
});
