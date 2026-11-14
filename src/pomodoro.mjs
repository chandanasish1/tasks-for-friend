// Pure timer model. Wall-clock deadlines survive throttling, reloads and sleep.
export const DEFAULTS = { focus: 25, short: 5, long: 15, sessions: 4, shortEvery: 1, longEvery: 4, goal: 2, auto: false };
export function settings(input = {}) {
    const out = { ...DEFAULTS, ...input };
    for (const key of ['focus', 'short', 'long', 'sessions', 'shortEvery', 'longEvery']) {
        const max = ['focus', 'short', 'long'].includes(key) ? 180 : 24;
        if (!Number.isInteger(Number(out[key])) || out[key] < 1 || out[key] > max) throw new Error(`${key}: enter a whole number from 1 to ${max}.`);
        out[key] = Number(out[key]);
    }
    out.goal = Number(out.goal);
    if (!Number.isFinite(out.goal) || out.goal < 0.25 || out.goal > 24) throw new Error('Daily goal must be between 0.25 and 24 hours.');
    out.auto = out.auto === true;
    return out;
}
export function plan(config) {
    const c = settings(config), phases = [];
    for (let n = 1; n <= c.sessions; n++) {
        phases.push({ kind: 'focus', minutes: c.focus, session: n });
        if (n === c.sessions) continue;
        if (n % c.longEvery === 0) phases.push({ kind: 'long', minutes: c.long, session: n });
        else if (n % c.shortEvery === 0) phases.push({ kind: 'short', minutes: c.short, session: n });
    }
    return phases;
}
export function dayKey(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function splitDays(start, end) {
    const chunks = [];
    while (start < end) {
        const next = new Date(start); next.setHours(24, 0, 0, 0);
        const until = Math.min(end, next.getTime());
        chunks.push({ day: dayKey(start), milliseconds: until - start });
        start = until;
    }
    return chunks;
}
export function newRun(config, now, id, task = '') {
    return { id, phases: plan(config), index: 0, remaining: config.focus * 60000, started: now,
        status: 'running', auto: config.auto === true, piece: 0, task };
}
function credit(run, until, records) {
    if (run.phases[run.index].kind !== 'focus' || until <= run.started) return;
    const piece = run.piece++;
    splitDays(run.started, until).forEach((chunk, i) => records.push({
        id: `${run.id}:${piece}:${i}`, ...chunk, task: run.task, ended_at: new Date(until).toISOString()
    }));
}
export function advance(run, now, records) {
    if (!run || run.status !== 'running') return false;
    let changed = false;
    while (run.status === 'running' && now >= run.started + run.remaining) {
        const end = run.started + run.remaining;
        credit(run, end, records);
        run.index++;
        changed = true;
        if (run.index >= run.phases.length) { run.status = 'done'; run.remaining = 0; break; }
        run.remaining = run.phases[run.index].minutes * 60000;
        run.started = end;
        if (!run.auto) run.status = 'ready';
    }
    return changed;
}
export function pause(run, now, records) {
    advance(run, now, records);
    if (run?.status !== 'running') return;
    const elapsed = Math.max(0, Math.min(run.remaining, now - run.started));
    credit(run, run.started + elapsed, records);
    run.remaining -= elapsed;
    run.status = 'paused';
}
export function resume(run, now) {
    if (run && ['paused', 'ready'].includes(run.status)) { run.started = now; run.status = 'running'; }
}
export function remaining(run, now) {
    if (!run || run.status === 'done') return 0;
    return Math.max(0, run.remaining - (run.status === 'running' ? Math.max(0, now - run.started) : 0));
}
export function totals(records, run, now) {
    const days = {};
    const add = (r) => { days[r.day] = (days[r.day] || 0) + r.milliseconds; };
    const seen = new Set();
    for (const r of records) if (!seen.has(r.id)) { seen.add(r.id); add(r); }
    if (run?.status === 'running' && run.phases[run.index]?.kind === 'focus') {
        splitDays(run.started, Math.min(now, run.started + run.remaining)).forEach(add);
    }
    return days;
}
