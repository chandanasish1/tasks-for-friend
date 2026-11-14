import test from 'node:test';
import assert from 'node:assert/strict';
import { companionTask } from '../src/companion.mjs';

const now = new Date(2026,10,14,12).getTime();
test('companion chooses nearest unfinished deadline today', () => {
    const lists = [{name:'Today',tasks:[
        {text:'Later',time:'20:00',timeKind:'deadline'},
        {text:'Done',time:'13:00',timeKind:'deadline',completedAt:new Date(now).toISOString()},
        {text:'Report',time:'15:00',timeKind:'deadline'},
        {text:'Tomorrow',date:'2026-11-15',time:'10:00',timeKind:'deadline'}
    ]}];
    assert.deepEqual(companionTask(lists,now),{title:'Report',detail:'Due today at 15:00'});
});
test('no unfinished task clears the native snapshot', () => {
    assert.deepEqual(companionTask([],now),{title:'',detail:''});
});
test('routine completed yesterday becomes eligible today', () => {
    const lists = [{name:'Routine',tasks:[{text:'Read',completedAt:new Date(2026,10,13,12).toISOString()}]}];
    assert.equal(companionTask(lists,now).title,'Read');
});
