import test from 'node:test';
import assert from 'node:assert/strict';
import { localDay, dayOffset, routineOccurrence, tasksForDay, remindersForDay } from '../src/task-reminders.mjs';
import { scheduleDay } from '../src/day-plan.mjs';
const day='2026-11-14';
const routine={id:'r',text:'Read',time:'08:00',duration:30,rigid:true,completedAt:new Date(2026,10,14,9).toISOString(),date:'2026-10-01'};

test('routine completion applies only to its local day; time and duration repeat',()=>{
    const today=routineOccurrence(routine,day), tomorrow=routineOccurrence(routine,dayOffset(day,1));
    assert.equal(today._doneInToday,true); assert.equal(tomorrow._doneInToday,false);
    assert.equal(tomorrow.time,'08:00');assert.equal(tomorrow.duration,30);
    assert.equal(tomorrow.date,'2026-11-15');assert.equal(tomorrow.completedAt,'');
    assert.equal(scheduleDay([tomorrow],tomorrow.date,420)[0]._plan.start,480);
    assert.equal(routine.date,'2026-10-01');
});
test('routine duration without time fills gaps and empty routines remain unallocated',()=>{
    const tasks=[routineOccurrence({...routine,completedAt:'',time:'',rigid:false},day),
        routineOccurrence({...routine,id:'empty',completedAt:'',time:'',duration:null},day)];
    const result=scheduleDay(tasks,day,420);
    assert.equal(result[0]._plan.start,420);assert.equal(result[1]._plan.start,null);
    assert.equal(remindersForDay(result,day).length,2);
});
test('daily collection repeats routines without duplicating one-off events',()=>{
    const lists=[{name:'Routine',tasks:[routine]},{name:'Today',tasks:[{id:'a',time:'10:00'}]},
        {name:'Work',tasks:[{id:'b',date:'2026-11-15',time:'11:00'}]}];
    assert.deepEqual(tasksForDay(lists,day,day).map(t=>t.id),['r','a']);
    assert.deepEqual(tasksForDay(lists,'2026-11-15',day).map(t=>t.id),['r','b']);
    assert.equal(remindersForDay(tasksForDay(lists,day,day),day).length,1);
});
test('reminders follow allocated start and end rather than the original preferred time',()=>{
    const t={id:'a',text:'Work',time:'06:30',duration:15,_plan:{start:430,end:445}};
    const events=remindersForDay([t],day);
    assert.deepEqual(events.map(e=>new Date(e.at).getHours()*60+new Date(e.at).getMinutes()),[430,445]);
    assert.equal(events[0].key,'2026-11-14:a:start');
    assert.equal(remindersForDay([{...t,_plan:{start:null,overdue:true}}],day).length,0);
});
test('deadlines produce deadline and allocated-start alerts, never an invented start',()=>{
    const t={id:'d',text:'Submit',time:'09:00',timeKind:'deadline',duration:30};
    assert.equal(remindersForDay([t],day).length,1);
    const events=remindersForDay([{...t,_plan:{start:480,end:510}}],day);
    assert.deepEqual(events.map(e=>e.title),['Task starts now','Task deadline']);
});
test('completed, untimed and midnight-overflow tasks do not create misleading alerts',()=>{
    assert.equal(remindersForDay([{id:'a',time:'10:00',completedAt:'done'},{id:'b',duration:20}],day).length,0);
    assert.equal(remindersForDay([{id:'a',time:'23:50',duration:30}],day).length,1);
    assert.equal(dayOffset('2026-12-31',1),'2027-01-01');
    assert.equal(localDay(new Date(2026,10,14,23,59)),day);
});
