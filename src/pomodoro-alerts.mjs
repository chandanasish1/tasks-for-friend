// Android schedules alarms natively; the web fallback sounds only while the page runs.
export function createPomodoroAlerts(onStatus) {
    const cap = window.Capacitor;
    const native = cap?.isNativePlatform?.() && cap?.isPluginAvailable?.('LocalNotifications');
    const call = (method, args = {}) => cap.nativePromise('LocalNotifications', method, args);
    let signature = '', queue = Promise.resolve(), audio;
    function unlockAudio() {
        if (native) return;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (Audio) { audio ||= new Audio(); audio.resume().catch(() => {}); }
    }
    function signal() {
        if (native || !audio || document.hidden) return;
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.frequency.value = 660; gain.gain.value = 0.12;
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.7);
        oscillator.start(); oscillator.stop(audio.currentTime + 0.7);
    }
    async function enable() {
        if (!native) { unlockAudio(); onStatus('Sound enabled while this page is active. Keep the app open for web alerts.'); return; }
        try {
            const permission = await call('requestPermissions');
            if (permission.display !== 'granted') { onStatus('Notifications are disabled in Android settings.'); return; }
            const exact = await call('checkExactNotificationSetting');
            if (exact.exact_alarm !== 'granted') await call('changeExactNotificationSetting');
            signature = '';
            onStatus('Interval alerts enabled. Android battery and alarm settings may affect delivery.');
        } catch { onStatus('Could not enable alerts. Check Android notification settings.'); }
    }
    function refresh(run, force = false) {
        if (!native) return;
        const next = JSON.stringify(run && { id: run.id, index: run.index, status: run.status, started: run.started, remaining: run.remaining });
        if (!force && next === signature) return;
        signature = next;
        const snapshot = run ? structuredClone(run) : null;
        queue = queue.then(async () => {
            await call('cancel', { notifications: Array.from({ length: 48 }, (_, i) => ({ id: 7400 + i })) });
            if (snapshot?.status !== 'running') return;
            if ((await call('checkPermissions')).display !== 'granted') { onStatus('Enable interval alerts to hear when a session ends.'); return; }
            const exact = await call('checkExactNotificationSetting');
            onStatus(exact.exact_alarm === 'granted' ? 'Interval alerts enabled.' : 'Alerts enabled; allow precise alarms in Android settings for better timing.');
            await call('createChannel', { id: 'pomodoro', name: 'Focus timer', importance: 4, vibration: true });
            let end = snapshot.started + snapshot.remaining;
            const notifications = [];
            for (let i = snapshot.index; i < snapshot.phases.length; i++) {
                if (i > snapshot.index) end += snapshot.phases[i].minutes * 60000;
                if (end > Date.now()) notifications.push({ id: 7400 + i, title: snapshot.phases[i].kind === 'focus' ? 'Focus session complete' : 'Break complete',
                    body: i === snapshot.phases.length - 1 ? 'Your focus batch is finished.' : snapshot.auto ? 'The next interval is starting.' : 'Open Tasks to start the next interval.',
                    channelId: 'pomodoro', schedule: { at: new Date(end).toISOString(), allowWhileIdle: true } });
                if (!snapshot.auto) break;
            }
            if (notifications.length) await call('schedule', { notifications });
        }).catch(() => { signature = ''; onStatus('Timer saved, but an interval alert could not be scheduled.'); });
    }
    return { enable, refresh, signal, unlockAudio };
}
