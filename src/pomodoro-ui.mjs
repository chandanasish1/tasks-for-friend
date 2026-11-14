import { settings, plan, newRun, pause, resume, remaining, dayKey } from './pomodoro.mjs';
import { createPomodoroStore } from './pomodoro-store.mjs';
import { createPomodoroAlerts } from './pomodoro-alerts.mjs';
import { isTaskCompleted, isTaskCompletedOn } from './utils.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const duration = ms => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}h ${m % 60}m`; };
const labels = { focus: 'Focus', short: 'Short break', long: 'Long break' };

export function mountPomodoro({ taskStore, supabase }) {
    const dialog = document.createElement('section');
    dialog.className = 'pomo-page';
    dialog.hidden = true;
    dialog.setAttribute('aria-labelledby', 'pomoTitle');
    dialog.innerHTML = `
      <header class="pomo-header"><h1 id="pomoTitle">Focus</h1><button type="button" data-close>Back to tasks</button></header>
      <div class="pomo-layout">
        <section class="pomo-timer" aria-label="Pomodoro timer">
          <p id="pomoPhase" role="status"></p><div id="pomoClock" class="pomo-clock" role="timer" aria-label="Time remaining">25:00</div>
          <p id="pomoRound" class="pomo-muted"></p><p id="pomoCurrentTask" class="pomo-task-title"></p>
          <div class="pomo-actions"><button type="button" id="pomoStart" class="pomo-primary">Start focus</button><button type="button" id="pomoStop">End batch</button></div>
          <p class="pomo-note">Only focus time counts. Closing this panel keeps the timer running.</p>
          <button type="button" id="pomoAlerts">Enable interval alerts</button><p id="pomoAlertStatus" class="pomo-note">The timer recovers when you return. Enable alerts for interval reminders on Android.</p>
        </section>
        <form id="pomoConfig" class="pomo-settings">
          <h3>Your session</h3>
          <div class="pomo-presets" aria-label="Timer presets"><button type="button" data-preset="25,5,15">Classic 25 / 5</button><button type="button" data-preset="50,10,30">Deep 50 / 10</button><button type="button" data-preset="15,3,10">Quick 15 / 3</button></div>
          <label>Focus on a task<select id="pomoTask"><option value="">Free focus</option></select></label>
          <fieldset id="pomoFields"><legend class="pomo-sr">Session settings</legend><div class="pomo-fields">
          <label>Focus · minutes<input name="focus" type="number" min="1" max="180" required></label>
          <label>Short break · minutes<input name="short" type="number" min="1" max="180" required></label>
          <label>Long break · minutes<input name="long" type="number" min="1" max="180" required></label>
          <label>Focus sessions<input name="sessions" type="number" min="1" max="24" required></label>
          <label>Short break every<input name="shortEvery" type="number" min="1" max="24" required><small>focus sessions</small></label>
          <label>Long break every<input name="longEvery" type="number" min="1" max="24" required><small>focus sessions</small></label>
          <label>Default daily goal · hours<input name="goal" type="number" min="0.25" max="24" step="0.25" required></label>
          </div><label class="pomo-check"><input name="auto" type="checkbox">Automatically start the next interval</label></fieldset>
          <p class="pomo-note">Long breaks replace short breaks when both are due. No break after the final session. Automatic mode continues the entire batch even while you are away.</p>
          <p id="pomoPlan" class="pomo-plan"></p><button type="submit">Save settings</button>
        </form>
      </div>
      <section class="pomo-history" aria-label="Focus history"><div class="pomo-progress-heading"><h3>Daily goal</h3><span id="pomoToday"></span></div><progress id="pomoProgress" max="100" value="0"></progress>
        <form id="pomoGoalForm" class="pomo-goal-form"><label>Day<input id="pomoGoalDay" type="date" required></label><label>Goal · hours<input id="pomoGoalHours" type="number" min="0.25" max="24" step="0.25" required></label><button type="submit">Set daily goal</button></form>
        <div class="pomo-month-heading"><button type="button" id="pomoPrev" aria-label="Previous month">←</button><h3 id="pomoMonth"></h3><button type="button" id="pomoNext" aria-label="Next month">→</button></div>
        <div class="pomo-weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
        <div id="pomoHeatmap" class="pomo-heatmap"></div><p id="pomoDayDetail" role="status" class="pomo-day-detail">Select a day to see focused time.</p>
        <div class="pomo-history-footer"><span id="pomoMonthTotal"></span><span class="pomo-legend">Less <i></i><i></i><i></i><i></i><i></i> More · up to 4h/day</span></div>
      </section><footer class="pomo-footer"><span id="pomoSync"></span><button type="button" id="pomoRetry">Sync history</button></footer><p id="pomoError" role="alert"></p>`;
    document.querySelector('#main').append(dialog);
    const $ = selector => dialog.querySelector(selector);
    const form = $('#pomoConfig');
    let month = new Date(); month.setDate(1);
    let selectedDay = dayKey(Date.now());
    let lastHistory = '';
    const alerts = createPomodoroAlerts(text => { $('#pomoAlertStatus').textContent = text; });
    const model = createPomodoroStore({ storage: localStorage, supabase, onChange: () => { draw(); alerts.refresh(model.get().run); } });
    const dock = document.createElement('nav'); dock.className = 'app-dock'; dock.setAttribute('aria-label', 'Main navigation');
    dock.innerHTML = '<button type="button" data-page="tasks" aria-current="page">Tasks</button><button type="button" data-page="focus">Focus</button>';
    document.querySelector('#app').append(dock);
    dock.querySelector('[data-page=tasks]').onclick = showTasks;
    dock.querySelector('[data-page=focus]').onclick = open;
    function showTasks() {
        dialog.hidden = true; document.body.classList.remove('focus-page');
        dock.querySelector('[data-page=tasks]').setAttribute('aria-current', 'page');
        dock.querySelector('[data-page=focus]').removeAttribute('aria-current');
    }
    function safely(fn) {
        try { $('#pomoError').textContent = ''; fn(); }
        catch (e) { $('#pomoError').textContent = e.message || 'Could not save. Check available device storage.'; }
    }
    function fillConfig() {
        const c = model.get().config;
        for (const name of ['focus', 'short', 'long', 'sessions', 'shortEvery', 'longEvery', 'goal']) form.elements[name].value = c[name];
        form.elements.auto.checked = c.auto;
        preview();
    }
    function readConfig() { return settings({ ...Object.fromEntries(new FormData(form)), auto: form.elements.auto.checked }); }
    function preview() {
        try {
            const phases = plan(readConfig());
            const focus = phases.filter(p => p.kind === 'focus').reduce((sum, p) => sum + p.minutes, 0);
            $('#pomoPlan').textContent = `${duration(focus * 60000)} focus · ${duration(phases.reduce((sum, p) => sum + p.minutes, 0) * 60000)} including breaks`;
        } catch { $('#pomoPlan').textContent = 'Enter valid intervals to preview this batch.'; }
    }
    function taskOptions() {
        const selected = $('#pomoTask').value;
        const tasks = taskStore.getState().lists.flatMap(list => list.tasks.filter(t => !(list.name.toLowerCase() === 'routine' ? isTaskCompletedOn(t, dayKey(Date.now())) : isTaskCompleted(t))).map(t => ({ ...t, list: list.name })));
        $('#pomoTask').innerHTML = '<option value="">Free focus</option>' + tasks.map(t => `<option value="${escape(t.id)}">${escape(t.text || t.title || t.name)} · ${escape(t.list)}</option>`).join('');
        $('#pomoTask').value = selected;
    }
    function open() {
        safely(() => {
            if (!dialog.hidden) return;
            model.tick(); fillConfig(); taskOptions(); $('#pomoGoalDay').value = selectedDay; $('#pomoGoalHours').value = model.goal(selectedDay);
            dialog.hidden = false; document.body.classList.add('focus-page');
            document.querySelector('#main').scrollTop = 0;
            dock.querySelector('[data-page=focus]').setAttribute('aria-current', 'page');
            dock.querySelector('[data-page=tasks]').removeAttribute('aria-current');
            draw(); model.sync();
        });
    }
    function draw() {
        const d = model.get(), run = d.run, active = run && run.status !== 'done';
        const ms = active ? remaining(run, Date.now()) : d.config.focus * 60000;
        const seconds = Math.ceil(ms / 1000);
        const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        dock.querySelector('[data-page=focus]').textContent = active ? `Focus · ${clock}` : 'Focus';
        if (dialog.hidden) return;
        $('#pomoClock').textContent = run?.status === 'done' ? '✓' : clock;
        $('#pomoPhase').textContent = active ? `${labels[run.phases[run.index].kind]}${run.status === 'paused' ? ' · paused' : run.status === 'ready' ? ' · ready' : ''}` : run?.status === 'done' ? 'Batch complete' : 'Ready to focus';
        $('#pomoRound').textContent = active ? `Session ${run.phases[run.index].session} of ${run.phases.filter(p => p.kind === 'focus').length}` : `${d.config.sessions} focus sessions planned`;
        $('#pomoCurrentTask').textContent = active ? run.task || 'Free focus' : '';
        $('#pomoStart').textContent = !active ? 'Start focus' : run.status === 'running' ? 'Pause' : run.status === 'paused' ? 'Resume' : `Start ${labels[run.phases[run.index].kind].toLowerCase()}`;
        $('#pomoStop').disabled = !active;
        $('#pomoFields').disabled = !!active;
        $('#pomoTask').disabled = !!active;
        form.querySelector('[type=submit]').disabled = !!active;
        form.querySelectorAll('[data-preset]').forEach(b => { b.disabled = !!active; });
        const days = model.totals(), today = dayKey(Date.now()), goal = model.goal(today);
        $('#pomoToday').textContent = `${duration(days[today] || 0)} / ${goal}h`;
        $('#pomoProgress').value = Math.min(100, (days[today] || 0) / (goal * 3600000) * 100);
        $('#pomoProgress').setAttribute('aria-label', `Today's focus: ${duration(days[today] || 0)} of ${goal} hours`);
        $('#pomoSync').textContent = model.status();
        const signature = `${month.getFullYear()}-${month.getMonth()}-${JSON.stringify(Object.entries(days).map(([k,v]) => [k,Math.floor(v/60000)]))}-${JSON.stringify(d.goals)}`;
        if (signature !== lastHistory) { lastHistory = signature; renderHistory(days); }
    }
    function renderHistory(days) {
        const year = month.getFullYear(), m = month.getMonth();
        $('#pomoMonth').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const offset = (new Date(year, m, 1).getDay() + 6) % 7;
        let html = '<span></span>'.repeat(offset), total = 0;
        for (let n = 1; n <= new Date(year, m + 1, 0).getDate(); n++) {
            const day = dayKey(new Date(year, m, n).getTime()), value = days[day] || 0;
            total += value;
            const level = value === 0 ? 0 : Math.min(4, Math.ceil(value / 3600000));
            html += `<button type="button" data-day="${day}" data-level="${level}" aria-pressed="${day === selectedDay}" aria-label="${day}: ${duration(value)}" title="${day}: ${duration(value)}"><span>${n}</span><small>${value ? duration(value) : '—'}</small></button>`;
        }
        $('#pomoHeatmap').innerHTML = html;
        $('#pomoMonthTotal').textContent = `${duration(total)} this month`;
        $('#pomoDayDetail').textContent = `${selectedDay}: ${duration(days[selectedDay] || 0)} focused · goal ${model.goal(selectedDay)}h`;
    }
    $('[data-close]').onclick = showTasks;
    form.addEventListener('input', preview);
    form.addEventListener('submit', e => { e.preventDefault(); safely(() => { const c = readConfig(); model.mutate(d => { d.config = c; }); draw(); }); });
    form.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const values = b.dataset.preset.split(','); ['focus','short','long'].forEach((k,i) => { form.elements[k].value = values[i]; }); preview(); });
    $('#pomoStart').onclick = () => safely(() => {
        alerts.unlockAudio();
        if (!model.get().run || model.get().run.status === 'done') {
            // Validate even when Start is used without separately saving the form.
            if (!form.reportValidity()) return;
            const c = readConfig();
            const selected = $('#pomoTask');
            const task = selected.value ? selected.selectedOptions[0].textContent : '';
            model.mutate(d => { d.config = c; d.run = newRun(c, Date.now(), crypto.randomUUID(), task); });
        } else model.mutate(d => { if (d.run.status === 'running') pause(d.run, Date.now(), d.records); else resume(d.run, Date.now()); });
        model.sync(); draw();
    });
    $('#pomoStop').onclick = () => {
        if (!confirm('End this batch? Focus time already spent will be saved.')) return;
        safely(() => { model.mutate(d => { pause(d.run, Date.now(), d.records); d.run = null; }); fillConfig(); model.sync(); });
    };
    $('#pomoGoalForm').onsubmit = e => { e.preventDefault(); safely(() => { const hours = Number($('#pomoGoalHours').value); settings({ goal: hours }); model.setGoal($('#pomoGoalDay').value, hours); }); };
    $('#pomoGoalDay').onchange = () => { selectedDay = $('#pomoGoalDay').value; $('#pomoGoalHours').value = model.goal(selectedDay); lastHistory = ''; draw(); };
    $('#pomoHeatmap').onclick = e => { const b = e.target.closest('[data-day]'); if (!b) return; selectedDay = b.dataset.day; $('#pomoGoalDay').value = selectedDay; $('#pomoGoalHours').value = model.goal(selectedDay); lastHistory = ''; draw(); };
    $('#pomoPrev').onclick = () => { month.setMonth(month.getMonth() - 1); draw(); };
    $('#pomoNext').onclick = () => { month.setMonth(month.getMonth() + 1); draw(); };
    $('#pomoRetry').onclick = () => model.sync();
    $('#pomoAlerts').onclick = async () => { await alerts.enable(); alerts.refresh(model.get().run, true); };
    const changeUser = user => safely(() => { showTasks(); model.switchUser(user?.id || (supabase ? null : 'local')); });
    taskStore.subscribeAuth(changeUser);
    changeUser(taskStore.getCurrentUser());
    taskStore.subscribeState(() => { if (!dialog.hidden && !$('#pomoTask').disabled) taskOptions(); });
    setInterval(() => safely(() => { if (model.tick()) alerts.signal(); draw(); }), 1000);
    setInterval(() => { if (!document.hidden) model.sync(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) safely(() => { model.tick(); draw(); model.sync(); alerts.refresh(model.get().run, true); }); });
    window.addEventListener('online', () => model.sync());
    window.addEventListener('storage', e => { if (e.key?.startsWith('tasks_pomodoro_v1:')) safely(() => { model.tick(); draw(); }); });
}
