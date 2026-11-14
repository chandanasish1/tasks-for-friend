import { tasksForDay, localDay } from './task-reminders.mjs';

export function companionTask(lists, now = Date.now()) {
    const candidates = tasksForDay(lists, localDay(now)).filter(t => !t._doneInToday && !t.completedAt);
    candidates.sort((a,b) => {
        const deadline = t => t.timeKind === 'deadline' && t.time ? t.time : '99:99';
        return deadline(a).localeCompare(deadline(b)) || (a.position || 0) - (b.position || 0);
    });
    const task = candidates[0];
    return task ? { title: task.text, detail: task.timeKind === 'deadline' && task.time ? `Due today at ${task.time}` : 'A small step on your list for today.' } : { title: '', detail: '' };
}

export function mountCompanion(store) {
    const cap = window.Capacitor;
    if (cap?.getPlatform?.() !== 'android' || !cap.isPluginAvailable?.('Companion')) return;
    const call = (method, args = {}) => cap.nativePromise('Companion', method, args);
    let routing=false;
    const route = async () => {
        if(document.hidden || routing)return;
        routing=true;
        try {
            const {route: destination}=await call('consumeRoute');
            if(destination==='today') {
                document.querySelector('[data-page=tasks]')?.click();
                const today=store.getState().lists.find(l=>l.name.trim().toLowerCase()==='today');
                if(today)store.setActiveView(today.id);
            } else if(destination==='focus') document.querySelector('[data-page=focus]')?.click();
        } finally {routing=false;}
    };
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'alerts-button'; button.textContent = 'Pixel pup';
    document.querySelector('.app-dock').append(button);
    let queue = Promise.resolve();
    const sync = () => {
        const next = store.getCurrentUser() ? companionTask(store.getState().lists) : {title:'',detail:''};
        const midnight = new Date(); midnight.setHours(24,0,0,0);
        next.validUntil = midnight.getTime();
        queue = queue.then(() => call('sync', next)).catch(error => console.warn('[Companion] Task sync unavailable', error));
        return queue;
    };
    button.onclick = async () => {
        try { await sync(); await call('open'); }
        catch { window.alert('Could not open the companion. Restart Tasks and try again.'); }
    };
    store.subscribeState(sync); store.subscribeAuth(sync);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) {sync();route().catch(console.warn);} });
    setInterval(()=>route().catch(console.warn),500);
    setInterval(() => { if(!document.hidden) sync(); }, 60000);
    sync();
}
