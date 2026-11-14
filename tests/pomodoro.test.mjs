import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, settings, plan, newRun, advance, pause, resume, remaining, totals, dayKey } from '../src/pomodoro.mjs';
import { createPomodoroStore } from '../src/pomodoro-store.mjs';
const config = overrides => settings({ ...DEFAULTS, ...overrides });
test('long breaks take precedence and batches have no trailing break', () => {
    assert.deepEqual(plan(config({ sessions: 5, shortEvery: 2, longEvery: 4 })).map(p => p.kind),
        ['focus','focus','short','focus','focus','long','focus']);
});
test('settings reject non-finite, fractional and excessive intervals', () => {
    for (const bad of [NaN, Infinity, 0, -1, 1.5, 181, 'bad']) assert.throws(() => settings({ focus: bad }));
    assert.throws(() => settings({ goal: 0 }));
    assert.throws(() => settings({ sessions: 25 }));
});
test('pause/resume credits active time once and excludes paused time', () => {
    const r = newRun(config(), 1000, 'run'), records = [];
    pause(r, 61000, records);
    assert.equal(remaining(r, 500000), 24 * 60000);
    resume(r, 1000000); pause(r, 1060000, records);
    assert.equal(Object.values(totals(records, r, 1060000)).reduce((a,b) => a+b, 0), 120000);
    pause(r, 2000000, records); assert.equal(records.length, 2);
});
test('manual transitions never credit unattended later sessions', () => {
    const r = newRun(config(), 1000, 'run'), records = [];
    advance(r, 86400000, records);
    assert.equal(r.status, 'ready'); assert.equal(r.phases[r.index].kind, 'short');
    assert.equal(records.reduce((n,r) => n+r.milliseconds,0), 25*60000);
});
test('automatic batches catch up after reload and exclude every break', () => {
    let r = newRun(config({ auto: true, sessions: 5 }), 1000, 'run'), records = [];
    r = JSON.parse(JSON.stringify(r));
    advance(r, 86400000, records);
    assert.equal(r.status, 'done'); assert.equal(records.reduce((n,r) => n+r.milliseconds,0), 125*60000);
    advance(r, 999999999, records); assert.equal(records.length, 5);
});
test('focus across local midnight is allocated to each calendar day', () => {
    const start = new Date(2026, 10, 14, 23, 50).getTime();
    const r = newRun(config(), start, 'run'), records = [];
    advance(r, start + 25*60000, records);
    assert.deepEqual(totals(records, r, start+25*60000), { '2026-11-14': 10*60000, '2026-11-15': 15*60000 });
});
test('in-progress focus contributes to daily progress and duplicate ids are ignored', () => {
    const r = newRun(config(), 1000, 'run');
    assert.equal(totals([], r, 61000)[dayKey(1000)], 60000);
    const record = { id: 'x', day: '2026-11-14', milliseconds: 60000 };
    assert.equal(totals([record, record], null, 0)['2026-11-14'], 60000);
});
function memory() { const m = new Map(); return { getItem: k => m.get(k) || null, setItem: (k,v) => m.set(k,v) }; }
test('reload restores timer; user scopes isolate focus history and daily goals', () => {
    const storage = memory(); const s = createPomodoroStore({ storage }); s.switchUser('alice');
    s.mutate(d => { d.run = newRun(config(), Date.now(), 'run'); });
    s.setGoal('2026-11-14', 3);
    const reload = createPomodoroStore({ storage }); reload.switchUser('alice');
    assert.equal(reload.get().run.id, 'run'); assert.equal(reload.goal('2026-11-14'), 3);
    reload.switchUser('bob'); assert.equal(reload.get().run, null); assert.equal(reload.goal('2026-11-14'), 2);
    reload.switchUser('alice'); assert.equal(reload.get().run.status, 'paused');
});
test('failed durable storage does not start a timer in memory', () => {
    const storage = memory(); const s = createPomodoroStore({ storage }); s.switchUser('alice');
    storage.setItem = () => { throw new Error('full'); };
    assert.throws(() => s.mutate(d => { d.run = newRun(config(), 1000, 'run'); }));
    assert.equal(s.get().run, null);
});
test('cloud failure retains unsynced focus records for retry', async () => {
    const storage = memory();
    const supabase = { from: () => ({ upsert: async () => ({ error: new Error('offline') }), select: () => { throw new Error('offline'); } }) };
    const s = createPomodoroStore({ storage, supabase }); s.switchUser('alice');
    await new Promise(resolve => setTimeout(resolve, 0));
    s.mutate(d => { d.records.push({ id: 'x', day: '2026-11-14', milliseconds: 60000, task: '', ended_at: new Date().toISOString() }); });
    await s.sync(); assert.equal(s.get().records.length, 1); assert.ok(!s.get().records[0].synced);
    assert.match(s.status(), /unavailable/);
});
test('cloud ledger merges idempotently and remote goals are not replaced by local defaults', async () => {
    const remote = { focus_entries: [{ user_id: 'alice', id: 'remote', focused_on: '2026-11-13', milliseconds: 3600000, task_title: 'Read', ended_at: '2026-11-13T12:00:00Z' }],
        focus_goals: [{ user_id: 'alice', goal_on: '2026-11-13', hours: 5 }] };
    const supabase = { from: table => ({
        upsert: async rows => { for (const row of Array.isArray(rows) ? rows : [rows]) {
            const i = remote[table].findIndex(r => (r.id || r.goal_on) === (row.id || row.goal_on));
            if (i >= 0) remote[table][i] = row; else remote[table].push(row);
        } return { error: null }; },
        select: () => ({ eq: () => ({ order: () => ({ range: async (a,b) => ({ data: remote[table].slice(a,b+1), error: null }) }) }) })
    }) };
    const s = createPomodoroStore({ storage: memory(), supabase }); s.switchUser('alice');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(s.goal('2026-11-13'), 5); assert.equal(s.get().goals['2026-11-13'].dirty, false);
    await s.sync(); assert.equal(s.get().records.length, 1); assert.equal(remote.focus_goals[0].hours, 5);
    s.mutate(d => d.records.push({ id: 'local', day: '2026-11-14', milliseconds: 120000, task: '', ended_at: '2026-11-14T12:00:00Z' }));
    await s.sync(); await s.sync();
    assert.equal(remote.focus_entries.length, 2); assert.equal(s.get().records.length, 2);
    assert.equal(s.get().records.find(r => r.id === 'local').synced, true);
});
test('Android alert schedule follows automatic phases and cancels on pause', async () => {
    const calls = [];
    globalThis.window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true,
        nativePromise: async (plugin, method, args) => { calls.push({ method, args });
            return method === 'checkPermissions' ? { display: 'granted' } : method === 'checkExactNotificationSetting' ? { exact_alarm: 'granted' } : {};
        } } };
    const { createPomodoroAlerts } = await import('../src/pomodoro-alerts.mjs');
    const alerts = createPomodoroAlerts(() => {});
    const run = newRun(config({ auto: true, sessions: 2 }), Date.now(), 'native');
    alerts.refresh(run); await new Promise(resolve => setTimeout(resolve, 10));
    const scheduled = calls.find(c => c.method === 'schedule').args.notifications;
    assert.equal(scheduled.length, 3);
    assert.equal(new Date(scheduled[1].schedule.at) - new Date(scheduled[0].schedule.at), 5*60000);
    run.status = 'paused'; alerts.refresh(run); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls.at(-1).method, 'cancel');
});
