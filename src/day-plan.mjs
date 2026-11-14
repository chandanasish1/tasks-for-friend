// Scheduling uses only tasks in this app. All values are local minutes within a day.
export function minutes(time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return null;
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}
export function clock(value) {
    if (value == null) return '';
    const day = Math.floor(value / 1440), n = value % 1440;
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}${day ? ` +${day}d` : ''}`;
}
export function normalizeDuration(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 1440 ? n : null;
}
export function normalizeDayOrder(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([day, order]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(order)));
}
export function priorityOrder(tasks, day) {
    return [...tasks].sort((a, b) => {
        const ap = a.dayOrder?.[day], bp = b.dayOrder?.[day];
        if (Number.isFinite(ap) || Number.isFinite(bp)) return (ap ?? Infinity) - (bp ?? Infinity);
        const deadline = t => t.timeKind === 'deadline' ? (t.date && t.date < day ? -1 : minutes(t.time) ?? Infinity) : Infinity;
        return deadline(a) - deadline(b) || (a.todayPosition ?? a.position ?? 0) - (b.todayPosition ?? b.position ?? 0);
    });
}
export function scheduleDay(tasks, day, now, previous = []) {
    const done = tasks.filter(t => t._doneInToday ?? !!t.completedAt);
    const pending = tasks.filter(t => !(t._doneInToday ?? !!t.completedAt));
    const results = [], reserved = [];
    const prior = new Map(previous.map(t => [t.id, t._plan]));
    const hasStart = t => minutes(t.time) != null && t.timeKind !== 'deadline';
    const rigid = t => hasStart(t) && t.rigid !== false;
    const oldDate = t => t.date && t.date < day;
    const annotate = (t, p) => ({ ...t, _plan: { sourceTime: t.time || '', sourceDuration: t.duration || null, ...p } });
    const add = item => { results.push(item); if (item._plan.start != null && item._plan.end >= now && !item._plan.overdue) reserved.push(item); };
    const fixed = pending.filter(rigid).sort((a,b) => minutes(a.time) - minutes(b.time));
    for (const t of fixed) {
        const start = minutes(t.time), end = start + (t.duration || 0);
        const overdue = !!oldDate(t) || (t.duration ? end <= now : start < now);
        add(annotate(t, { start, end, fixed: true, overdue,
            warning: overdue ? 'Overdue · rigid time unchanged' : end > 1440 ? 'Extends beyond this day' : '' }));
    }
    for (let i = 0; i < reserved.length; i++) for (let j = i+1; j < reserved.length; j++) {
        if (reserved[j]._plan.start < reserved[i]._plan.end || reserved[j]._plan.start === reserved[i]._plan.start)
            reserved[i]._plan.warning = reserved[j]._plan.warning = 'Overlapping rigid times';
    }
    const anchors = fixed.filter(t => !oldDate(t));
    const timed = pending.filter(t => hasStart(t) && !rigid(t));
    // Timed flexible work remains in the window before its next rigid anchor.
    // Delays cascade only as far as necessary; later preferred times stay intact.
    const groups = new Map();
    for (const t of timed) {
        const nextAnchor = anchors.find(a => minutes(a.time) >= minutes(t.time));
        const bound = nextAnchor ? minutes(nextAnchor.time) : 1440;
        if (!groups.has(bound)) groups.set(bound, []);
        groups.get(bound).push(t);
    }
    for (const [bound, group] of [...groups].sort((a,b) => a[0]-b[0])) {
        group.sort((a,b) => {
            const ap = a.dayOrder?.[day], bp = b.dayOrder?.[day];
            if (ap != null || bp != null) return (ap ?? Infinity) - (bp ?? Infinity);
            return minutes(a.time) - minutes(b.time) || (a.position || 0) - (b.position || 0);
        });
        let cursor = now;
        for (const t of group) {
            const preferred = minutes(t.time), length = t.duration || 0, p = prior.get(t.id);
            const keep = p && !p.overdue && p.sourceTime === t.time && p.sourceDuration === (t.duration || null)
                && p.start <= now && p.end > now && !p.fixed
                && !reserved.some(r => p.start < r._plan.end && p.end > r._plan.start);
            let start = keep ? p.start : Math.max(cursor, preferred);
            if (!keep) for (const r of [...reserved].sort((a,b) => a._plan.start-b._plan.start)) {
                if (start < r._plan.end && start + length > r._plan.start) start = r._plan.end;
                else if (r._plan.start === r._plan.end && start < r._plan.start && start + length > r._plan.start) start = r._plan.end;
            }
            if (oldDate(t) || start + length > bound || (length === 0 && preferred < now)) {
                results.push(annotate(t, { start: null, end: null, preferred, overdue: true,
                    warning: oldDate(t) ? 'Overdue · choose a new day' : bound < 1440 ? `Overdue · cannot fit before rigid ${clock(bound)}` : 'Overdue · no room left today' }));
                continue;
            }
            const end = start + length;
            add(annotate(t, { start, end, fixed: false, moved: start !== preferred, warning: '' }));
            cursor = Math.max(cursor, end);
        }
    }
    const pool = pending.filter(t => !hasStart(t));
    const deadline = t => t.timeKind === 'deadline' && minutes(t.time) != null ? (oldDate(t) ? -1 : minutes(t.time)) : Infinity;
    // Preserve an in-progress allocated gap until its end; after that, an
    // unchecked task returns to the queue and finds the next available gap.
    for (let i = pool.length-1; i >= 0; i--) {
        const t = pool[i], p = prior.get(t.id);
        if (t.duration && p && p.start != null && p.start <= now && p.end > now && p.sourceTime === (t.time || '')
            && p.sourceDuration === t.duration && !reserved.some(r => p.start < r._plan.end && p.end > r._plan.start)) {
            add(annotate(t, { ...p, warning: p.end > deadline(t) ? 'Cannot finish by deadline' : '' })); pool.splice(i,1);
        }
    }
    const gaps = []; let cursor = now;
    for (const r of reserved.sort((a,b) => a._plan.start-b._plan.start)) {
        if (r._plan.start > cursor) gaps.push([cursor, Math.min(r._plan.start,1440)]);
        cursor = Math.max(cursor,r._plan.end);
    }
    if (cursor < 1440) gaps.push([cursor,1440]);
    const work = priorityOrder(pool.filter(t => t.duration),day).sort((a,b) => deadline(a)-deadline(b));
    for (const [from,until] of gaps) {
        let slot = from;
        while (slot < until) {
            const index = work.findIndex(t => t.duration <= until-slot);
            if (index < 0) break;
            const t = work.splice(index,1)[0], end = slot+t.duration;
            results.push(annotate(t, { start:slot, end, warning: end > deadline(t) ? 'Cannot finish by deadline' : '', deadline: Number.isFinite(deadline(t)) ? minutes(t.time) : null }));
            slot=end;
        }
    }
    for (const t of work) results.push(annotate(t, { start:null, end:null, overflow:true, warning:'No gap long enough today' }));
    for (const t of priorityOrder(pool.filter(t => !t.duration),day)) results.push(annotate(t, {
        start:null, end:null, deadline:Number.isFinite(deadline(t)) ? minutes(t.time) : null,
        warning:deadline(t)<now ? 'Deadline has passed' : '' }));
    const position = t => t._plan.start ?? t._plan.preferred ?? t._plan.deadline ?? Infinity;
    results.sort((a,b) => position(a)-position(b));
    return [...results,...done];
}
