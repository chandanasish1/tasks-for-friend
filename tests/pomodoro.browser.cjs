// Run with Playwright available on NODE_PATH. Uses isolated local data, never a real account.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res) => {
    const file = path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err,data) => { if(err) { res.writeHead(404); return res.end(); }
        res.setHeader('Content-Type', file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(data); });
});
(async () => {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date(2026,10,14,7,10) });
        await page.addInitScript(() => {
            window.testNotifications=[];
            window.Notification=class { static permission='granted'; static async requestPermission(){return 'granted';}
                constructor(title,options){window.testNotifications.push({title,...options});} close(){} };
            const key='tasks_app_data_v4:local';
            if(localStorage.getItem(key)) return;
            const id=n=>`9c86a1de-0000-4000-8000-${String(n).padStart(12,'0')}`;
            localStorage.setItem(key,JSON.stringify({activeView:'all',lists:[{id:id(100),name:'Today',position:1,tasks:[
                {id:id(1),text:'Task 1',time:'06:30',duration:15,rigid:false,position:1},
                {id:id(2),text:'Task 2',time:'07:15',duration:40,rigid:true,position:2},
                {id:id(3),text:'Task 3',time:'08:30',duration:30,rigid:false,position:3},
                {id:id(4),text:'Gap task',duration:30,position:4},
                {id:id(5),text:'No schedule',position:5}
            ]},{id:id(101),name:'Routine',position:2,tasks:[{id:id(6),text:'Daily reading',time:'10:00',duration:30,rigid:true,position:1,completedAt:new Date(2026,10,14,6).toISOString()}]}]}));
        });
        await page.route('**/supabase.min.js', route => route.fulfill({ body: '', contentType: 'text/javascript' }));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('.day-start').click();
        const row=n=>page.locator(`[data-task-id="9c86a1de-0000-4000-8000-${String(n).padStart(12,'0')}"]`);
        assert.match(await row(1).locator('.task-schedule-summary').textContent(),/cannot fit before rigid 07:15/);
        assert.match(await row(2).locator('.task-schedule-summary').textContent(),/07:15–07:55/);
        assert.match(await row(3).locator('.task-schedule-summary').textContent(),/08:30–09:00/);
        assert.match(await row(4).locator('.task-schedule-summary').textContent(),/07:55–08:25/);
        await row(2).hover(); await row(2).getByRole('button',{name:'Edit task schedule'}).click();
        await page.locator('#taskPlanForm [name=rigid]').selectOption('false');
        await page.locator('#taskPlanForm [type=submit]').click();
        await page.locator('.day-start').click();
        assert.match(await row(1).locator('.task-schedule-summary').textContent(),/07:10–07:25/);
        assert.match(await row(2).locator('.task-schedule-summary').textContent(),/07:25–08:05/);
        await page.locator('.alerts-button').click();
        await page.locator('[data-enable]').click();
        await page.clock.runFor(1000);
        assert.equal(await page.evaluate(()=>window.testNotifications.filter(n=>n.tag?.endsWith(':start')).length),1);
        await page.clock.runFor(6000);
        assert.equal(await page.evaluate(()=>window.testNotifications.filter(n=>n.tag?.endsWith(':start')).length),1);
        await page.locator('[data-test]').click();
        assert.equal(await page.evaluate(()=>window.testNotifications.some(n=>n.tag==='tasks-test')),true);
        await page.locator('[data-disable]').click();
        await page.locator('[aria-label="Close notifications"]').click();
        await page.screenshot({path:path.join(process.env.TEMP,'tasks-plan-desktop.png'),fullPage:true});
        assert.equal(await page.locator('.pomo-page').isVisible(), false);
        await page.locator('.app-dock [data-page=focus]').click();
        await page.locator('[data-preset="50,10,30"]').click();
        assert.equal(await page.locator('[name=focus]').inputValue(), '50');
        await page.locator('[name=sessions]').fill('5');
        await page.locator('#pomoStart').click();
        assert.equal(await page.locator('#pomoStart').textContent(), 'Pause');
        await page.waitForTimeout(1200);
        await page.locator('#pomoStart').click();
        assert.equal(await page.locator('#pomoStart').textContent(), 'Resume');
        await page.reload();
        assert.equal(await page.locator('.pomo-page').isVisible(), false);
        await page.locator('.app-dock [data-page=focus]').click();
        assert.equal(await page.locator('#pomoStart').textContent(), 'Resume');
        await page.locator('#pomoGoalHours').fill('3.5');
        await page.locator('#pomoGoalForm [type=submit]').click();
        assert.match(await page.locator('#pomoToday').textContent(), /3.5h/);
        const currentMonth = await page.locator('#pomoMonth').textContent();
        await page.locator('#pomoPrev').click();
        assert.notEqual(await page.locator('#pomoMonth').textContent(), currentMonth);
        await page.locator('#pomoNext').click();
        page.once('dialog', d => d.accept()); await page.locator('#pomoStop').click();
        await page.locator('[name=focus]').fill('0');
        await page.locator('#pomoStart').click();
        assert.equal(await page.locator('#pomoStart').textContent(), 'Start focus');
        await page.locator('[data-preset="25,5,15"]').click();
        await page.locator('#pomoConfig [type=submit]').click();
        await page.screenshot({ path: path.join(process.env.TEMP, 'pomodoro-desktop.png'), fullPage: true });
        await page.locator('.app-dock [data-page=tasks]').click();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.locator('#sidebarOverlay').evaluate(el=>getComputedStyle(el).visibility), 'hidden');
        await page.screenshot({path:path.join(process.env.TEMP,'tasks-plan-mobile.png'),fullPage:true});
        await page.locator('.app-dock [data-page=focus]').click();
        assert.equal(await page.locator('.pomo-page').evaluate(el => el.scrollWidth <= el.clientWidth), true);
        await page.screenshot({ path: path.join(process.env.TEMP, 'pomodoro-mobile.png'), fullPage: true });
        await page.locator('#pomoHeatmap [data-day]').last().click();
        assert.match(await page.locator('#pomoDayDetail').textContent(), /focused/);
        await page.locator('#pomoHeatmap').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.TEMP, 'pomodoro-mobile-history.png'), fullPage: true });
        assert.deepEqual(errors, []);
        await page.locator('.app-dock [data-page=tasks]').click();
        await page.setViewportSize({width:1280,height:900});
        await page.getByText('Tomorrow',{exact:true}).first().click();
        await page.getByRole('button',{name:'Plan tomorrow',exact:true}).click();
        assert.match(await row(6).locator('.task-schedule-summary').textContent(),/10:00–10:30/);
        assert.equal(await row(6).locator('.task-checkbox').getAttribute('aria-disabled'),'true');
        assert.equal(await page.getByLabel('Plan start time').inputValue(),'08:00');
        await row(6).hover();await row(6).getByRole('button',{name:'Edit task schedule'}).click();
        assert.equal(await page.locator('#taskRecurrence').isVisible(),true);
        assert.equal(await page.locator('#taskPlanForm [name=date]').isDisabled(),true);
        await page.getByRole('button',{name:'Close schedule'}).click();
        assert.deepEqual(errors, []);
        const nativePage=await browser.newPage();
        await nativePage.clock.install({time:new Date(2026,10,14,7)});
        await nativePage.route('**/notification-harness',r=>r.fulfill({contentType:'text/html',body:'<nav class="app-dock"></nav>'}));
        await nativePage.goto(`http://127.0.0.1:${server.address().port}/notification-harness`);
        await nativePage.evaluate(async()=>{
            const state={lists:[{name:'Routine',tasks:[{id:'routine',text:'Read',time:'08:00',duration:30}]}]};
            const listeners=[];
            window.nativeCalls=[];window.nativePending=[];
            window.Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true,nativePromise:async(plugin,method,args)=>{
                window.nativeCalls.push({method,args});
                if(method==='getPending')return {notifications:window.nativePending};
                if(method==='requestPermissions'||method==='checkPermissions')return {display:'granted'};
                if(method==='schedule')window.nativePending.push(...args.notifications);
                if(method==='cancel')window.nativePending=window.nativePending.filter(n=>!args.notifications.some(c=>c.id===n.id));
                return {};
            }};
            const store={getState:()=>state,getCurrentUser:()=>({id:'native-test'}),subscribeState:fn=>listeners.push(fn),subscribeAuth:()=>{}};
            const {mountTaskNotifications}=await import('/src/task-notifications.mjs');
            mountTaskNotifications({store,plannedTasks:()=>null});
            window.completeRoutine=()=>{state.lists[0].tasks[0].completedAt=new Date().toISOString();listeners.forEach(fn=>fn());};
        });
        await nativePage.locator('.alerts-button').click();await nativePage.locator('[data-enable]').click();
        await nativePage.clock.runFor(1000);
        assert.equal(await nativePage.evaluate(()=>window.nativePending.length),14);
        assert.equal(await nativePage.evaluate(()=>window.nativePending.every(n=>n.isExactNotification===false)),true);
        await nativePage.evaluate(()=>window.completeRoutine());await nativePage.clock.runFor(1000);
        assert.equal(await nativePage.evaluate(()=>window.nativePending.length),12);
        assert.equal(await nativePage.evaluate(()=>window.nativePending.some(n=>n.extra.day==='2026-11-14')),false);
        await nativePage.locator('[data-disable]').click();await nativePage.clock.runFor(1000);
        assert.equal(await nativePage.evaluate(()=>window.nativePending.length),0);
        await nativePage.close();
        console.log('Browser checks passed: PDF examples, routine Tomorrow preview, daily completion isolation, notification permission/test/deduplication, native schedule/cancel, Focus controls and mobile layout; no page errors.');
    } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
