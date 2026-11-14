import { minutes } from './day-plan.mjs';

export function localDay(value = Date.now()) {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function dayOffset(day, offset) {
    const [y,m,d] = day.split('-').map(Number);
    return localDay(new Date(y,m-1,d+offset));
}
export function routineOccurrence(task, day) {
    const done = !!task.completedAt && localDay(task.completedAt) === day;
    return { ...task, date: day, completedAt: done ? task.completedAt : '', _doneInToday: done, _isRoutine: true };
}
export function tasksForDay(lists, day, today = localDay()) {
    return lists.flatMap(list => list.tasks.flatMap(task => {
        const name = list.name.trim().toLowerCase();
        if (name === 'routine') return [routineOccurrence(task, day)];
        const date = task.date || (name === 'today' ? today : name === 'tomorrow' ? dayOffset(today,1) : '');
        return date === day ? [{ ...task, _doneInToday: !!task.completedAt }] : [];
    }));
}
export function remindersForDay(tasks, day) {
    const [y,m,d] = day.split('-').map(Number);
    const at = minute => new Date(y,m-1,d,0,minute).getTime();
    const events = [];
    for (const t of tasks) {
        if (t._doneInToday ?? !!t.completedAt) continue;
        const add = (kind, minute, title) => {
            if (minute == null || minute < 0 || minute >= 1440) return;
            events.push({ key: `${day}:${t.id}:${kind}`, at: at(minute), title,
                body: t.text, taskId: t.id, day });
        };
        const deadline = t.timeKind === 'deadline' ? minutes(t.time) : null;
        const start = t._plan ? (t._plan.overdue ? null : t._plan.start) : deadline == null ? minutes(t.time) : null;
        if (start != null) {
            add('start',start, t._isRoutine ? 'Routine starts now' : 'Task starts now');
            if (t.duration && deadline == null) add('end',start+t.duration,'Planned task time is up');
        }
        if (deadline != null) add('deadline',deadline,'Task deadline');
    }
    return events.sort((a,b) => a.at-b.at || a.key.localeCompare(b.key));
}
