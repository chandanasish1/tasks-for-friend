import { localDay, dayOffset, tasksForDay, remindersForDay } from './task-reminders.mjs';
import { enableBrowserNotifications, showBrowserNotification } from './browser-notifications.mjs';

export function mountTaskNotifications({ store, plannedTasks }) {
    const cap = window.Capacitor;
    const native = !!(cap?.isNativePlatform?.() && cap?.isPluginAvailable?.('LocalNotifications'));
    const call = (method, args = {}) => cap.nativePromise('LocalNotifications',method,args);
    const button = document.createElement('button'); button.type='button'; button.className='alerts-button'; button.textContent='Alerts';
    document.querySelector('.app-dock').append(button);
    const dialog=document.createElement('dialog'); dialog.className='task-plan-dialog notification-dialog';
    dialog.innerHTML=`<header><h2>Notifications</h2><button type="button" data-close aria-label="Close notifications">×</button></header>
      <p>Task starts, planned duration ends, deadlines, and daily routines. Focus interval alerts are available on the Focus page.</p>
      <p>${native ? 'Android schedules the next 7 days on this phone. Open the app to refresh changes from another device. Battery restrictions or force-stopping can delay or stop delivery.' : 'Keep this website open for reminders. A sleeping or suspended browser may delay alerts; closing the page stops them.'}</p>
      <p>Tasks without a time need a planned slot before a reminder can be sent. Completing or rescheduling a task updates its reminders.</p>
      <p role="status" id="notificationStatus"></p><footer><button type="button" data-enable>Enable task alerts</button><button type="button" data-test>Test notification</button>${native ? '<button type="button" data-precise>Allow precise timing</button>' : ''}<button type="button" data-disable>Disable task alerts</button></footer>`;
    document.body.append(dialog);
    const status=dialog.querySelector('[role=status]');
    const scope=()=>store.getCurrentUser()?.id || 'local';
    const key=()=>`tasks_alerts_v1:${scope()}`;
    const enabled=()=>localStorage.getItem(key())==='true';
    let signature='', queue=Promise.resolve(), timer, lastScope=scope();
    let processing=false;
    const say=text=>{status.textContent=text;};
    function collect() {
        const today=localDay(), lists=store.getState().lists;
        return Array.from({length:native?7:1},(_,i)=> {
            const day=dayOffset(today,i);
            return remindersForDay(plannedTasks(day) || tasksForDay(lists,day,today),day);
        }).flat();
    }
    async function cancelNative() {
        const pending=await call('getPending');
        const notifications=(pending.notifications || []).filter(n=>n.id>=10000 && n.id<11000).map(n=>({id:n.id}));
        if(notifications.length) await call('cancel',{notifications});
    }
    async function reconcile() {
        if(processing) return;
        processing=true;
        try {
            const currentScope=scope();
            if(currentScope!==lastScope) { signature=''; lastScope=currentScope; }
            const active=enabled(), events=active ? collect() : [];
            if(native) {
                const upcoming=events.filter(e=>e.at>Date.now()).slice(0,512);
                const next=JSON.stringify([currentScope,active,upcoming]);
                if(next===signature) return;
                signature=next;
                queue=queue.then(async()=>{
                    await cancelNative();
                    if(!active || !upcoming.length) return;
                    if((await call('checkPermissions')).display!=='granted') { signature=''; say('Allow notifications in Android settings.'); return; }
                    const exact=(await call('checkExactNotificationSetting')).exact_alarm==='granted';
                    await call('createChannel',{id:'tasks',name:'Task and routine reminders',importance:4,vibration:true});
                    await call('schedule',{notifications:upcoming.map((e,i)=>({id:10000+i,title:e.title,body:e.body,channelId:'tasks',isExactNotification:exact,schedule:{at:new Date(e.at).toISOString(),allowWhileIdle:true},extra:{taskId:e.taskId,day:e.day}}))});
                    say(`Task alerts enabled. ${upcoming.length} reminders scheduled for the next 7 days.${exact?'':' Allow precise timing for more punctual reminders.'}`);
                }).catch(()=>{signature='';say('Could not schedule task alerts. Check Android settings and try again.');});
                await queue;
            } else if(active) {
                const sentKey=`tasks_alerts_sent_v1:${currentScope}`;
                let sent; try { sent=JSON.parse(localStorage.getItem(sentKey)||'{}'); } catch {sent={};}
                const now=Date.now();
                for(const e of events.filter(e=>e.at<=now && e.at>now-90000 && !sent[e.key])) {
                    if(await showBrowserNotification(e.title,e.body,e.key)) sent[e.key]=now;
                }
                sent=Object.fromEntries(Object.entries(sent).filter(([,at])=>now-at<172800000));
                localStorage.setItem(sentKey,JSON.stringify(sent));
            }
        } catch {say('Could not update reminders. Check notification permissions.');}
        finally {processing=false;}
    }
    function refresh() {clearTimeout(timer);timer=setTimeout(reconcile,200);}
    button.onclick=()=>{say(enabled()?'Task alerts are enabled on this device.':'Task alerts are off on this device.');dialog.showModal();};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-enable]').onclick=async()=>{
        try {
            if(native) {if((await call('requestPermissions')).display!=='granted') throw new Error('Allow notifications in Android settings.');}
            else await enableBrowserNotifications();
            localStorage.setItem(key(),'true');signature='';say('Task alerts enabled.');refresh();
        } catch(error) {say(error.message);}
    };
    dialog.querySelector('[data-disable]').onclick=()=>{localStorage.setItem(key(),'false');signature='';refresh();say('Task alerts disabled. Focus alerts are controlled separately.');};
    if(native) dialog.querySelector('[data-precise]').onclick=async()=>{
        try {await call('changeExactNotificationSetting');signature='';refresh();}
        catch {say('Open Android settings for Tasks, then Alarms & reminders.');}
    };
    dialog.querySelector('[data-test]').onclick=async()=>{
        try {
            if(native) {
                if((await call('requestPermissions')).display!=='granted') throw new Error('Allow notifications in Android settings.');
                await call('schedule',{notifications:[{id:9999,title:'Tasks notifications are working',body:'Task and routine reminders will appear here.',isExactNotification:false}]});
            } else {await enableBrowserNotifications();await showBrowserNotification('Tasks notifications are working','Task and routine reminders will appear here.','tasks-test');}
            say('Test notification sent.');
        } catch(error){say(error.message);}
    };
    store.subscribeState(refresh);store.subscribeAuth(()=>{signature='';refresh();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden) {signature='';refresh();}});
    window.addEventListener('storage',refresh);
    setInterval(reconcile,5000);refresh();
    return {refresh};
}
