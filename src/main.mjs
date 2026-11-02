import { createTasksStore } from './store.mjs';
import {
    isTaskCompleted,
    isTaskCompletedOn,
    normalizePosition,
    sortRoutineTasksForDisplay,
    sortTasksForDisplay,
    sortTodayTasksForDisplay,
    sortTomorrowTasksForDisplay,
    sortUpcomingTasksForDisplay
} from './utils.mjs';
import { APP_VERSION } from './version.mjs';
import { SUPABASE_URL, SUPABASE_KEY } from './config.mjs';

const FALLBACK_SYNC_INTERVAL_MS = 60000;
const REALTIME_HEALTHY_POLL_INTERVAL_MS = 300000;
const POSITION_STEP = 1024;

function detectNativeApp() {
    const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
    const reportedPlatform = capacitor?.getPlatform?.();
    return Boolean(
        capacitor?.isNativePlatform?.() ||
        reportedPlatform === 'android' ||
        reportedPlatform === 'ios'
    );
}

function clearNativeWebCaches() {
    if (typeof window === 'undefined') {
        return;
    }

    const deleteCaches = () => {
        if (!('caches' in window)) {
            return Promise.resolve();
        }

        return window.caches.keys()
            .then((cacheNames) => Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName))))
            .catch((error) => {
                console.warn('[Native] Cache cleanup skipped:', error);
            });
    };

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations()
            .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
            .then(() => deleteCaches())
            .then(() => setTimeout(deleteCaches, 1000))
            .catch((error) => {
                console.warn('[Native] Service worker cleanup skipped:', error);
            });
        return;
    }

    deleteCaches();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Single icon family (24 viewBox, 1.8 stroke, round joins) so the calendar,
// clock, and dustbin read as one set everywhere they appear.
const ICON_PATHS = {
    calendar: '<rect x="3.5" y="4.5" width="17" height="17" rx="3.5"/><path d="M8 2.5v4M16 2.5v4M3.5 9.5h17"/>',
    clock: '<circle cx="12" cy="12" r="8.75"/><path d="M12 7.5V12l3.2 1.9"/>',
    trash: '<path d="M4 6.5h16"/><path d="M9 6.5V5.25A1.75 1.75 0 0 1 10.75 3.5h2.5A1.75 1.75 0 0 1 15 5.25V6.5"/><path d="M6.2 6.5l.7 12.2a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9l.7-12.2"/><path d="M10 10.5v6.5M14 10.5v6.5"/>',
    alert: '<circle cx="12" cy="12" r="8.75"/><path d="M12 7.5v5M12 16.2h.01"/>'
};

function icon(name, size = 18) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}

function formatDate(iso) {
    if (!iso) {
        return '';
    }

    const date = new Date(`${iso}T00:00:00`);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function getTomorrowIso() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
}

function getTodayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getRelativeDate(iso) {
    if (!iso) {
        return '';
    }

    const taskDate = new Date(`${iso}T00:00:00`).setHours(0, 0, 0, 0);
    const today = new Date().setHours(0, 0, 0, 0);
    const differenceInDays = Math.round((taskDate - today) / (1000 * 60 * 60 * 24));

    if (differenceInDays === 0) {
        return 'TODAY';
    }
    if (differenceInDays === 1) {
        return 'TOMORROW';
    }
    if (differenceInDays === -1) {
        return 'YESTERDAY';
    }
    if (differenceInDays > 0) {
        return `${differenceInDays} DAYS LEFT`;
    }
    return `${Math.abs(differenceInDays)} DAYS AGO`;
}

