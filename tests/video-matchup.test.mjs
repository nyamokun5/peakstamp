import test from 'node:test';
import assert from 'node:assert/strict';
import {matchupFromUtterance} from '../video-matchup.mjs';
test('parses first-match audio label even when Gemini omitted team fields',()=>{
 assert.deepEqual(matchupFromUtterance({kind:'match_start',quote:'1試合目 1対2',match_label:'1対2'}),{teamA:'1',teamB:'2'});
 assert.deepEqual(matchupFromUtterance({kind:'match_start',quote:'決勝1対3',match_label:'決勝1対3'}),{teamA:'1',teamB:'3'});
 assert.equal(matchupFromUtterance({kind:'match_start',quote:'始まった始まった',match_label:null}),null);
});
