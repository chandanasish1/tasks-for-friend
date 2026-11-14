import { DEFAULTS, advance, pause, totals, dayKey } from './pomodoro.mjs';

export function createPomodoroStore({ storage, supabase, onChange = () => {} }) {
    let scope = null, data, message = '', syncing = false;
    const empty = () => ({ config: { ...DEFAULTS }, run: null, records: [], goals: {} });
    const key = () => `tasks_pomodoro_v1:${scope}`;
    const read = () => {
        const raw = storage.getItem(key());
        return raw ? JSON.parse(raw) : empty();
    };
    function snapshotGoals(next) {
        for (const day of new Set(next.records.filter(r => !r.synced).map(r => r.day))) {
            if (!next.goals[day]) next.goals[day] = { hours: next.config.goal, dirty: true, revision: crypto.randomUUID() };
        }
    }
    function mutate(fn) {
        if (!scope) return;
        // Read latest state before each transaction, including changes from another tab.
        const next = read();
        fn(next);
        snapshotGoals(next);
        storage.setItem(key(), JSON.stringify(next));
        data = next;
        onChange();
    }
    function switchUser(id) {
        if (scope === id) return;
        if (scope) mutate(d => pause(d.run, Date.now(), d.records));
        scope = id;
        data = scope ? read() : empty();
        message = supabase ? 'Saved on this device' : 'Saved on this device';
        onChange();
        sync();
    }
    function tick(now = Date.now()) {
        if (!scope) return false;
        data = read();
        if (data.run?.status !== 'running') return false;
        const changed = advance(data.run, now, data.records);
        if (changed) {
            snapshotGoals(data);
            storage.setItem(key(), JSON.stringify(data));
            onChange();
            sync();
        }
        return changed;
    }
    async function sync() {
        if (!supabase || !scope || scope === 'local' || syncing) return;
        const owner = scope;
        syncing = true;
        message = 'Syncing focus history…'; onChange();
        try {
            let snapshot = read();
            for (let offset = 0; offset < snapshot.records.length; offset += 200) {
                const pending = snapshot.records.slice(offset, offset + 200).filter(r => !r.synced);
                if (!pending.length) continue;
                const { error } = await supabase.from('focus_entries').upsert(pending.map(r => ({
                    user_id: owner, id: r.id, focused_on: r.day, milliseconds: r.milliseconds,
                    task_title: r.task, ended_at: r.ended_at
                })), { onConflict: 'user_id,id' });
                if (error) throw error;
                if (scope !== owner) return;
                const ids = new Set(pending.map(r => r.id));
                mutate(d => d.records.forEach(r => { if (ids.has(r.id)) r.synced = true; }));
            }
            for (const [day, goal] of Object.entries(snapshot.goals)) {
                if (!goal.dirty) continue;
                const { error } = await supabase.from('focus_goals').upsert({ user_id: owner,
                    goal_on: day, hours: goal.hours }, { onConflict: 'user_id,goal_on' });
                if (error) throw error;
                if (scope !== owner) return;
                mutate(d => { if (d.goals[day]?.revision === goal.revision) d.goals[day].dirty = false; });
            }
            // Page through the ledger instead of silently accepting Supabase's row cap.
            for (let offset = 0; ; offset += 500) {
                const { data: rows, error } = await supabase.from('focus_entries').select('*')
                    .eq('user_id', owner).order('id').range(offset, offset + 499);
                if (error) throw error;
                if (scope !== owner) return;
                mutate(d => {
                    const known = new Set(d.records.map(r => r.id));
                    for (const r of rows) if (!known.has(r.id)) d.records.push({ id: r.id, day: r.focused_on,
                        milliseconds: Number(r.milliseconds), task: r.task_title, ended_at: r.ended_at, synced: true });
                });
                if (rows.length < 500) break;
            }
            for (let offset = 0; ; offset += 500) {
                const { data: goals, error } = await supabase.from('focus_goals').select('*')
                    .eq('user_id', owner).order('goal_on').range(offset, offset + 499);
                if (error) throw error;
                if (scope !== owner) return;
                mutate(d => { for (const g of goals) if (!d.goals[g.goal_on]?.dirty)
                    d.goals[g.goal_on] = { hours: Number(g.hours), dirty: false }; });
                if (goals.length < 500) break;
            }
            message = 'Focus history synced';
        } catch {
            if (scope === owner) message = 'Saved on this device · cloud sync unavailable';
        } finally {
            syncing = false; onChange();
            if (scope !== owner) sync();
        }
    }
    function setGoal(day, hours) {
        mutate(d => { d.goals[day] = { hours, dirty: true, revision: crypto.randomUUID() }; });
        sync();
    }
    return { switchUser, mutate, tick, sync, setGoal, get: () => data || empty(), status: () => message,
        totals: (now = Date.now()) => totals((data || empty()).records, data?.run, now),
        goal: (day = dayKey(Date.now())) => data?.goals[day]?.hours ?? data?.config.goal ?? DEFAULTS.goal };
}