export async function bootstrapTasksApp() {
    const $ = (selector, parent = document) => parent.querySelector(selector);
    const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

    console.log(`[Tasks] v${APP_VERSION}`);
    const appVersionEl = $('#appVersion');
    if (appVersionEl) {
        appVersionEl.textContent = `v${APP_VERSION}`;
    }

    const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
    const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
    const enableOfflineQueue = detectNativeApp();
    const store = createTasksStore({ supabase, enableOfflineQueue });
    const getNativePlugin = (pluginName) => {
        if (!enableOfflineQueue || !capacitor?.isNativePlatform?.()) {
            return null;
        }

        if (typeof capacitor.isPluginAvailable === 'function' && !capacitor.isPluginAvailable(pluginName)) {
            return null;
        }

        return {
            addListener: (eventName, listener) => capacitor.addListener(pluginName, eventName, listener),
            call: (methodName, options = {}) => capacitor.nativePromise(pluginName, methodName, options)
        };
    };
    const appPlugin = getNativePlugin('App');
    const networkPlugin = getNativePlugin('Network');
    let isAuthBootstrapping = Boolean(supabase) && enableOfflineQueue;

    document.body.classList.toggle('native-app', enableOfflineQueue);
    document.body.classList.toggle('web-app', !enableOfflineQueue);
    if (enableOfflineQueue) {
        clearNativeWebCaches();
    }

    let appState = store.getState();
    let currentUser = store.getCurrentUser();
    let syncStatus = store.getSyncStatus();
    let lastWidth = window.innerWidth;
    let contextListId = null;
    let contextTaskId = null;
    let contextTaskListId = null;
    let modalMode = null;
    let touchStartX = 0;
    let touchStartTime = 0;
    let isEdgeSwipe = false;
    let calCurrentDate = new Date();
    let calSelectedIso = null;
    let sortableInstance = null;
    let lastRenderedTodayIso = getTodayIso();
    let pendingRenderWhileTyping = false;
    let isDraggingList = false;
    let isDraggingTask = false;
    let suppressListInteractionsUntil = 0;
    let suppressTaskInteractionsUntil = 0;
    // Set while an add-task input is open in a list that allows dates; the
    // calendar modal routes its pick here for the not-yet-created task.
    let activeNewTaskDateSetter = null;

    const syncIndicator = $('.sync-indicator');
    const authOverlay = $('#authOverlay');
    const appContainer = $('#app');
    const authForm = $('#authForm');
    const emailInput = $('#email');
    const passwordInput = $('#password');
    const authSubmit = $('#authSubmit');
    const authError = $('#authError');

    const topbar = $('#topbar');
    const topbarHamburger = $('#topbarHamburger');
    const topbarTitle = $('.topbar-title');
    const mobileTabs = $('#mobileTabs');
    const sidebar = $('#sidebar');
    const sidebarOverlay = $('#sidebarOverlay');
    const sidebarTitle = $('.app-title');
    const hamburgerBtn = $('#hamburgerBtn');
    const createBtn = $('#createBtn');
    const searchInput = $('#searchInput');
    const searchClear = $('#searchClear');
    const searchResults = $('#searchResults');
    const navAll = $('#navAll');
    const listsToggle = $('#listsToggle');
    const listsContainer = $('#listsContainer');
    const signOutBtn = $('#signOutBtn');
    const mainEl = $('#main');
    const board = $('#board');
    const routineHeatmap = $('#routineHeatmap');
    const heatmapHeader = $('#heatmapHeader');
    const heatmapToggle = $('#heatmapToggle');
    const heatmapGrid = $('#heatmapGrid');
    const heatmapSub = $('#heatmapSub');
    const HEATMAP_COLLAPSED_KEY = 'tasks_heatmap_collapsed_v1';

    const contextMenu = $('#contextMenu');
    const ctxRename = $('#ctxRename');
    const ctxDelete = $('#ctxDelete');

    const modalOverlay = $('#modalOverlay');
    const modalTitle = $('#modalTitle');
    const modalInput = $('#modalInput');
    const modalCancel = $('#modalCancel');
    const modalConfirm = $('#modalConfirm');

    const deleteConfirmOverlay = $('#deleteConfirmOverlay');
    const deleteConfirmTitle = $('#deleteConfirmTitle');
    const deleteConfirmMessage = $('#deleteConfirmMessage');
    const deleteConfirmCancel = $('#deleteConfirmCancel');
    const deleteConfirmOk = $('#deleteConfirmOk');
    let pendingDeleteCallback = null;

    const calOverlay = $('#customDateModalOverlay');
    const calTitle = $('#calTitle');
    const calPrevBtn = $('#calPrevBtn');
    const calNextBtn = $('#calNextBtn');
    const calGrid = $('#calGrid');
    const calClearBtn = $('#calClearBtn');

    const timeModalOverlay = $('#timeModalOverlay');
    const timeModalTask = $('#timeModalTask');
    const timeSegHour = $('#timeSegHour');
    const timeSegMinute = $('#timeSegMinute');
    const clockFace = $('#clockFace');
    const clockHand = $('#clockHand');
    const timeClearBtn = $('#timeClearBtn');
    const timeSetBtn = $('#timeSetBtn');
    let timeTaskId = null;
    let timeTaskListId = null;
    let timeSelectedHour = null;
    let timeSelectedMinute = null;
    let timePickerMode = 'hour';

    function refreshAuthUI() {
        if (isAuthBootstrapping) {
            const canShowBootContent = Boolean(currentUser) || appState.lists.length > 0;
            authOverlay.classList.toggle('hidden', canShowBootContent);
            appContainer.classList.toggle('hidden', !canShowBootContent);
            return;
        }

        const showApp = !supabase || Boolean(currentUser);
        authOverlay.classList.toggle('hidden', showApp);
        appContainer.classList.toggle('hidden', !showApp);

        if (!showApp) {
            closeAllMenus();
            closeModal();
            closeCustomCalendar();
            closeTimeModal();
        }
    }

    function updateSyncIndicator() {
        if (!syncIndicator) {
            return;
        }

        document.body.classList.toggle('syncing', syncStatus.phase === 'syncing');

        const lastSuccessLabel = syncStatus.lastSuccessAt
            ? new Date(syncStatus.lastSuccessAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
            : 'not yet';

        let title = 'Sync is idle.';
        if (syncStatus.phase === 'syncing') {
            title = syncStatus.pending > 0 ? `Syncing ${syncStatus.pending} change(s)...` : 'Syncing...';
        } else if (syncStatus.phase === 'queued') {
            title = `${syncStatus.pending} change(s) queued for sync.`;
        } else if (syncStatus.phase === 'offline') {
            title = syncStatus.pending > 0 ? `Offline. ${syncStatus.pending} change(s) waiting to sync.` : 'Offline. Waiting for connection.';
        } else if (syncStatus.phase === 'error') {
            title = syncStatus.error || 'Sync needs attention.';
        } else if (syncStatus.phase === 'synced') {
            title = `Last synced at ${lastSuccessLabel}.`;
        } else if (syncStatus.phase === 'local') {
            title = 'Local-only mode.';
        }

        syncIndicator.dataset.state = syncStatus.phase;
        if (syncStatus.pending > 0) {
            syncIndicator.dataset.pending = String(syncStatus.pending);
        } else {
            delete syncIndicator.dataset.pending;
        }

        const label = `${title} Tap to sync now.`;
        syncIndicator.title = label;
        syncIndicator.setAttribute('aria-label', label);
    }

    function placeSyncIndicator() {
        if (!syncIndicator) {
            return;
        }

        const useInlineDesktopTitle = !enableOfflineQueue && window.innerWidth > 768;
        if (!useInlineDesktopTitle) {
            syncIndicator.classList.remove('in-title');
            document.body.appendChild(syncIndicator);
            return;
        }

        const target = sidebar.classList.contains('collapsed') ? topbarTitle : sidebarTitle;
        if (!target) {
            syncIndicator.classList.remove('in-title');
            document.body.appendChild(syncIndicator);
            return;
        }

        syncIndicator.classList.add('in-title');
        target.appendChild(syncIndicator);
    }

    function getBuiltInListKey(found) {
        if (!found) {
            return '';
        }

        const normalizedName = found.name.trim().toUpperCase();
        if (normalizedName === 'TODAY' || normalizedName === 'UPCOMING' || normalizedName === 'ROUTINE') {
            return normalizedName;
        }

        return '';
    }

    function getRenderableLists(lists = appState.lists) {
        const renderedBuiltIns = new Set();
        return lists.filter((list) => {
            const builtInListKey = getBuiltInListKey(list);
            if (!builtInListKey) {
                return true;
            }

            if (renderedBuiltIns.has(builtInListKey)) {
                return false;
            }

            renderedBuiltIns.add(builtInListKey);
            return true;
        });
    }

    function findListById(listId) {
        return appState.lists.find((candidate) => candidate.id === listId) || null;
    }

    function isTodayList(listOrId) {
        const list = typeof listOrId === 'string' ? findListById(listOrId) : listOrId;
        return getBuiltInListKey(list) === 'TODAY';
    }

    function isRoutineList(listOrId) {
        const list = typeof listOrId === 'string' ? findListById(listOrId) : listOrId;
        return getBuiltInListKey(list) === 'ROUTINE';
    }

    // Routine tasks and Today-native tasks are dateless by design (implicitly
    // "today"), so their rows and entry forms never offer a date.
    function listForbidsDates(listOrId) {
        return isTodayList(listOrId) || isTomorrowList(listOrId) || isRoutineList(listOrId);
    }

    function getNextTodayPosition(index) {
        return (index + 1) * POSITION_STEP;
    }

    // Compute the writes that reorder a subset of a list's tasks so their
    // relative order matches `orderedTaskIds`, reusing only the slots those
    // tasks already occupy in `field` ('position' or 'todayPosition'). Tasks
    // outside the subset keep their slots, so unrelated tasks — and tasks
    // from other lists — stay put. Returns updateTasksBatch entries; callers
    // combine them into a single batch so the board re-renders exactly once.
    function computeSubsetReorderUpdates(listId, orderedTaskIds, field) {
        const list = findListById(listId);
        if (!list) {
            return [];
        }

        const subset = orderedTaskIds
            .map((taskId) => list.tasks.find((task) => task.id === taskId))
            .filter(Boolean);
        if (subset.length < 2) {
            return [];
        }

        const slots = subset
            .map((task) => normalizePosition(task[field]))
            .filter((value) => value !== null)
            .sort((left, right) => left - right);
        const useSequentialFallback = slots.length !== subset.length;

        const updates = [];
        subset.forEach((task, index) => {
            const nextValue = useSequentialFallback ? (index + 1) * POSITION_STEP : slots[index];
            if (normalizePosition(task[field]) !== nextValue) {
                updates.push({ listId, taskId: task.id, updates: { [field]: nextValue } });
            }
        });
        return updates;
    }

    // Today -> source lists: after Today is rearranged, rewrite each source
    // list's order to match. Overdue tasks are pinned to the top of Today
    // regardless of list order, so they are left out of the mirror to avoid
    // dragging them to the top of their home list too.
    function computeHomeListOrderUpdatesFromToday(orderedEntries) {
        const todayIso = getTodayIso();
        const orderByList = new Map();

        for (const entry of orderedEntries) {
            const listId = entry?.list?.id;
            const task = entry?.task;
            if (!listId || !task || isTodayList(listId)) {
                continue;
            }
            if (Boolean(task.date) && task.date < todayIso) {
                continue;
            }
            if (!orderByList.has(listId)) {
                orderByList.set(listId, []);
            }
            orderByList.get(listId).push(task.id);
        }

        const updates = [];
        for (const [listId, taskIds] of orderByList) {
            updates.push(...computeSubsetReorderUpdates(listId, taskIds, 'position'));
        }
        return updates;
    }

    // Source list -> Today: after a list is reordered, rewrite the Today
    // placement of that list's due-today tasks to match, reusing the Today
    // slots they already hold so tasks from other lists keep their spots.
    // Tasks not yet placed in Today need no update — they already follow their
    // home-list order via the Today comparator.
    async function syncTodayOrderFromHomeList(listId) {
        const list = findListById(listId);
        if (!list || isTodayList(listId)) {
            return { ok: true, skipped: true };
        }

        const todayIso = getTodayIso();
        // Routine tasks are dateless but live in every day's Today.
        const belongsToToday = isRoutineList(list)
            ? (task) => !task.date
            : (task) => task.date === todayIso;
        const placedTodayTaskIds = sortTasksForDisplay(list.tasks)
            .filter((task) => belongsToToday(task) && normalizePosition(task.todayPosition) !== null)
            .map((task) => task.id);

        if (placedTodayTaskIds.length < 2) {
            return { ok: true, skipped: true };
        }

        const updates = computeSubsetReorderUpdates(listId, placedTodayTaskIds, 'todayPosition');
        if (updates.length === 0) {
            return { ok: true, skipped: true };
        }

        return store.updateTasksBatch(updates);
    }

    // Routine column drag: persist the new order of the not-yet-done tasks,
    // reusing only the position slots they already hold so done-for-today
    // rows (sunk visually, not structurally) keep their place for tomorrow.
    // Dragging a done row changes nothing and snaps back on render.
    async function reorderRoutineColumnFromDom(container, listId) {
        const list = findListById(listId);
        if (!list) {
            return { ok: false };
        }

        const todayIso = getTodayIso();
        const orderedPendingIds = [...container.querySelectorAll('.task-item')]
            .map((element) => list.tasks.find((task) => task.id === element.dataset.taskId))
            .filter((task) => task && !isTaskCompletedOn(task, todayIso))
            .map((task) => task.id);

        const updates = computeSubsetReorderUpdates(listId, orderedPendingIds, 'position');
        if (updates.length === 0) {
            return { ok: true, skipped: true };
        }

        const result = await store.updateTasksBatch(updates);
        if (!result?.ok) {
            return result;
        }

        // Same reverse sync regular lists get: mirror the new order into any
        // Today placements these tasks already hold.
        return syncTodayOrderFromHomeList(listId);
    }

    function sortBuiltInTasksForDisplay(tasks, builtInListKey, builtInListId) {
        if (builtInListKey === 'TODAY') {
            return sortTodayTasksForDisplay(tasks, builtInListId, getTodayIso());
        }
        if (builtInListKey === 'TOMORROW') {
            return sortTomorrowTasksForDisplay(tasks);
        }
        if (builtInListKey === 'UPCOMING') {
            return sortUpcomingTasksForDisplay(tasks);
        }
        if (builtInListKey === 'ROUTINE') {
            return sortRoutineTasksForDisplay(tasks, getTodayIso());
        }
        return sortTasksForDisplay(tasks);
    }

    function getDisplayList(found) {
        const builtInListKey = getBuiltInListKey(found);
        if (!builtInListKey) {
            return found;
        }

        const todayIso = getTodayIso();
        const tomorrowIso = getTomorrowIso();
        const aggregatedTasks = [];
        const builtInListIndex = appState.lists.findIndex((list) => list.id === found.id);

        found.tasks.forEach((task) => {
            let includeOwnTask = true;
            if (builtInListKey === 'UPCOMING') {
                includeOwnTask = Boolean(task.date) && task.date > todayIso && !isTaskCompleted(task);
            } else if (builtInListKey === 'TOMORROW') {
                includeOwnTask = (!task.date || task.date === tomorrowIso);
            }

            if (includeOwnTask) {
                aggregatedTasks.push({
                    ...task,
                    _originListId: found.id,
                    _originListIndex: builtInListIndex,
                    ...(builtInListKey === 'TODAY' ? { _doneInToday: isTaskCompleted(task) } : {})
                });
            }
        });

        // Routine shows only its own tasks; Today, Tomorrow, and Upcoming aggregate.
        if (builtInListKey !== 'ROUTINE') {
            appState.lists.forEach((list, listIndex) => {
                if (list.id === found.id) {
                    return;
                }
                const isRoutineSource = isRoutineList(list);
                list.tasks.forEach((task) => {
                    if (builtInListKey === 'TODAY') {
                        const isMatch = isRoutineSource || (Boolean(task.date) && task.date <= todayIso);
                        if (isMatch) {
                            aggregatedTasks.push({
                                ...task,
                                _originListId: list.id,
                                _originListIndex: listIndex,
                                _listName: list.name,
                                _doneInToday: isRoutineSource
                                    ? isTaskCompletedOn(task, todayIso)
                                    : isTaskCompleted(task)
                            });
                        }
                        return;
                    }

                    if (builtInListKey === 'TOMORROW') {
                        const isMatch = !isRoutineSource && Boolean(task.date) && task.date === tomorrowIso;
                        if (isMatch) {
                            aggregatedTasks.push({
                                ...task,
                                _originListId: list.id,
                                _originListIndex: listIndex,
                                _listName: list.name
                            });
                        }
                        return;
                    }

                    const isMatch = !isRoutineSource && Boolean(task.date) && task.date > todayIso && !isTaskCompleted(task);
                    if (isMatch) {
                        aggregatedTasks.push({ ...task, _originListId: list.id, _originListIndex: listIndex, _listName: list.name });
                    }
                });
            });
        }

        return {
            ...found,
            tasks: sortBuiltInTasksForDisplay(aggregatedTasks, builtInListKey, found.id),
            _isVirtual: true
        };
    }

    function findTaskLocation(taskId, preferredListId = null) {
        if (!taskId || taskId === 'new') {
            return null;
        }

        const preferredList = preferredListId
            ? appState.lists.find((candidate) => candidate.id === preferredListId)
            : null;
        const preferredTask = preferredList?.tasks.find((candidate) => candidate.id === taskId);
        if (preferredList && preferredTask) {
            return { listId: preferredList.id, task: preferredTask };
        }

        for (const list of appState.lists) {
            if (list.id === preferredListId) {
                continue;
            }

            const task = list.tasks.find((candidate) => candidate.id === taskId);
            if (task) {
                return { listId: list.id, task };
            }
        }

        return null;
    }

    function suppressListInteractions(durationMs = 180) {
        suppressListInteractionsUntil = Date.now() + durationMs;
    }

    function shouldSuppressListInteractions() {
        return isDraggingList || Date.now() < suppressListInteractionsUntil;
    }

    function endListDrag({ suppressDurationMs = 180 } = {}) {
        isDraggingList = false;
        if (suppressDurationMs > 0) {
            suppressListInteractions(suppressDurationMs);
        }
        flushPendingRender();
    }

    function suppressTaskInteractions(durationMs = 180) {
        suppressTaskInteractionsUntil = Date.now() + durationMs;
    }

    function shouldSuppressTaskInteractions() {
        return isDraggingTask || Date.now() < suppressTaskInteractionsUntil;
    }

    function endTaskDrag({ suppressDurationMs = 180 } = {}) {
        isDraggingTask = false;
        document.body.classList.remove('task-drag-active');
        $$('.task-drag-active-list').forEach((element) => {
            element.classList.remove('task-drag-active-list');
        });
        if (suppressDurationMs > 0) {
            suppressTaskInteractions(suppressDurationMs);
        }
        flushPendingRender();
    }

    // Keyed reconciliation: reuse the nodes already in `container` (matched by
    // dataset.key), create only what's new, drop only what's gone, and keep
    // DOM order in step with `descriptors`. Reused nodes keep their identity,
    // so scroll positions, focus, event listeners, and in-flight CSS
    // transitions all survive a render.
    function reconcileChildren(container, descriptors) {
        const byKey = new Map();
        for (const child of [...container.children]) {
            if (child.dataset && child.dataset.key) {
                byKey.set(child.dataset.key, child);
            }
        }

        let cursor = container.firstChild;
        for (const descriptor of descriptors) {
            let node = byKey.get(descriptor.key);
            if (node) {
                byKey.delete(descriptor.key);
            } else {
                node = descriptor.create();
                node.dataset.key = descriptor.key;
            }
            descriptor.patch(node);

            if (node === cursor) {
                cursor = cursor.nextSibling;
            } else {
                container.insertBefore(node, cursor);
            }
        }

        for (const [, stale] of byKey) {
            stale.__cleanup?.();
            stale.remove();
        }
    }

    function isListDoneTask(list, task, todayIso) {
        if (task._doneInToday !== undefined) {
            return task._doneInToday;
        }
        return isRoutineList(list)
            ? isTaskCompletedOn(task, todayIso)
            : isTaskCompleted(task);
    }

    function createSidebarItem() {
        const listElement = document.createElement('div');
        listElement.className = 'list-item';
        listElement.innerHTML = `
            <span class="list-item-name"></span>
            <span class="list-item-count"></span>
            <div class="list-drag-handle" aria-label="Drag to reorder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                    <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                </svg>
            </div>
        `;
        $('.list-drag-handle', listElement).addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        listElement.addEventListener('click', () => {
            if (shouldSuppressListInteractions()) {
                return;
            }
            store.setActiveView(listElement.dataset.listId);
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
        return listElement;
    }

    function ensureSidebarSortable() {
        if (sortableInstance || !window.Sortable) {
            return;
        }
        sortableInstance = new window.Sortable(listsContainer, {
            animation: 150,
            delay: 150,
            delayOnTouchOnly: true,
            handle: '.list-drag-handle',
            ghostClass: 'sortable-ghost',
            onStart: () => {
                isDraggingList = true;
            },
            onEnd: async (event) => {
                endListDrag();
                if (event.oldIndex !== event.newIndex && event.item) {
                    const listId = event.item.dataset.listId;
                    if (listId) {
                        await store.moveList(listId, event.newIndex);
                    }
                }
            }
        });
    }

    function renderSidebarLists() {
        const todayIso = getTodayIso();
        const descriptors = getRenderableLists().map((list) => ({
            key: `list:${list.id}`,
            create: createSidebarItem,
            patch: (node) => {
                node.dataset.listId = list.id;
                node.classList.toggle('active', appState.activeView === list.id);
                const nameEl = $('.list-item-name', node);
                if (nameEl.textContent !== list.name) {
                    nameEl.textContent = list.name;
                }
                // Count what's still pending: completed one-offs and routines
                // done today drop out of the badge.
                const activeCount = getDisplayList(list).tasks
                    .filter((task) => !isListDoneTask(list, task, todayIso)).length;
                const countText = String(activeCount || '');
                const countEl = $('.list-item-count', node);
                if (countEl.textContent !== countText) {
                    countEl.textContent = countText;
                }
            }
        }));

        reconcileChildren(listsContainer, descriptors);
        ensureSidebarSortable();
    }

    // =================== ROUTINE HEATMAP ===================
    // GitHub-style grid at the bottom of the sidebar: one cell per local
    // day, columns are weeks (Sunday-first), shade = fraction of that day's
    // routine tasks completed. Each day's row snapshots its own denominator
    // (store.captureRoutineDaySnapshot), so old cells stay honest when
    // routines are added or removed later. Displays the last quarter — the
    // widest window whose cells still render big and even in the sidebar —
    // while the store keeps a full year, so the window can widen later.
    const HEATMAP_WEEKS = 13;
    function renderRoutineHeatmap() {
        if (!routineHeatmap) {
            return;
        }

        const hasRoutineList = appState.lists.some((list) => getBuiltInListKey(list) === 'ROUTINE');
        routineHeatmap.classList.toggle('hidden', !hasRoutineList);
        if (!hasRoutineList) {
            return;
        }

        const todayIso = getTodayIso();
        const days = store.getRoutineHeatmapDays();

        // The day window only shifts at midnight; rebuild the cell skeleton
        // then, patch shades in place otherwise.
        if (heatmapGrid.dataset.window !== todayIso) {
            heatmapGrid.dataset.window = todayIso;
            heatmapGrid.innerHTML = '';
            const end = new Date(`${todayIso}T00:00:00`);
            const start = new Date(end);
            // Sunday of the current week, then back the remaining weeks:
            // exactly HEATMAP_WEEKS columns, the last one ending today.
            start.setDate(start.getDate() - start.getDay() - (HEATMAP_WEEKS - 1) * 7);
            for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
                const cell = document.createElement('div');
                cell.className = 'heatmap-cell';
                cell.dataset.day = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
                heatmapGrid.appendChild(cell);
            }
        }

        let todayEntry = null;
        for (const cell of heatmapGrid.children) {
            const entry = days[cell.dataset.day];
            let level = 0;
            if (entry && entry.total > 0 && entry.completed > 0) {
                level = Math.min(4, Math.ceil((entry.completed / entry.total) * 4));
            }
            const levelValue = String(level);
            if (cell.dataset.level !== levelValue) {
                cell.dataset.level = levelValue;
            }
            const title = entry
                ? `${formatDate(cell.dataset.day)} — ${entry.completed}/${entry.total} routines`
                : `${formatDate(cell.dataset.day)} — no data`;
            if (cell.title !== title) {
                cell.title = title;
            }
            if (cell.dataset.day === todayIso) {
                todayEntry = entry || null;
            }
        }

        const subText = todayEntry && todayEntry.total > 0
            ? `${todayEntry.completed}/${todayEntry.total} today`
            : '';
        if (heatmapSub.textContent !== subText) {
            heatmapSub.textContent = subText;
        }
    }

    function renderBoard() {
        const isMobile = window.innerWidth <= 768;
        let scrollIndex = 0;
        if (isMobile && board.clientWidth > 0) {
            scrollIndex = Math.round(board.scrollLeft / board.clientWidth);
        }

        const renderableLists = getRenderableLists();
        const activeView = appState.activeView === 'all' || renderableLists.some((list) => list.id === appState.activeView)
            ? appState.activeView
            : 'all';

        let listsToShow = [];
        if (activeView === 'all') {
            listsToShow = renderableLists.map((list) => getDisplayList(list));
        } else {
            const found = renderableLists.find((list) => list.id === activeView);
            if (found) {
                listsToShow = [getDisplayList(found)];
            }
        }

        document.body.classList.toggle(
            'mobile-single-list-view',
            isMobile && activeView !== 'all' && listsToShow.length === 1
        );

        // Keyed column reconcile: existing columns (and their scroll
        // positions, sortable instances, and in-flight animations) survive.
        const descriptors = listsToShow.map((display) => ({
            key: `column:${display.id}`,
            create: () => createColumnShell(display),
            patch: (node) => reconcileColumn(node, display)
        }));
        reconcileChildren(board, descriptors);

        if (isMobile) {
            if (listsToShow.length === 0) {
                mobileTabs.innerHTML = '';
                return;
            }
            if (scrollIndex > 0 && scrollIndex < listsToShow.length) {
                board.scrollLeft = scrollIndex * board.clientWidth;
            }
            renderMobileTabs(listsToShow);
        }
    }

    function renderMobileTabs(lists) {
        mobileTabs.innerHTML = '';
        if (lists.length <= 1 && appState.activeView !== 'all') {
            mobileTabs.style.display = 'none';
            return;
        }

        mobileTabs.style.display = 'flex';

        lists.forEach((list, index) => {
            const tab = document.createElement('div');
            tab.className = `mobile-tab-item${index === 0 ? ' active' : ''}`;
            tab.dataset.index = String(index);
            tab.textContent = list.name;

            let pressTimer = null;
            const start = (event) => {
                if (event.type === 'mousedown' && event.button !== 0) {
                    return;
                }

                pressTimer = setTimeout(() => {
                    const rect = tab.getBoundingClientRect();
                    showColumnMenu({
                        clientX: rect.left + rect.width / 2,
                        clientY: rect.bottom + 10,
                        stopPropagation() { }
                    }, list.id);

                    if (window.navigator.vibrate) {
                        window.navigator.vibrate(50);
                    }
                }, 600);
            };

            const cancel = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            tab.addEventListener('mousedown', start);
            tab.addEventListener('touchstart', start, { passive: true });
            tab.addEventListener('click', (event) => {
                cancel();
                if (event.detail === 0) {
                    return;
                }
                board.scrollTo({ left: index * board.clientWidth, behavior: 'smooth' });
            });
            tab.addEventListener('mouseleave', cancel);
            tab.addEventListener('touchend', cancel);
            tab.addEventListener('touchmove', cancel);

            mobileTabs.appendChild(tab);
        });

        board.onscroll = () => {
            const activeIndex = Math.round(board.scrollLeft / board.clientWidth) || 0;
            $$('.mobile-tab-item').forEach((tab, index) => tab.classList.toggle('active', index === activeIndex));

            const activeTab = $$('.mobile-tab-item')[activeIndex];
            if (activeTab) {
                const offset = activeTab.offsetLeft - (mobileTabs.clientWidth / 2) + (activeTab.clientWidth / 2);
                mobileTabs.scrollTo({ left: offset, behavior: 'smooth' });
            }
        };

        setTimeout(() => {
            const activeIndex = Math.round(board.scrollLeft / board.clientWidth) || 0;
            $$('.mobile-tab-item').forEach((tab, index) => tab.classList.toggle('active', index === activeIndex));
        }, 50);
    }

    function createColumnShell(display) {
        const column = document.createElement('div');
        column.className = 'column';
        column.dataset.listId = display.id;
        const builtInListKey = getBuiltInListKey(display);
        const canManageList = !builtInListKey;

        const header = document.createElement('div');
        header.className = 'column-header';
        header.innerHTML = `
            <span class="column-title"></span>
            ${canManageList ? `
                <button class="column-menu-btn" aria-label="List menu">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                </button>
            ` : ''}
        `;
        header.querySelector('.column-menu-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            showColumnMenu(event, column.dataset.listId);
        });
        column.appendChild(header);

        if (builtInListKey !== 'UPCOMING') {
            const addRow = document.createElement('div');
            addRow.className = 'add-task-row';
            addRow.innerHTML = `
                <span class="add-task-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>
                <span class="add-task-text">Add a task</span>
            `;
            addRow.addEventListener('click', () => showAddTaskInput(column, column.dataset.listId, addRow));
            column.appendChild(addRow);
        }

        const taskListElement = document.createElement('div');
        taskListElement.className = 'task-list';
        column.appendChild(taskListElement);
        setupTaskSortable(taskListElement, display);
        column.__cleanup = () => {
            if (taskListElement.__sortable) {
                taskListElement.__sortable.destroy();
                taskListElement.__sortable = null;
            }
        };
        return column;
    }

    function reconcileColumn(column, display) {
        const titleEl = column.querySelector('.column-title');
        if (titleEl.textContent !== display.name) {
            titleEl.textContent = display.name;
        }
        reconcileChildren(column.querySelector('.task-list'), buildTaskListDescriptors(display));
    }

    function createDateLabel() {
        const label = document.createElement('div');
        label.className = 'task-date-label';
        label.addEventListener('click', (event) => {
            if (label.dataset.labelType !== 'date') {
                return;
            }
            event.stopPropagation();
            openCustomCalendar(label.dataset.labelListId, label.dataset.labelTaskId);
        });
        return label;
    }

    function patchDateLabel(label, meta) {
        const { type, displayDate = '', labelListId = '', labelTaskId = '' } = meta;
        label.dataset.labelType = type;
        label.dataset.labelListId = labelListId;
        label.dataset.labelTaskId = labelTaskId;
        if (type === 'date' || type === 'today' || type === 'overdue') {
            label.dataset.dateGroup = displayDate;
        } else {
            delete label.dataset.dateGroup;
        }

        // Relative meta ("2 DAYS LEFT") shifts as today moves, so it is part
        // of the signature that decides whether content needs a rebuild.
        const signature = `${type}|${displayDate}|${type === 'date' ? getTodayIso() : ''}`;
        if (label.dataset.signature === signature) {
            return;
        }
        label.dataset.signature = signature;
        label.classList.toggle('overdue', type === 'overdue');
        label.classList.toggle('clickable', type === 'date');
        label.classList.toggle('done-label', type === 'done');
        if (type === 'overdue') {
            label.innerHTML = `
                <span class="date-label-main">
                    ${icon('alert', 14)}
                    Overdue
                </span>
                <span class="date-label-meta">${formatDate(displayDate)}</span>
            `;
        } else if (type === 'today') {
            label.innerHTML = `
                <span class="date-label-main">
                    ${icon('calendar', 14)}
                    ${formatDate(displayDate)}
                </span>
            `;
        } else if (type === 'date') {
            label.innerHTML = `
                <span class="date-label-main">
                    ${icon('calendar', 14)}
                    ${formatDate(displayDate)}
                </span>
                <span class="date-label-meta">${getRelativeDate(displayDate)}</span>
            `;
        } else if (type === 'nodate') {
            label.textContent = 'NO DATE';
        } else {
            label.textContent = 'COMPLETED';
        }
    }

    function buildTaskListDescriptors(display) {
        const builtInListKey = getBuiltInListKey(display);
        const isTodayColumn = builtInListKey === 'TODAY';
        const isTomorrowColumn = builtInListKey === 'TOMORROW';
        const isRoutineColumn = builtInListKey === 'ROUTINE';
        const todayIso = getTodayIso();
        const columnListId = display.id;
        const showListName = Boolean(display._isVirtual);

        // Routine done-ness is day-scoped; everywhere else any completion
        // stamp counts (one-offs linger struck until the day's reaper pass).
        // Today's aggregate pre-computes the verdict per task (_doneInToday),
        // since it mixes routine and one-off sources.
        const isDone = (task) => {
            if (task._doneInToday !== undefined) {
                return task._doneInToday;
            }
            return isRoutineColumn
                ? isTaskCompletedOn(task, todayIso)
                : isTaskCompleted(task);
        };
        const pendingTasks = display.tasks.filter((task) => !isDone(task));
        const doneTasks = display.tasks.filter(isDone);

        const isOverdueTodayTask = (task) => isTodayColumn && Boolean(task.date) && task.date < todayIso;
        // In Today, overdue tasks keep their real (past) date so the section
        // header can show it, instead of being relabeled as today.
        const tomorrowIso = getTomorrowIso();
        const getDisplayDate = (task) => {
            if (isTodayColumn) {
                return isOverdueTodayTask(task) ? task.date : todayIso;
            }
            if (isTomorrowColumn) {
                return tomorrowIso;
            }
            return task.date;
        };

        const descriptors = [];
        const pushTask = (task, done) => {
            const actualListId = task._originListId || columnListId;
            descriptors.push({
                key: `task:${task.id}`,
                create: createTaskRow,
                patch: (node) => patchTaskRow(node, task, {
                    columnListId,
                    actualListId,
                    showListName,
                    done,
                    // Completed tasks stay in Today (sunk in its COMPLETED
                    // section) alongside their home copy; only Upcoming is
                    // strictly pending, so only there does a completion make
                    // the row exit the view.
                    rowLeavesView: (builtInListKey === 'UPCOMING' || builtInListKey === 'TOMORROW') && actualListId !== columnListId
                })
            });
        };

        const datedTasks = pendingTasks.filter((task) => Boolean(getDisplayDate(task)));
        const undatedTasks = (isTodayColumn || isTomorrowColumn) ? [] : pendingTasks.filter((task) => !task.date);

        let lastDate = null;
        datedTasks.forEach((task) => {
            const displayDate = getDisplayDate(task);
            if (displayDate !== lastDate) {
                lastDate = displayDate;
                const isOverdueGroup = isTodayColumn && displayDate < todayIso;
                descriptors.push({
                    key: `label:${displayDate}`,
                    create: createDateLabel,
                    patch: (node) => patchDateLabel(node, {
                        type: isOverdueGroup ? 'overdue' : (isTodayColumn ? 'today' : 'date'),
                        displayDate,
                        labelListId: task._originListId || columnListId,
                        labelTaskId: task.id
                    })
                });
            }
            pushTask(task, false);
        });

        if (undatedTasks.length > 0) {
            // Routine tasks are all dateless — a NO DATE header would just
            // restate the whole column.
            if (!isRoutineColumn) {
                descriptors.push({
                    key: 'label:nodate',
                    create: createDateLabel,
                    patch: (node) => patchDateLabel(node, { type: 'nodate' })
                });
            }
            undatedTasks.forEach((task) => pushTask(task, false));
        }

        if (doneTasks.length > 0) {
            descriptors.push({
                key: 'label:done',
                create: createDateLabel,
                patch: (node) => patchDateLabel(node, { type: 'done' })
            });
            doneTasks.forEach((task) => pushTask(task, true));
        }

        return descriptors;
    }

    function getTaskElementIndex(container, taskId) {
        return [...container.querySelectorAll('.task-item:not(.task-done)')]
            .findIndex((element) => element.dataset.taskId === taskId);
    }

    function getTaskDateGroup(element) {
        let current = element?.previousElementSibling || null;
        while (current) {
            if (current.dataset.dateGroup) {
                return current.dataset.dateGroup;
            }
            current = current.previousElementSibling;
        }

        return '';
    }

    function getPositionValue(task, fallbackIndex) {
        const position = normalizePosition(task?.position);
        if (position !== null) {
            return position;
        }

        return (fallbackIndex + 1) * POSITION_STEP;
    }

    function getPositionBetweenEntries(entries, movedIndex) {
        const previousEntry = movedIndex > 0 ? entries[movedIndex - 1] : null;
        const nextEntry = movedIndex < entries.length - 1 ? entries[movedIndex + 1] : null;

        if (!previousEntry && !nextEntry) {
            return null;
        }

        if (!previousEntry) {
            return getPositionValue(nextEntry.task, 0) - POSITION_STEP;
        }

        if (!nextEntry) {
            return getPositionValue(previousEntry.task, entries.length - 2) + POSITION_STEP;
        }

        const previousPosition = getPositionValue(previousEntry.task, movedIndex - 1);
        const nextPosition = getPositionValue(nextEntry.task, movedIndex + 1);
        if (previousPosition >= nextPosition) {
            return null;
        }

        return (previousPosition + nextPosition) / 2;
    }

    async function moveTaskFromBuiltInView(taskId, sourceListId, container, { dateBound = false, persistManualOrder = false } = {}) {
        const sourceList = findListById(sourceListId);
        if (!sourceList) {
            render();
            return { ok: false };
        }

        const sourceTask = sourceList.tasks.find((task) => task.id === taskId);
        const movedElement = [...container.querySelectorAll('.task-item:not(.task-done)')]
            .find((element) => element.dataset.taskId === taskId);
        const dateGroup = getTaskDateGroup(movedElement);
        const taskDate = sourceTask?.date || movedElement?.dataset.taskDate || '';
        if (!sourceTask || !movedElement) {
            render();
            return { ok: false };
        }

        if (!dateGroup || (dateBound && (!taskDate || dateGroup !== taskDate))) {
            render();
            return { ok: true, skipped: true };
        }

        // Done rows live under the COMPLETED label (no date group of its own);
        // walking previous siblings from one would land on a real date label,
        // so exclude them outright — they don't participate in ordering.
        const dateGroupElements = [...container.querySelectorAll('.task-item:not(.task-done)')]
            .filter((element) => getTaskDateGroup(element) === dateGroup);
        if (dateGroupElements.length < 2) {
            render();
            return { ok: true, skipped: true };
        }

        const dateGroupEntries = [];
        for (const element of dateGroupElements) {
            const list = findListById(element.dataset.sourceListId);
            const task = list?.tasks.find((candidate) => candidate.id === element.dataset.taskId);
            if (!list || !task) {
                render();
                return { ok: false };
            }

            dateGroupEntries.push({ list, task });
        }

        const movedIndex = dateGroupEntries.findIndex((entry) => entry.task.id === taskId);
        if (movedIndex === -1) {
            render();
            return { ok: false };
        }

        if (persistManualOrder) {
            const batchedUpdates = [];
            dateGroupEntries.forEach((entry, index) => {
                const todayPosition = getNextTodayPosition(index);
                if (normalizePosition(entry.task.todayPosition) !== todayPosition) {
                    batchedUpdates.push({ listId: entry.list.id, taskId: entry.task.id, updates: { todayPosition } });
                }
            });

            // Mirror the new Today order back into each source list, so dragging
            // inside Today reorders the list the task came from. One batch with
            // the placements above: a single render, parallel writes.
            batchedUpdates.push(...computeHomeListOrderUpdatesFromToday(dateGroupEntries));

            if (batchedUpdates.length === 0) {
                render();
                return { ok: true, skipped: true };
            }

            const result = await store.updateTasksBatch(batchedUpdates);
            if (!result?.ok) {
                render();
            }
            return result;
        }

        const nextPosition = getPositionBetweenEntries(dateGroupEntries, movedIndex);
        if (nextPosition !== null) {
            if (normalizePosition(sourceTask.position) !== nextPosition) {
                return store.updateTask(sourceListId, taskId, { position: nextPosition });
            }

            render();
            return { ok: true, skipped: true };
        }

        const rebalanceUpdates = [];
        for (const [index, entry] of dateGroupEntries.entries()) {
            const rebalancedPosition = (index + 1) * POSITION_STEP;
            if (normalizePosition(entry.task.position) !== rebalancedPosition) {
                rebalanceUpdates.push({
                    listId: entry.list.id,
                    taskId: entry.task.id,
                    updates: { position: rebalancedPosition }
                });
            }
        }

        if (rebalanceUpdates.length === 0) {
            render();
            return { ok: true, skipped: true };
        }

        const rebalanceResult = await store.updateTasksBatch(rebalanceUpdates);
        if (!rebalanceResult?.ok) {
            render();
        }
        return rebalanceResult;
    }

    function setupTaskSortable(container, list) {
        container.dataset.listId = list.id;
        const builtInListKey = getBuiltInListKey(list);
        if (list._isVirtual && builtInListKey) {
            container.dataset.virtualListKey = builtInListKey;
        } else {
            delete container.dataset.virtualListKey;
        }

        const canSortVirtualList = list._isVirtual
            && (builtInListKey === 'TODAY' || builtInListKey === 'TOMORROW' || builtInListKey === 'UPCOMING' || builtInListKey === 'ROUTINE');
        if (!window.Sortable || (list._isVirtual && !canSortVirtualList)) {
            container.classList.remove('task-list-sortable');
            return;
        }

        container.classList.add('task-list-sortable');
        // Columns persist across renders now, so the instance is created once
        // per column and lives as long as the column does.
        if (container.__sortable) {
            return;
        }
        const useFallbackDrag = window.innerWidth <= 768;
        const dragDelay = useFallbackDrag ? 120 : 150;
        const dragTolerance = useFallbackDrag ? 7 : 4;
        const taskDragAnimation = useFallbackDrag ? 90 : 150;
        const sortableGroupName = canSortVirtualList
            ? `${builtInListKey.toLowerCase()}-tasks`
            : `tasks-${list.id}`;
        const sortableGroup = { name: sortableGroupName, pull: false, put: false };
        const instance = new window.Sortable(container, {
            animation: taskDragAnimation,
            delay: dragDelay,
            delayOnTouchOnly: true,
            // Done rows sit in the COMPLETED section and are not drag
            // targets; excluding them keeps drop indexes aligned with the
            // pending-only index math in store.moveTask.
            draggable: '.task-item:not(.task-done)',
            easing: 'cubic-bezier(.16, 1, .3, 1)',
            filter: '.task-checkbox, .task-menu-btn, .task-date-btn, .task-inline-input, input, button',
            fallbackOnBody: useFallbackDrag,
            fallbackClass: 'task-sortable-fallback',
            fallbackTolerance: dragTolerance,
            forceFallback: useFallbackDrag,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            group: sortableGroup,
            preventOnFilter: false,
            scrollSensitivity: useFallbackDrag ? 48 : 30,
            scrollSpeed: useFallbackDrag ? 14 : 10,
            touchStartThreshold: useFallbackDrag ? 10 : 1,
            onStart: () => {
                isDraggingTask = true;
                document.body.classList.add('task-drag-active');
                container.classList.add('task-drag-active-list');
                closeAllMenus();
            },
            onEnd: async (event) => {
                const taskId = event.item?.dataset.taskId;
                const fromListId = event.item?.dataset.sourceListId || event.from?.dataset.listId;
                const toListId = event.to?.dataset.listId;
                const virtualListKey = event.to?.dataset.virtualListKey || '';
                const newIndex = Number.isInteger(event.newDraggableIndex)
                    ? event.newDraggableIndex
                    : getTaskElementIndex(event.to, taskId);

                endTaskDrag();

                if (!taskId || !fromListId || !toListId || newIndex < 0) {
                    render();
                    return;
                }

                if (event.oldDraggableIndex === newIndex) {
                    return;
                }

                if (virtualListKey === 'ROUTINE') {
                    const result = await reorderRoutineColumnFromDom(event.to, toListId);
                    if (!result?.ok || result.skipped) {
                        render();
                    }
                    return;
                }

                if (virtualListKey === 'TODAY' || virtualListKey === 'TOMORROW' || virtualListKey === 'UPCOMING') {
                    const result = await moveTaskFromBuiltInView(taskId, fromListId, event.to, {
                        dateBound: virtualListKey === 'UPCOMING' || virtualListKey === 'TOMORROW',
                        persistManualOrder: virtualListKey === 'TODAY'
                    });
                    if (!result?.ok || result.skipped) {
                        render();
                    }
                    return;
                }

                if (fromListId !== toListId) {
                    render();
                    return;
                }

                const result = await store.moveTask(taskId, fromListId, toListId, newIndex);
                if (!result?.ok) {
                    render();
                    return;
                }

                // Mirror the list's new order into Today, so reordering a list
                // also reorders its tasks that show in Today (the reverse sync).
                const todaySyncResult = await syncTodayOrderFromHomeList(toListId);
                if (!todaySyncResult?.ok) {
                    render();
                }
            }
        });

        container.__sortable = instance;
    }

    // Draw an exact-width strikethrough over each wrapped line of a task's
    // text. Range.getClientRects() returns one rect per visual line, so each
    // line is struck to its true width (no overflow) and centred vertically.
    function drawStrikeLines(textEl) {
        const range = document.createRange();
        range.selectNodeContents(textEl);
        const rects = range.getClientRects();
        const base = textEl.getBoundingClientRect();
        const lines = [];
        Array.from(rects).forEach((rect) => {
            if (rect.width < 1) {
                return;
            }
            const line = document.createElement('span');
            line.className = 'task-strike-line';
            line.style.left = `${rect.left - base.left}px`;
            line.style.top = `${rect.top - base.top + (rect.height / 2) - 1}px`;
            line.style.width = `${rect.width}px`;
            textEl.appendChild(line);
            lines.push(line);
        });
        requestAnimationFrame(() => {
            lines.forEach((line) => line.classList.add('on'));
        });
    }

    // FLIP: run `mutate` (which removes a task and re-renders the board), then
    // glide every surviving row from its old position to its new one using a
    // compositor transform. Animating transform (not height) keeps the tasks
    // below sliding up perfectly smooth, with no layout thrash or render hitch.
    let flipToken = 0;

    function animateTaskRemoval(mutate) {
        // Everything the reconciler keys — task rows AND section labels
        // (COMPLETED, date headers) — moves as one choreography. Labels used
        // to be excluded and teleported while rows glided, which read as the
        // sections jumping first and the tasks limping after.
        const FLIP_TARGETS = '.task-list > [data-key]';
        const before = new Map();
        const beforeColumnHeights = new Map();
        document.querySelectorAll('.column').forEach((column) => {
            const listId = column.dataset.listId || '';
            beforeColumnHeights.set(listId, column.offsetHeight);
            column.querySelectorAll(FLIP_TARGETS).forEach((item) => {
                before.set(`${listId}::${item.dataset.key}`, item.getBoundingClientRect().top);
            });
        });

        mutate(); // synchronous optimistic re-render reconciles the board

        const moved = [];
        const appeared = [];
        const resizedColumns = [];
        document.querySelectorAll('.column').forEach((column) => {
            const listId = column.dataset.listId || '';
            const oldHeight = beforeColumnHeights.get(listId);
            if (oldHeight !== undefined) {
                const newHeight = column.offsetHeight;
                if (Math.abs(oldHeight - newHeight) > 0.5) {
                    resizedColumns.push({ column, oldHeight, newHeight });
                }
            }
            column.querySelectorAll(FLIP_TARGETS).forEach((item) => {
                const key = `${listId}::${item.dataset.key}`;
                if (!before.has(key)) {
                    // Entered this column (e.g. an un-completed task returning
                    // to Today): fade in instead of popping.
                    appeared.push(item);
                    return;
                }
                const delta = before.get(key) - item.getBoundingClientRect().top;
                if (Math.abs(delta) > 0.5) {
                    moved.push({ item, delta });
                }
            });
        });

        if (moved.length === 0 && appeared.length === 0 && resizedColumns.length === 0) {
            return;
        }

        // Overlapping runs: a fresh choreography takes ownership of any
        // element it touches, so an older run's cleanup can't snap it
        // mid-glide (rapid successive ticks used to stutter this way).
        flipToken += 1;
        const token = flipToken;
        const own = (element) => { element.__flipToken = token; };

        // INVERT: snap each moved element back to where it was, and hold each
        // resized column at its old height so the card edge travels with the
        // rows instead of jumping (shrink used to clip the bottom rows; on
        // growth the edge now opens in step with the descending rows). The
        // hold MUST go on .column: its height is the cross axis of the
        // board's row flexbox, where the height property is honored. The
        // inner .task-list is a flex:1 item whose main size comes from
        // flex-basis, so an inline height there is silently ignored (the
        // v1.8.3 mistake). Mobile columns are viewport-height — no resize,
        // natural no-op.
        moved.forEach(({ item, delta }) => {
            own(item);
            item.style.transition = 'none';
            item.style.transform = `translateY(${delta}px)`;
        });
        appeared.forEach((item) => {
            own(item);
            item.style.transition = 'none';
            item.style.opacity = '0';
        });
        resizedColumns.forEach(({ column, oldHeight }) => {
            own(column);
            column.style.transition = 'none';
            column.style.height = `${oldHeight}px`;
        });

        void document.body.offsetHeight; // commit the inverted positions

        // PLAY: glide to the new positions on the compositor. easeOutCubic,
        // not easeOutExpo: expo front-loads ~80% of the travel into the first
        // 90ms, which over a one-row gap reads as an instant snap. Cubic keeps
        // the motion visible through the middle of the run at every distance.
        // Newcomers fade in slightly late so they land into settled space.
        const glide = 'cubic-bezier(.22, .61, .36, 1)';
        moved.forEach(({ item }) => {
            item.style.transition = `transform 500ms ${glide}`;
            item.style.transform = '';
        });
        appeared.forEach((item) => {
            item.style.transition = 'opacity 260ms ease 140ms';
            item.style.opacity = '1';
        });
        resizedColumns.forEach(({ column, newHeight }) => {
            column.style.transition = `height 500ms ${glide}`;
            column.style.height = `${newHeight}px`;
        });

        setTimeout(() => {
            moved.forEach(({ item }) => {
                if (item.__flipToken !== token) {
                    return;
                }
                item.style.transition = '';
                item.style.transform = '';
            });
            appeared.forEach((item) => {
                if (item.__flipToken !== token) {
                    return;
                }
                item.style.transition = '';
                item.style.opacity = '';
            });
            resizedColumns.forEach(({ column }) => {
                if (column.__flipToken !== token) {
                    return;
                }
                column.style.transition = '';
                column.style.height = '';
            });
        }, 520);
    }

    const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';

    // Task rows are created once and patched thereafter (keyed reconcile), so
    // every handler reads the CURRENT task/context from element.__task and
    // element.__ctx — closures over creation-time data would go stale.
    function createTaskRow() {
        const element = document.createElement('div');
        element.className = 'task-item';

        const checkbox = document.createElement('div');
        checkbox.className = 'task-checkbox';
        element.appendChild(checkbox);

        const content = document.createElement('div');
        content.className = 'task-content';
        const textElement = document.createElement('div');
        textElement.className = 'task-text';
        content.appendChild(textElement);
        element.appendChild(content);

        const actions = document.createElement('div');
        actions.className = 'task-actions';

        const dateButton = document.createElement('button');
        dateButton.className = 'task-date-btn';
        dateButton.innerHTML = icon('calendar', 18);
        dateButton.addEventListener('click', (event) => {
            event.stopPropagation();
            openCustomCalendar(element.__ctx.actualListId, element.__task.id);
        });
        actions.appendChild(dateButton);

        const timeButton = document.createElement('button');
        timeButton.className = 'task-time-btn';
        timeButton.innerHTML = icon('clock', 18);
        timeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            openTimeModal(element.__ctx.actualListId, element.__task.id);
        });
        actions.appendChild(timeButton);

        const menuButton = document.createElement('button');
        menuButton.className = 'task-menu-btn';
        menuButton.innerHTML = icon('trash', 18);
        menuButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const { actualListId } = element.__ctx;
            const taskId = element.__task.id;
            showDeleteConfirm(() => store.deleteTask(actualListId, taskId));
        });
        actions.appendChild(menuButton);

        element.appendChild(actions);

        checkbox.addEventListener('click', (event) => {
            event.stopPropagation();
            const task = element.__task;
            const ctx = element.__ctx;
            if (!task || element.dataset.completing) {
                return;
            }

            const { actualListId } = ctx;

            // A completed row's check is a toggle: tap again to take it back.
            if (ctx.done) {
                animateTaskRemoval(() => store.updateTask(actualListId, task.id, { completedAt: '' }));
                return;
            }

            // Completion stamps a timestamp instead of deleting: done rows
            // linger struck-through until midnight (then one-offs get reaped
            // and routines reset to pending). Mis-taps are undone by tapping
            // the done row's check in the COMPLETED section of its home list.
            const stampDone = () => {
                animateTaskRemoval(() => store.updateTask(actualListId, task.id, { completedAt: new Date().toISOString() }));
            };

            element.dataset.completing = '1';
            checkbox.classList.add('checked');
            checkbox.innerHTML = CHECK_SVG;
            // Phase 1: draw an exact-width strikethrough over each line + dim it.
            element.classList.add('completing');
            drawStrikeLines(textElement);

            // Phase 2: once the strike lands, either sink to the COMPLETED
            // section in place, or fade out first when the row is leaving
            // this view; the FLIP glides everything to its new spot.
            setTimeout(() => {
                if (!ctx.rowLeavesView) {
                    stampDone();
                    return;
                }

                const fade = element.animate(
                    [{ opacity: 1 }, { opacity: 0 }],
                    { duration: 240, easing: 'ease', fill: 'forwards' }
                );

                let removed = false;
                const finish = () => {
                    if (removed) {
                        return;
                    }
                    removed = true;
                    stampDone();
                };
                fade.onfinish = finish;
                fade.oncancel = finish;
                setTimeout(finish, 500); // safety fallback
            }, 600);
        });

        let lastTapTime = 0;
        element.addEventListener('click', () => {
            if (shouldSuppressTaskInteractions()) {
                return;
            }

            if (element.querySelector('.task-inline-input')) {
                return;
            }

            const task = element.__task;
            const { actualListId } = element.__ctx;
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                const now = Date.now();
                if (now - lastTapTime < 300) {
                    startInlineEdit(element, textElement, task, actualListId);
                    lastTapTime = 0;
                    return;
                }
                lastTapTime = now;
                if (!element.classList.contains('icons-visible')) {
                    $$('.task-item.icons-visible').forEach(el => el.classList.remove('icons-visible'));
                    element.classList.add('icons-visible');
                }
                return;
            }

            startInlineEdit(element, textElement, task, actualListId);
        });

        return element;
    }

    function patchTaskRow(element, task, ctx) {
        element.__task = task;
        element.__ctx = ctx;

        // A row mid-edit or mid-completion-animation owns its own DOM until
        // the interaction resolves; the reconciler only repositions it.
        if (element.classList.contains('editing') || (element.dataset.completing && !ctx.done)) {
            return;
        }

        element.dataset.taskId = task.id;
        element.dataset.sourceListId = ctx.actualListId;
        element.dataset.taskDate = task.date || '';

        const checkbox = element.querySelector('.task-checkbox');
        const content = element.querySelector('.task-content');
        const textElement = element.querySelector('.task-text');

        if (ctx.done) {
            if (element.dataset.completing) {
                // The completion just landed: retire the transient strike
                // animation state; the persistent done styling takes over.
                delete element.dataset.completing;
                element.classList.remove('completing');
                textElement.textContent = task.text; // drops strike-line spans
            }
            element.classList.add('task-done');
            // no-pop: renders arrive all day (syncs, edits); the check must
            // not replay its landing animation on every patch.
            checkbox.classList.add('checked', 'no-pop');
            if (!checkbox.innerHTML) {
                checkbox.innerHTML = CHECK_SVG;
            }
        } else {
            element.classList.remove('task-done');
            checkbox.classList.remove('checked', 'no-pop');
            if (checkbox.innerHTML) {
                checkbox.innerHTML = '';
            }
        }

        if (textElement.textContent !== task.text && !textElement.querySelector('.task-strike-line')) {
            textElement.textContent = task.text;
        }

        let detailsElement = content.querySelector('.task-details-preview');
        if (task.details) {
            if (!detailsElement) {
                detailsElement = document.createElement('div');
                detailsElement.className = 'task-details-preview';
                textElement.after(detailsElement);
            }
            const preview = task.details.substring(0, 50);
            if (detailsElement.__preview !== preview) {
                detailsElement.__preview = preview;
                detailsElement.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="14" x2="15" y2="14"/></svg> ${escapeHtml(preview)}`;
            }
        } else if (detailsElement) {
            detailsElement.remove();
        }

        let badgeContainer = content.querySelector('.task-badges');
        if (ctx.showListName && task._listName) {
            if (!badgeContainer) {
                badgeContainer = document.createElement('div');
                badgeContainer.className = 'task-badges';
                badgeContainer.innerHTML = '<div class="task-origin-badge"></div>';
                content.appendChild(badgeContainer);
            }
            const badge = badgeContainer.querySelector('.task-origin-badge');
            if (badge.textContent !== task._listName) {
                badge.textContent = task._listName;
            }
        } else if (badgeContainer) {
            badgeContainer.remove();
        }

        // Right-edge timestamp on the title row. Today-native and routine
        // tasks are dateless but implicitly due today, so the chip's urgency
        // ticks against today for them; a done task's chip never turns red.
        let timeBadge = element.querySelector('.task-time-badge');
        if (task.time) {
            if (!timeBadge) {
                timeBadge = document.createElement('div');
                timeBadge.className = 'task-time-badge';
                element.insertBefore(timeBadge, element.querySelector('.task-actions'));
            }
            const implicitlyToday = isTodayList(ctx.actualListId) || isRoutineList(ctx.actualListId);
            const implicitlyTomorrow = isTomorrowList(ctx.actualListId);
            timeBadge.dataset.dueDate = task.date || (implicitlyToday ? getTodayIso() : (implicitlyTomorrow ? getTomorrowIso() : ''));
            timeBadge.dataset.dueTime = task.time;
            if (ctx.done) {
                timeBadge.dataset.done = '1';
            } else {
                delete timeBadge.dataset.done;
            }
            if (timeBadge.__time !== task.time) {
                timeBadge.__time = task.time;
                // Times render in 24-hour format app-wide; stored form is "HH:MM".
                timeBadge.innerHTML = `${icon('clock', 12)}<span>${escapeHtml(task.time)}</span>`;
            }
            applyTimeBadgeUrgency(timeBadge);
        } else if (timeBadge) {
            timeBadge.remove();
        }

        const ownerForbidsDates = isTodayList(ctx.actualListId) || isTomorrowList(ctx.actualListId) || isRoutineList(ctx.actualListId);
        element.querySelector('.task-date-btn').style.display = ownerForbidsDates ? 'none' : '';
        element.querySelector('.task-time-btn').classList.toggle('has-time', Boolean(task.time));
    }

    function startInlineEdit(element, textElement, task, listId) {
        // The action pill floats over the row's right side; during editing it
        // would sit on top of the input and steal cursor-placement taps.
        // Suppress it (and the tap-revealed state) for the whole edit.
        element.classList.remove('icons-visible');
        element.classList.add('editing');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'task-inline-input';
        input.value = task.text;

        textElement.style.display = 'none';
        textElement.parentNode.insertBefore(input, textElement);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);

        let saved = false;
        const saveAndClose = () => {
            if (saved) {
                return;
            }

            saved = true;
            const newText = input.value.trim();
            input.remove();
            textElement.style.display = '';
            element.classList.remove('editing');
            if (newText) {
                textElement.textContent = newText;
            }

            if (newText && newText !== task.text) {
                store.updateTask(listId, task.id, { text: newText });
            } else if (!newText) {
                store.deleteTask(listId, task.id);
            }

            flushPendingRender();
        };

        input.addEventListener('blur', saveAndClose);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveAndClose();
            }
            if (event.key === 'Escape') {
                saved = true;
                input.remove();
                textElement.style.display = '';
                element.classList.remove('editing');
                flushPendingRender();
            }
        });
        input.addEventListener('click', (event) => event.stopPropagation());
    }

    function showAddTaskInput(column, listId, addRow) {
        if (column.querySelector('.add-task-input-row')) {
            return;
        }

        addRow.style.display = 'none';
        const canEditDate = !listForbidsDates(listId);
        let newTaskDate = '';

        const row = document.createElement('div');
        row.className = 'add-task-input-row';
        row.innerHTML = `
            <span class="add-task-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>
            <input class="add-task-input" placeholder="New task" autocomplete="off" autofocus>
            <div class="add-task-date-badge" style="display:none;font-size:11px;padding:4px 8px;background:rgba(255,255,255,0.1);border-radius:12px;color:var(--text2);margin-left:8px;white-space:nowrap;flex-shrink:0;"></div>
            <button class="add-task-cal-btn" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:4px;display:none;align-items:center;margin-left:auto;transition:color var(--t);flex-shrink:0;">
                ${icon('calendar', 18)}
            </button>
        `;
        addRow.parentNode.insertBefore(row, addRow.nextSibling);

        const input = row.querySelector('.add-task-input');
        const calendarButton = row.querySelector('.add-task-cal-btn');
        const badge = row.querySelector('.add-task-date-badge');

        const setNewTaskDate = (iso) => {
            newTaskDate = iso;
            if (iso) {
                badge.style.display = 'block';
                badge.textContent = formatDate(iso);
                calendarButton.style.color = '#fff';
            } else {
                badge.style.display = 'none';
                calendarButton.style.color = 'var(--text3)';
            }
            input.focus();
        };

        activeNewTaskDateSetter = canEditDate ? setNewTaskDate : null;

        input.addEventListener('input', () => {
            calendarButton.style.display = canEditDate && input.value.trim() ? 'flex' : 'none';
        });

        if (canEditDate) {
            calendarButton.addEventListener('click', (event) => {
                event.stopPropagation();
                openCustomCalendar(listId, 'new', newTaskDate);
            });
        }

        let submitted = false;
        let suppressBlurSubmitUntil = 0;

        const cleanup = () => {
            document.removeEventListener('pointerdown', onOutsidePointerDown, true);
            if (activeNewTaskDateSetter === setNewTaskDate) {
                activeNewTaskDateSetter = null;
            }
            row.remove();
            addRow.style.display = '';
        };

        const submit = () => {
            if (submitted) {
                return;
            }
            submitted = true;
            const text = input.value.trim();
            cleanup();
            if (text) {
                const autoDate = isTomorrowList(listId) ? getTomorrowIso() : '';
                store.addTask(listId, text, canEditDate ? newTaskDate : autoDate);
            }
            flushPendingRender();
        };

        const cancel = () => {
            if (submitted) {
                return;
            }
            submitted = true;
            cleanup();
            flushPendingRender();
        };

        // Taps inside the row (calendar button, badge) blur the input but must
        // never auto-save. The old 100ms blur guess got this wrong on touch —
        // buttons don't take focus there and the calendar modal often wasn't
        // open yet — so the task saved early, dateless.
        const noteRowInteraction = () => {
            suppressBlurSubmitUntil = Date.now() + 600;
        };
        row.addEventListener('pointerdown', noteRowInteraction);
        row.addEventListener('touchstart', noteRowInteraction, { passive: true });
        row.addEventListener('mousedown', noteRowInteraction);

        // A tap anywhere outside the row and the calendar commits the entry —
        // deterministic, unlike blur, which mobile keyboards and failed
        // programmatic refocus can swallow. Delayed just long enough for the
        // outside tap's own click to land before the board re-renders.
        const onOutsidePointerDown = (event) => {
            if (row.contains(event.target) || calOverlay.contains(event.target)) {
                return;
            }
            setTimeout(submit, 200);
        };
        document.addEventListener('pointerdown', onOutsidePointerDown, true);

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }

            if (event.key === 'Escape') {
                cancel();
            }
        });

        // Keyboard-only fallback: tab-away / focus loss with no tap at all.
        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (
                    submitted ||
                    Date.now() < suppressBlurSubmitUntil ||
                    calOverlay.classList.contains('visible') ||
                    document.activeElement === input
                ) {
                    return;
                }
                submit();
            }, 150);
        });
        input.focus();
    }

    function showColumnMenu(event, listId) {
        if (getBuiltInListKey(findListById(listId))) {
            closeAllMenus();
            return;
        }

        closeAllMenus();
        contextListId = listId;
        contextMenu.classList.add('visible');
        positionMenu(contextMenu, event);
    }

    function positionMenu(menu, event) {
        let x = event.clientX;
        let y = event.clientY + 10;
        const menuWidth = 200;
        const menuHeight = menu.offsetHeight || 120;

        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 20;
        }
        if (y + menuHeight > window.innerHeight) {
            y = Math.max(10, window.innerHeight - menuHeight - 12);
        }

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
    }

    function closeAllMenus() {
        contextMenu.classList.remove('visible');
    }

    function openListModal(mode, listId = null) {
        if (mode !== 'create-list' && getBuiltInListKey(findListById(listId))) {
            closeAllMenus();
            return;
        }

        modalMode = mode;
        contextListId = listId;

        if (mode === 'create-list') {
            modalTitle.textContent = 'New List';
            modalConfirm.textContent = 'Create';
            modalInput.value = '';
        } else {
            const list = appState.lists.find((candidate) => candidate.id === listId);
            modalTitle.textContent = 'Rename List';
            modalConfirm.textContent = 'Save';
            modalInput.value = list ? list.name : '';
        }

        modalOverlay.classList.add('visible');
        setTimeout(() => modalInput.focus(), 100);
    }

    function closeModal() {
        modalOverlay.classList.remove('visible');
        modalInput.value = '';
    }

    function showDeleteConfirm(onConfirm, { title = 'Delete task?', message = "This can't be undone." } = {}) {
        pendingDeleteCallback = onConfirm;
        deleteConfirmTitle.textContent = title;
        deleteConfirmMessage.textContent = message;
        deleteConfirmOverlay.classList.add('visible');
    }

    function closeDeleteConfirm() {
        deleteConfirmOverlay.classList.remove('visible');
        pendingDeleteCallback = null;
    }


    async function confirmModal() {
        const value = modalInput.value.trim();
        if (!value) {
            return;
        }

        if (modalMode === 'create-list') {
            await store.createList(value);
        } else if (contextListId) {
            await store.renameList(contextListId, value);
        }

        closeModal();
    }

    function deleteListWithConfirm(listId) {
        const list = appState.lists.find((candidate) => candidate.id === listId);
        if (!list) {
            return;
        }
        if (getBuiltInListKey(list)) {
            closeAllMenus();
            return;
        }

        showDeleteConfirm(async () => {
            await store.deleteList(listId);
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    board.scrollLeft = 0;
                }, 10);
            }
        }, {
            title: `Delete "${list.name}"?`,
            message: "The list and all its tasks will be deleted. This can't be undone."
        });
    }

    function openCustomCalendar(listId, taskId, initialDate = null) {
        if (taskId === 'new') {
            if (listForbidsDates(listId)) {
                return;
            }
            contextTaskListId = listId;
            contextTaskId = taskId;
            calSelectedIso = initialDate || null;
        } else {
            const taskLocation = findTaskLocation(taskId, listId);
            if (!taskLocation || listForbidsDates(taskLocation.listId)) {
                return;
            }

            contextTaskListId = taskLocation.listId;
            contextTaskId = taskId;
            calSelectedIso = taskLocation.task.date || null;
        }

        calCurrentDate = calSelectedIso ? new Date(`${calSelectedIso}T00:00:00`) : new Date();
        renderCalendar();
        calOverlay.classList.add('visible');
    }

    function closeCustomCalendar() {
        calOverlay.classList.remove('visible');
    }

    function renderCalendar() {
        const year = calCurrentDate.getFullYear();
        const month = calCurrentDate.getMonth();
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        calTitle.textContent = `${months[month]} ${year}`;

        calGrid.innerHTML = '';

        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

        for (let index = 0; index < firstDayOfMonth; index += 1) {
            const blank = document.createElement('div');
            blank.className = 'calendar-day empty';
            calGrid.appendChild(blank);
        }

        for (let day = 1; day <= daysInMonth; day += 1) {
            const dayElement = document.createElement('div');
            dayElement.className = 'calendar-day';
            dayElement.textContent = String(day);

            const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (isCurrentMonth && today.getDate() === day) {
                dayElement.classList.add('today');
            }
            if (calSelectedIso === iso) {
                dayElement.classList.add('selected');
            }

            dayElement.addEventListener('click', (event) => {
                event.stopPropagation();
                if (contextTaskId === 'new') {
                    if (activeNewTaskDateSetter) {
                        activeNewTaskDateSetter(iso);
                    }
                    closeCustomCalendar();
                    return;
                }

                const dateUpdates = { date: iso };
                if (!isTodayList(contextTaskListId) && iso !== getTodayIso()) {
                    // Leaving Today: drop its Today placement so it floats to the
                    // top again next time it lands in Today.
                    dateUpdates.todayPosition = null;
                }
                store.updateTask(contextTaskListId, contextTaskId, dateUpdates);
                closeCustomCalendar();
            });

            calGrid.appendChild(dayElement);
        }
    }

    // =================== DUE TIME CHIPS ===================
    // A task with a due time gets a chip on its row that turns red once the
    // moment passes. Display only — notifications (system + in-app card) were
    // removed in v1.7.0 by choice; the user checks the app manually.
    // Reminder bookkeeping from earlier versions; cleared on every start so
    // nothing lingers in storage.
    localStorage.removeItem('tasks_reminders_fired_v1');
    localStorage.removeItem('tasks_reminders_scheduled_v1');

    function getDueAt(dateIso, time) {
        return new Date(`${dateIso}T${time}:00`);
    }

    function getTimeUrgency(dueDateIso, time, now = new Date()) {
        if (!dueDateIso || !time) {
            return '';
        }

        return getDueAt(dueDateIso, time) < now ? 'past-due' : '';
    }

    function applyTimeBadgeUrgency(badge) {
        if (badge.dataset.done) {
            badge.classList.remove('past-due');
            return;
        }

        const urgency = getTimeUrgency(badge.dataset.dueDate, badge.dataset.dueTime);
        badge.classList.toggle('past-due', urgency === 'past-due');
    }

    function refreshTimeBadges() {
        $$('.task-time-badge').forEach(applyTimeBadgeUrgency);
    }

    function getPickedTime() {
        if (timeSelectedHour === null) {
            return '';
        }

        return `${String(timeSelectedHour).padStart(2, '0')}:${String(timeSelectedMinute ?? 0).padStart(2, '0')}`;
    }

    // Clock-dial layout: values sit on a circle (12/00 at the top), with 24h
    // hours split Material-style across two rings — 1-12 outside, 13-23 and
    // 00 inside — and minutes in 5-minute marks on the outer ring.
    const CLOCK_SIZE = 260;
    const CLOCK_OUTER_RADIUS = 104;
    const CLOCK_INNER_RADIUS = 66;
    const CLOCK_CELL_RADIUS = 18;

    function renderTimePicker() {
        timeSegHour.textContent = timeSelectedHour === null ? '--' : String(timeSelectedHour).padStart(2, '0');
        timeSegMinute.textContent = timeSelectedMinute === null ? '--' : String(timeSelectedMinute).padStart(2, '0');
        const isHourMode = timePickerMode === 'hour';
        timeSegHour.classList.toggle('active', isHourMode);
        timeSegMinute.classList.toggle('active', !isHourMode);

        $$('.clock-number', clockFace).forEach((node) => node.remove());

        const entries = [];
        if (isHourMode) {
            for (let hour = 1; hour <= 12; hour += 1) {
                entries.push({ value: hour, inner: false });
            }
            entries.push({ value: 0, inner: true });
            for (let hour = 13; hour <= 23; hour += 1) {
                entries.push({ value: hour, inner: true });
            }
        } else {
            for (let minute = 0; minute < 60; minute += 5) {
                entries.push({ value: minute, inner: false });
            }
        }

        const selectedValue = isHourMode ? timeSelectedHour : timeSelectedMinute;
        const center = CLOCK_SIZE / 2;
        entries.forEach(({ value, inner }) => {
            const angle = ((isHourMode ? (value % 12) * 30 : value * 6) * Math.PI) / 180;
            const radius = inner ? CLOCK_INNER_RADIUS : CLOCK_OUTER_RADIUS;
            const cell = document.createElement('div');
            cell.className = `clock-number${inner ? ' inner' : ''}${selectedValue === value ? ' selected' : ''}`;
            cell.textContent = String(value).padStart(2, '0');
            cell.style.left = `${center + radius * Math.sin(angle) - CLOCK_CELL_RADIUS}px`;
            cell.style.top = `${center - radius * Math.cos(angle) - CLOCK_CELL_RADIUS}px`;
            cell.addEventListener('click', (event) => {
                event.stopPropagation();
                if (isHourMode) {
                    timeSelectedHour = value;
                    if (timeSelectedMinute === null) {
                        timeSelectedMinute = 0;
                    }
                    // Show the pick land, then flow on to the minute dial.
                    setTimeout(() => {
                        timePickerMode = 'minute';
                        renderTimePicker();
                    }, 200);
                } else {
                    timeSelectedMinute = value;
                    if (timeSelectedHour === null) {
                        timeSelectedHour = new Date().getHours();
                    }
                }
                renderTimePicker();
            });
            clockFace.appendChild(cell);
        });

        if (selectedValue === null) {
            clockHand.classList.add('hidden');
        } else {
            // Odd minutes (from a previously stored time) have no 5-minute
            // mark, but the hand still points at the exact angle.
            const angleDeg = isHourMode ? (selectedValue % 12) * 30 : selectedValue * 6;
            const onInnerRing = isHourMode && (selectedValue === 0 || selectedValue > 12);
            const radius = onInnerRing ? CLOCK_INNER_RADIUS : CLOCK_OUTER_RADIUS;
            clockHand.style.height = `${radius - CLOCK_CELL_RADIUS + 4}px`;
            clockHand.style.transform = `rotate(${angleDeg}deg)`;
            clockHand.classList.remove('hidden');
        }
    }

    function openTimeModal(listId, taskId) {
        const taskLocation = findTaskLocation(taskId, listId);
        if (!taskLocation) {
            return;
        }

        timeTaskListId = taskLocation.listId;
        timeTaskId = taskId;
        timeModalTask.textContent = taskLocation.task.text;
        if (taskLocation.task.time) {
            const [hourString, minuteString] = taskLocation.task.time.split(':');
            timeSelectedHour = Number(hourString);
            timeSelectedMinute = Number(minuteString);
        } else {
            timeSelectedHour = null;
            timeSelectedMinute = null;
        }
        timePickerMode = 'hour';
        renderTimePicker();
        timeModalOverlay.classList.add('visible');
    }

    function closeTimeModal() {
        timeModalOverlay.classList.remove('visible');
        timeTaskId = null;
        timeTaskListId = null;
    }

    function confirmTimeModal() {
        if (!timeTaskId) {
            closeTimeModal();
            return;
        }

        const time = getPickedTime();
        const taskLocation = findTaskLocation(timeTaskId, timeTaskListId);
        if (taskLocation && time !== (taskLocation.task.time || '')) {
            const updates = { time };
            // A time needs a day to belong to: a dateless task in a regular
            // list gets today's date so it lands in Today with its chip.
            // Today-native and routine tasks are already implicitly today.
            if (time && !taskLocation.task.date && !listForbidsDates(taskLocation.listId)) {
                updates.date = getTodayIso();
            }

            store.updateTask(taskLocation.listId, timeTaskId, updates);
        }
        closeTimeModal();
    }

    function isBoardInputActive() {
        // Presence, not focus: an entry row whose calendar is open (input
        // unfocused) must still defer renders — a board rebuild would destroy
        // the half-typed task. Every close path calls flushPendingRender().
        return Boolean(document.querySelector('.add-task-input-row, .task-inline-input'));
    }

    function flushPendingRender() {
        if (pendingRenderWhileTyping) {
            render();
        }
    }

    function render() {
        // Keyed reconciliation preserves nodes, but the board still must not
        // shift under an open entry field or a live drag (SortableJS owns the
        // DOM order mid-drag). Defer; input close paths and drag ends call
        // flushPendingRender().
        if (isBoardInputActive() || isDraggingTask || isDraggingList) {
            pendingRenderWhileTyping = true;
            return;
        }

        pendingRenderWhileTyping = false;
        lastRenderedTodayIso = getTodayIso();
        $$('.nav-item').forEach((element) => {
            element.classList.toggle('active', element.dataset.view === appState.activeView);
        });
        renderSidebarLists();
        renderRoutineHeatmap();
        renderBoard();
    }

    async function handleAuth(event) {
        event.preventDefault();
        authError.classList.add('hidden');
        authSubmit.disabled = true;
        authSubmit.textContent = 'Signing In...';

        const error = await store.signIn(emailInput.value, passwordInput.value);
        if (error) {
            authError.textContent = error.message;
            authError.classList.remove('hidden');
        }

        authSubmit.disabled = false;
        authSubmit.textContent = 'Sign In';
    }

    function toggleSidebar() {
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            sidebar.classList.toggle('visible');
            sidebarOverlay.classList.toggle('active');
            sidebar.classList.remove('collapsed');

            const isSidebarOpen = sidebar.classList.contains('visible');
            board.style.overflowX = isSidebarOpen ? 'hidden' : '';
            board.style.touchAction = isSidebarOpen ? 'none' : '';
            document.body.style.overflow = isSidebarOpen ? 'hidden' : '';
            return;
        }

        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        topbar.classList.toggle('visible', isCollapsed);
        mainEl.classList.toggle('has-topbar', isCollapsed);
        sidebar.classList.remove('visible');
        sidebarOverlay.classList.remove('active');
        board.style.overflowX = '';
        board.style.touchAction = '';
        document.body.style.overflow = '';
        placeSyncIndicator();
    }

    store.subscribeState((nextState) => {
        appState = nextState;
        render();
    });

    store.subscribeAuth((user) => {
        currentUser = user;
        refreshAuthUI();
    });

    store.subscribeSync((nextStatus) => {
        syncStatus = nextStatus;
        updateSyncIndicator();
        placeSyncIndicator();
    });

    if (syncIndicator) {
        syncIndicator.addEventListener('click', () => {
            store.syncNow();
        });
    }


    authForm.addEventListener('submit', handleAuth);
    hamburgerBtn.addEventListener('click', toggleSidebar);
    topbarHamburger.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', toggleSidebar);

    createBtn.addEventListener('click', () => openListModal('create-list'));

    // --- Task search (quick-jump) ---
    // Search the same set the board actually renders: getDisplayList applies the
    // built-in lists' filters (Upcoming = future-dated only, etc.), so we never
    // surface ghosts that linger in a built-in list's raw `tasks` but are hidden
    // from every column. Dedupe by id (a task can appear in its own list AND a
    // built-in aggregate) and resolve each hit to its real owning list so the
    // jump + flash land where the task truly lives.
    function searchTasks(query) {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return [];
        }

        const seen = new Set();
        const matches = [];
        for (const list of getRenderableLists()) {
            for (const task of getDisplayList(list).tasks) {
                if (seen.has(task.id)) {
                    continue;
                }

                const haystack = `${task.text || ''} ${task.details || ''}`.toLowerCase();
                if (!haystack.includes(needle)) {
                    continue;
                }

                seen.add(task.id);
                const ownerList = findListById(task._originListId || list.id) || list;
                matches.push({ task, list: ownerList });
                if (matches.length >= 50) {
                    return matches;
                }
            }
        }
        return matches;
    }

    function highlightMatch(text, query) {
        const value = String(text || '');
        const needle = query.trim();
        if (!needle) {
            return escapeHtml(value);
        }

        const index = value.toLowerCase().indexOf(needle.toLowerCase());
        if (index === -1) {
            return escapeHtml(value);
        }

        return `${escapeHtml(value.slice(0, index))}<mark>${escapeHtml(value.slice(index, index + needle.length))}</mark>${escapeHtml(value.slice(index + needle.length))}`;
    }

    function closeSearch() {
        searchResults.classList.add('hidden');
        searchResults.innerHTML = '';
    }

    function clearSearch() {
        searchInput.value = '';
        searchClear.classList.add('hidden');
        closeSearch();
    }

    function flashTask(taskId) {
        const element = $$('.task-item').find((node) => node.dataset.taskId === taskId);
        if (!element) {
            return;
        }
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // The highlight is a layout-neutral overlay, so toggling the class is
        // free of any content shift. Re-add it (with a reflow) so the flash
        // re-fires on repeat jumps, then drop it once the animation is done.
        element.classList.remove('search-flash');
        void element.offsetWidth;
        element.classList.add('search-flash');
        setTimeout(() => element.classList.remove('search-flash'), 3200);
    }

    function jumpToResult({ task, list }) {
        clearSearch();
        searchInput.blur();
        store.setActiveView(list.id);
        if (window.innerWidth <= 768) {
            toggleSidebar();
        }
        // setActiveView triggers an async render; wait a frame so the task row exists.
        requestAnimationFrame(() => requestAnimationFrame(() => flashTask(task.id)));
    }

    function renderSearchResults() {
        const query = searchInput.value;
        searchClear.classList.toggle('hidden', !query);

        if (!query.trim()) {
            closeSearch();
            return;
        }

        const matches = searchTasks(query);
        searchResults.innerHTML = '';
        searchResults.classList.remove('hidden');

        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'search-empty';
            empty.textContent = 'No matching tasks';
            searchResults.appendChild(empty);
            return;
        }

        // Small calendar glyph reused from the board's date labels, so a dated
        // result reads the same way a task's date header does.
        const calendarIcon = icon('calendar', 13);
        const listIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>';

        matches.forEach(({ task, list }) => {
            const row = document.createElement('div');
            row.className = 'search-result';
            const datePart = task.date
                ? `<span class="dot">·</span><span class="search-result-date">${calendarIcon}${escapeHtml(formatDate(task.date))} · ${escapeHtml(getRelativeDate(task.date))}</span>`
                : '';
            row.innerHTML = `
                <span class="search-result-text">${highlightMatch(task.text, query)}</span>
                <span class="search-result-meta"><span class="search-result-list">${listIcon}${escapeHtml(list.name)}</span>${datePart}</span>
            `;
            row.addEventListener('click', () => jumpToResult({ task, list }));
            searchResults.appendChild(row);
        });
    }

    searchInput.addEventListener('input', renderSearchResults);
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) {
            renderSearchResults();
        }
    });
    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            clearSearch();
            searchInput.blur();
        }
    });
    searchClear.addEventListener('click', () => {
        clearSearch();
        searchInput.focus();
    });
    document.addEventListener('click', (event) => {
        if (!$('#sidebarSearch').contains(event.target)) {
            closeSearch();
        }
    });

    navAll.addEventListener('click', () => {
        store.setActiveView('all');
        if (window.innerWidth <= 768) {
            toggleSidebar();
        }
    });

    listsToggle.addEventListener('click', () => {
        listsToggle.classList.toggle('collapsed');
        listsContainer.classList.toggle('collapsed');
    });

    // Tap the ROUTINE header (or its chevron) to fold the heatmap away.
    // A device-local preference: it survives reloads but is not synced.
    function applyHeatmapCollapsed(collapsed) {
        routineHeatmap.classList.toggle('collapsed', collapsed);
        heatmapToggle.classList.toggle('collapsed', collapsed);
    }
    applyHeatmapCollapsed(Boolean(localStorage.getItem(HEATMAP_COLLAPSED_KEY)));
    heatmapHeader.addEventListener('click', () => {
        const collapsed = !routineHeatmap.classList.contains('collapsed');
        applyHeatmapCollapsed(collapsed);
        try {
            if (collapsed) {
                localStorage.setItem(HEATMAP_COLLAPSED_KEY, '1');
            } else {
                localStorage.removeItem(HEATMAP_COLLAPSED_KEY);
            }
        } catch (error) {
            // Preference just won't stick; the toggle itself still works.
        }
    });

    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            const pendingQueue = store.getPendingQueueLength();
            if (pendingQueue > 0) {
                const prompt = store.isOnline()
                    ? 'Some mobile changes are still syncing. Sign out anyway? Pending changes will stay queued on this device until you sign back in.'
                    : 'You are offline. Pending mobile changes will stay queued on this device until you sign back in. Sign out anyway?';
                if (!confirm(prompt)) {
                    return;
                }

                if (store.isOnline()) {
                    await store.syncNow({ stabilize: true });
                }
            }

            await store.signOut();
        });
    }

    ctxRename.addEventListener('click', () => {
        closeAllMenus();
        openListModal('rename-list', contextListId);
    });
    ctxDelete.addEventListener('click', () => {
        closeAllMenus();
        deleteListWithConfirm(contextListId);
    });
    modalCancel.addEventListener('click', closeModal);
    modalConfirm.addEventListener('click', confirmModal);

    deleteConfirmCancel.addEventListener('click', closeDeleteConfirm);
    deleteConfirmOk.addEventListener('click', () => {
        if (pendingDeleteCallback) pendingDeleteCallback();
        closeDeleteConfirm();
    });
    deleteConfirmOverlay.addEventListener('click', (event) => {
        if (event.target === deleteConfirmOverlay) closeDeleteConfirm();
    });
    modalInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            confirmModal();
        }
        if (event.key === 'Escape') {
            closeModal();
        }
    });
    modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) {
            closeModal();
        }
    });

    calPrevBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        calCurrentDate.setMonth(calCurrentDate.getMonth() - 1);
        renderCalendar();
    });
    calNextBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        calCurrentDate.setMonth(calCurrentDate.getMonth() + 1);
        renderCalendar();
    });
    calClearBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (contextTaskId === 'new') {
            if (activeNewTaskDateSetter) {
                activeNewTaskDateSetter('');
            }
            closeCustomCalendar();
            return;
        }

        const clearDateUpdates = { date: '' };
        if (!isTodayList(contextTaskListId)) {
            // Clearing the date removes it from Today: drop its Today placement.
            clearDateUpdates.todayPosition = null;
        }
        store.updateTask(contextTaskListId, contextTaskId, clearDateUpdates);
        closeCustomCalendar();
    });
    calOverlay.addEventListener('click', (event) => {
        if (event.target === calOverlay) {
            closeCustomCalendar();
        }
    });

    timeSegHour.addEventListener('click', () => {
        timePickerMode = 'hour';
        renderTimePicker();
    });
    timeSegMinute.addEventListener('click', () => {
        timePickerMode = 'minute';
        renderTimePicker();
    });
    timeSetBtn.addEventListener('click', confirmTimeModal);
    timeClearBtn.addEventListener('click', () => {
        if (timeTaskId) {
            timeSelectedHour = null;
            timeSelectedMinute = null;
            confirmTimeModal();
            return;
        }
        closeTimeModal();
    });
    timeModalOverlay.addEventListener('click', (event) => {
        if (event.target === timeModalOverlay) {
            closeTimeModal();
        }
    });

    document.addEventListener('click', closeAllMenus);
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.task-item')) {
            $$('.task-item.icons-visible').forEach(el => el.classList.remove('icons-visible'));
        }
    });

    document.addEventListener('touchstart', (event) => {
        if (shouldSuppressListInteractions()) {
            isEdgeSwipe = false;
            return;
        }
        touchStartX = event.changedTouches[0].screenX;
        touchStartTime = Date.now();
        isEdgeSwipe = (
            touchStartX < window.innerWidth * 0.2 &&
            window.innerWidth <= 768 &&
            !sidebar.classList.contains('visible')
        );

        if (isEdgeSwipe) {
            board.style.overflowX = 'hidden';
            board.style.touchAction = 'none';
        }
    }, { passive: true });

    document.addEventListener('touchend', (event) => {
        if (shouldSuppressListInteractions()) {
            isEdgeSwipe = false;
            return;
        }
        const touchEndX = event.changedTouches[0].screenX;
        const deltaX = touchEndX - touchStartX;
        const deltaTime = Date.now() - touchStartTime;

        if (isEdgeSwipe && deltaX > 40 && deltaTime < 400) {
            if (!sidebar.classList.contains('visible')) {
                toggleSidebar();
            }
        } else if (isEdgeSwipe) {
            board.style.overflowX = '';
            board.style.touchAction = '';
        }
        isEdgeSwipe = false;

        if (sidebar.classList.contains('visible') && deltaX < -40 && deltaTime < 400) {
            toggleSidebar();
        }
    }, { passive: true });

    sidebar.addEventListener('touchstart', (event) => {
        if (shouldSuppressListInteractions()) {
            return;
        }
        touchStartX = event.changedTouches[0].screenX;
    }, { passive: true });
    sidebar.addEventListener('touchend', (event) => {
        if (shouldSuppressListInteractions()) {
            return;
        }
        const touchEndX = event.changedTouches[0].screenX;
        if (touchStartX - touchEndX > 50 && sidebar.classList.contains('visible')) {
            toggleSidebar();
        }
    }, { passive: true });

    window.addEventListener('resize', () => {
        const currentWidth = window.innerWidth;
        if (currentWidth !== lastWidth) {
            const wasMobileLayout = lastWidth <= 768;
            lastWidth = currentWidth;
            placeSyncIndicator();
            // Mobile layout depends on the exact width (tabs, scroll snap), so
            // re-render on any mobile resize — and once more when leaving
            // mobile, or the desktop board keeps the mobile-only DOM around.
            if (currentWidth <= 768 || wasMobileLayout) {
                render();
            }
        }
    });

    const triggerForegroundSync = () => {
        if (document.visibilityState === 'hidden') {
            return;
        }

        if (!store.isOnline()) {
            store.handleOffline();
            return;
        }

        if (enableOfflineQueue) {
            // The connection never dropped on a plain foreground — skip the
            // reconnect settle delay so queued changes flush immediately.
            store.handleOnline({ settle: false });
            return;
        }

        store.syncNow();
    };

    const syncNativeConnectivityState = async ({ triggerSync = false } = {}) => {
        if (!networkPlugin) {
            return;
        }

        try {
            const status = await networkPlugin.call('getStatus');
            const connected = Boolean(status?.connected);
            store.setOnlineState(connected);

            if (!triggerSync) {
                if (!connected) {
                    store.handleOffline();
                }
                return;
            }

            if (connected) {
                await store.handleOnline();
            } else {
                store.handleOffline();
            }
        } catch (error) {
            console.warn('[Native] Network status unavailable:', error);
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            triggerForegroundSync();
            refreshTimeBadges();
        }
    });

    window.addEventListener('online', () => {
        store.handleOnline();
    });
    window.addEventListener('offline', () => {
        store.handleOffline();
    });

    if (enableOfflineQueue) {
        window.addEventListener('focus', triggerForegroundSync);
        window.addEventListener('pageshow', triggerForegroundSync);
        document.addEventListener('resume', triggerForegroundSync);

        networkPlugin?.addListener('networkStatusChange', (status) => {
            store.setOnlineState(Boolean(status?.connected));
            if (status?.connected) {
                store.handleOnline();
                return;
            }

            store.handleOffline();
        });

        appPlugin?.addListener('appStateChange', (state) => {
            if (state?.isActive) {
                triggerForegroundSync();
            }
        });
    }

    setInterval(() => {
        // The visibility handler re-syncs the moment the app comes back —
        // polling while hidden just burns battery and data.
        if (document.visibilityState === 'hidden') {
            return;
        }

        // With a live realtime channel, changes arrive as they happen; the
        // poll is only a safety net, so back it off while things are healthy.
        if (
            store.isRealtimeHealthy() &&
            syncStatus.lastSuccessAt &&
            Date.now() - syncStatus.lastSuccessAt < REALTIME_HEALTHY_POLL_INTERVAL_MS
        ) {
            return;
        }

        store.syncNow();
    }, FALLBACK_SYNC_INTERVAL_MS);

    // Today/Overdue grouping is computed against the local date at render
    // time, so a board left open past midnight goes stale until re-rendered.
    // The date flip is also the clean-slate moment: routines flip back to
    // pending on the re-render and yesterday's completed one-offs get reaped.
    setInterval(() => {
        if (getTodayIso() !== lastRenderedTodayIso && !isDraggingTask && !isDraggingList) {
            render();
            store.reapExpiredCompletedTasks();
        }
    }, 60000);

    setInterval(refreshTimeBadges, 30000);

    // Completed one-offs are kept, struck through, until the end of their
    // completion day; the reaper deletes the expired ones. Checked on a slow
    // cadence — deletes are idempotent across devices.
    setInterval(() => {
        if (document.visibilityState !== 'hidden') {
            store.reapExpiredCompletedTasks();
        }
    }, 600000);

    updateSyncIndicator();
    placeSyncIndicator();
    refreshAuthUI();
    render();
    await syncNativeConnectivityState();
    await store.bootstrap();
    isAuthBootstrapping = false;
    refreshAuthUI();
    store.reapExpiredCompletedTasks();

    if (!enableOfflineQueue && 'serviceWorker' in navigator) {
        const registerServiceWorker = () => {
            navigator.serviceWorker.register('/sw.js')
                .then((registration) => {
                    console.log('[SW] Registered:', registration.scope);
                })
                .catch((error) => {
                    console.error('[SW] Registration failed:', error);
                });
        };

        if (document.readyState === 'complete') {
            registerServiceWorker();
        } else {
            window.addEventListener('load', registerServiceWorker, { once: true });
        }
    }
}
