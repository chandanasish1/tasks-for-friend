import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleDay, normalizeDuration, minutes, priorityOrder } from '../src/day-plan.mjs';
import { normalizeTask } from '../src/utils.mjs';
const day = '2026-11-14';
const task = (id, time, duration, rigid = false) => ({ id, text:id, time, duration, rigid, timeKind:'start', position:Number(id)||0 });
const example = rigid => [task('1','06:30',15), task('2','07:15',40,rigid), task('3','08:30',30)];
const lookup = result => Object.fromEntries(result.map(t => [t.id,t._plan]));
test('PDF scenario 1(i): 06:45 shifts only the missed flexible task', () => {
    const p=lookup(scheduleDay(example(true),day,405));
    assert.deepEqual([p['1'].start,p['2'].start,p['3'].start],[405,435,510]);
    assert.equal(p['1'].moved,true); assert.equal(p['2'].fixed,true); assert.equal(p['3'].moved,false);
});
test('PDF scenario 1(ii): 07:10 cannot squeeze 15 minutes before rigid 07:15', () => {
    const p=lookup(scheduleDay(example(true),day,430));
    assert.equal(p['1'].start,null); assert.equal(p['1'].preferred,390); assert.equal(p['1'].overdue,true);
    assert.deepEqual([p['2'].start,p['3'].start],[435,510]);
});
test('PDF scenario 2: all flexible cascades 07:10, 07:25, 08:30', () => {
    const p=lookup(scheduleDay(example(false),day,430));
    assert.deepEqual([p['1'].start,p['2'].start,p['3'].start],[430,445,510]);
    assert.equal(p['3'].moved,false);
});
test('shorter untimed tasks fill gaps while longer tasks wait without moving anchors', () => {
    const tasks=[...example(true), task('long','',60),task('small','',15),task('medium','',30)];
    const p=lookup(scheduleDay(tasks,day,405));
    assert.deepEqual([p.small.start,p.medium.start,p.long.start],[420,475,540]);
    assert.equal(p['2'].start,435); assert.equal(p['3'].start,510);
});
test('unchecked gap tasks keep their active slot, then move to the next gap', () => {
    const tasks=[task('fixed','07:15',40,true),task('work','',15)];
    const first=scheduleDay(tasks,day,405);
    assert.equal(lookup(first).work.start,405);
    const during=scheduleDay(tasks,day,410,first);
    assert.equal(lookup(during).work.start,405);
    const after=scheduleDay(tasks,day,421,during);
    assert.equal(lookup(after).work.start,475);
    assert.equal(lookup(after).fixed.start,435);
});
test('completed tasks release space and never get rescheduled', () => {
    const tasks=[{...task('fixed','07:15',40,true),completedAt:'2026-11-14T07:00:00Z'},task('work','',60)];
    const r=scheduleDay(tasks,day,420);
    assert.equal(r[0]._plan.start,420); assert.equal(r.at(-1).id,'fixed'); assert.equal(r.at(-1)._plan,undefined);
});
test('no duration means no invented reservation; empty task stays unscheduled', () => {
    const p=lookup(scheduleDay([task('event','07:15',null,true),task('work','',30),task('empty','',null)],day,420));
    assert.equal(p.event.end,435); assert.equal(p.work.start,435); assert.equal(p.empty.start,null);
});
test('overlapping rigid events stay fixed and report conflict', () => {
    const p=lookup(scheduleDay([task('a','07:15',60,true),task('b','07:30',60,true)],day,400));
    assert.deepEqual([p.a.start,p.b.start],[435,450]); assert.match(p.a.warning,/Overlapping/); assert.match(p.b.warning,/Overlapping/);
});
test('work does not spill into tomorrow and expired rigid events never move', () => {
    const p=lookup(scheduleDay([task('fixed','06:30',15,true),task('long','',60)],day,1430));
    assert.equal(p.fixed.start,390); assert.equal(p.fixed.overdue,true); assert.equal(p.long.start,null); assert.equal(p.long.overflow,true);
});
test('manual priorities are scoped to a specific date', () => {
    const a={...task('a','',15),position:1,dayOrder:{[day]:2}}, b={...task('b','',15),position:2,dayOrder:{[day]:1}};
    assert.deepEqual(priorityOrder([a,b],day).map(t=>t.id),['b','a']);
    assert.deepEqual(priorityOrder([a,b],'2026-11-15').map(t=>t.id),['a','b']);
});
test('deadline tasks get earliest available gaps and impossible deadlines are explicit', () => {
    const p=lookup(scheduleDay([task('f','07:15',40,true),{...task('d','07:30',30),timeKind:'deadline'}],day,430));
    assert.equal(p.d.start,475); assert.match(p.d.warning,/Cannot finish/);
});
test('database schedule fields normalize safely with backward-compatible rigidity', () => {
    const t=normalizeTask({duration_minutes:40,is_rigid:false,time_kind:'start',day_order:{[day]:5,bad:NaN}});
    assert.equal(t.duration,40); assert.equal(t.rigid,false); assert.deepEqual(t.dayOrder,{[day]:5});
    assert.equal(normalizeTask({}).rigid,true);
    for(const n of [0,-2,1.5,1441,NaN,'x']) assert.equal(normalizeDuration(n),null);
    assert.equal(minutes('24:00'),null);
});
