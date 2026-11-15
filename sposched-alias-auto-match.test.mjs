import test from 'node:test';
import assert from 'node:assert/strict';
import {matchOfficialAlias} from './sposched-alias-auto-match.mjs';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const snapshot={players:['濱直','やまだじょ'],memberIds:new Map([['濱直',a],['やまだじょ',b]]),playerTeam:new Map([['濱直','チーム1'],['やまだじょ','チーム1']]),matches:[{seq:1,leftTeam:'チーム1',rightTeam:'チーム2'}]};
test('registered alias maps to official current-event member',()=>assert.equal(matchOfficialAlias('ハマさん',[{alias:'ハマさん',member_id:a}],snapshot,1),'濱直'));
test('kana variants normalize',()=>assert.equal(matchOfficialAlias('はまさん',[{alias:'ハマさん',member_id:a}],snapshot,1),'濱直'));
test('ambiguous nickname never selects a player',()=>assert.equal(matchOfficialAlias('ハマさん',[{alias:'ハマさん',member_id:a},{alias:'ハマさん',member_id:b}],snapshot,1),null));
test('unknown member never selects a player',()=>assert.equal(matchOfficialAlias('ハマさん',[{alias:'ハマさん',member_id:'33333333-3333-4333-8333-333333333333'}],snapshot,1),null));
test('missing match never selects a player',()=>assert.equal(matchOfficialAlias('ハマさん',[{alias:'ハマさん',member_id:a}],snapshot,2),null));
test('unassigned team never selects a player',()=>assert.equal(matchOfficialAlias('ハマさん',[{alias:'ハマさん',member_id:a}],{...snapshot,playerTeam:new Map([['濱直','チーム3']])},1),null));

test('official roster name is matched directly without alias registration',()=>assert.equal(matchOfficialAlias('濱直',[],snapshot,1),'濱直'));
test('official roster name takes precedence over conflicting alias',()=>assert.equal(matchOfficialAlias('濱直',[{alias:'濱直',member_id:b}],snapshot,1),'濱直'));
test('direct official name outside fixture is not selected',()=>assert.equal(matchOfficialAlias('濱直',[],{...snapshot,playerTeam:new Map([['濱直','チーム3']])},1),null));
