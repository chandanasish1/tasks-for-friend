import { clock, minutes, normalizeDuration, scheduleDay, priorityOrder } from './day-plan.mjs';

export function createDayPlanner({ store, render }) {
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    const now = () => new Date().getHours() * 60 + new Date().getMinutes();
    const key = () => `tasks_day_plans_v1:${store.getCurrentUser()?.id || 'local'}`;
    let cachedKey = '', days = {};
    function load() {
        if (cachedKey === key()) return;
        cachedKey = key();
        try { days = JSON.parse(localStorage.getItem(cachedKey) || '{}'); } catch { days = {}; }
    }
    function save() {
        // Keep recent daily plans; task-specific order itself is stored with the task.
        const keys = Object.keys(days).sort().slice(-60);
        days = Object.fromEntries(keys.map(k => [k, days[k]]));
        try { localStorage.setItem(key(), JSON.stringify(days)); } catch { /* In-memory plan still works. */ }
    }
    function start(day, startAt = now()) {
        load(); days[day] = { start: startAt, previous: [] }; save(); render();
    }
    function get(day) { load(); return days[day] || null; }
    function arrange(tasks, day) {
        load(); const entry = days[day];
        if (!entry) {
            const pending = tasks.filter(t => !(t._doneInToday ?? !!t.completedAt));
            const done = tasks.filter(t => t._doneInToday ?? !!t.completedAt);
            const fixed = pending.filter(t => t.time && t.timeKind !== 'deadline');
            const flexible = priorityOrder(pending.filter(t => !fixed.includes(t)), day);
            return [...fixed, ...flexible, ...done];
        }
        const from = day === today() ? Math.max(entry.start, now()) : entry.start;
        const result = scheduleDay(tasks, day, from, entry.previous || []);
        const previous = result.filter(t => t._plan).map(t => ({ id: t.id, _plan: t._plan }));
        if (JSON.stringify(previous) !== JSON.stringify(entry.previous)) { entry.previous = previous; save(); }
        return result;
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'task-plan-dialog'; dialog.setAttribute('aria-labelledby', 'taskPlanTitle');
    dialog.innerHTML = `<form id="taskPlanForm"><header><h2 id="taskPlanTitle">Task schedule</h2><button type="button" data-close aria-label="Close schedule">×</button></header>
      <p id="taskPlanName"></p><label>Day<input type="date" name="date"></label>
      <label>Duration · minutes (optional)<input type="number" name="duration" min="1" max="1440" step="1" placeholder="No duration"></label>
      <label>Time (optional)<input type="time" name="time"></label>
      <label>Use time as<select name="timeKind"><option value="start">Start time</option><option value="deadline">Finish-by deadline</option></select></label>
      <label id="taskRigidity">Start time flexibility<select name="rigid"><option value="true">Rigid · never move this time</option><option value="false">Flexible · adjust when I start my day</option></select></label>
      <p>Leave either field empty, or both. Duration-only tasks fill free gaps after you start your day. No duration means no estimated time is invented.</p>
      <p id="taskPlanError" role="alert"></p><footer><button type="button" data-clear>No time or duration</button><button type="submit">Save</button></footer></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    let location;
    function edit(listId, taskId) {
        const list = store.getState().lists.find(l => l.id === listId);
        const task = list?.tasks.find(t => t.id === taskId);
        if (!task) return;
        location = { listId, taskId };
        dialog.querySelector('#taskPlanName').textContent = task.text;
        form.elements.date.value = task.date || '';
        form.elements.date.disabled = list.name.toLowerCase() === 'routine';
        form.elements.duration.value = task.duration ?? '';
        form.elements.time.value = task.time || '';
        form.elements.timeKind.value = task.timeKind || 'start';
        form.elements.rigid.value = String(task.rigid !== false);
        updateRigidity();
        dialog.querySelector('#taskPlanError').textContent = '';
        dialog.showModal();
    }
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    function updateRigidity() { dialog.querySelector('#taskRigidity').hidden = !form.elements.time.value || form.elements.timeKind.value !== 'start'; }
    form.elements.time.oninput = updateRigidity; form.elements.timeKind.onchange = updateRigidity;
    dialog.querySelector('[data-clear]').onclick = () => { form.elements.duration.value = ''; form.elements.time.value = ''; updateRigidity(); };
    form.onsubmit = async e => {
        e.preventDefault();
        if (!form.reportValidity() || !location) return;
        const button = form.querySelector('[type=submit]'); button.disabled = true;
        try {
            const result = await store.updateTask(location.listId, location.taskId, {
                duration: normalizeDuration(form.elements.duration.value), time: form.elements.time.value,
                timeKind: form.elements.timeKind.value,
                rigid: form.elements.rigid.value === 'true',
                ...(!form.elements.date.disabled ? { date: form.elements.date.value } : {})
            });
            if (result?.ok) dialog.close();
            else dialog.querySelector('#taskPlanError').textContent = 'Could not save this schedule. Check sync status and database setup.';
        } finally { button.disabled = false; }
    };
    store.subscribeAuth(() => { dialog.close(); cachedKey = ''; });
    window.addEventListener('storage', e => { if (e.key === key()) { cachedKey = ''; render(); } });
    return { get, start, arrange, edit, now, today, clock, minutes };
}
