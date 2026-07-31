import {
    cloneStateSnapshot,
    createDefaultState,
    DEFAULT_LIST_NAMES,
    formatErrorMessage,
    isCompletionExpired,
    isNetworkLikeError,
    normalizeList,
    normalizePosition,
    normalizeStateSnapshot,
    normalizeVersion,
    sleep,
    sortListsForDisplay,
    sortTasksForDisplay,
    uid
} from './utils.mjs';

const STORAGE_KEY_PREFIX = 'tasks_app_data_v4';
const MOBILE_QUEUE_KEY_PREFIX = 'tasks_mobile_queue_v4';
const AUTH_HINT_KEY = 'tasks_auth_hint_v1';
const BUILT_IN_SETUP_KEY_PREFIX = 'tasks_builtin_setup_v1';
const LEGACY_STATE_KEYS = ['tasks_app_data_v3', 'tasks_app_data_v2'];
const LEGACY_QUEUE_KEYS = ['tasks_mobile_queue_v3', 'tasks_offline_queue_v3', 'tasks_offline_queue'];
const MAX_QUEUE_RETRY_DELAY_MS = 60000;
const REMOTE_REFRESH_RETRY_DELAYS_MS = [0, 800, 1500];
const MOBILE_RECONNECT_SETTLE_MS = 800;
const RECONNECT_QUEUE_RETRY_DELAY_MS = 1200;
// Android fires 'online' several seconds before the radio can pass traffic,
// and no second event arrives once it truly can. Failures that never reached
// the server keep the flat reconnect cadence for this many attempts (~15s)
// before regular backoff resumes, so a dead-radio window can't push the next
// attempt into the 20s+ tiers.
const NETWORK_FAILURE_FAST_RETRY_LIMIT = 12;
const QUEUE_FLUSH_CONCURRENCY = 4;
const REALTIME_MAX_PENDING_EVENTS = 60;
const REALTIME_RETRY_MAX_DELAY_MS = 30000;
const POSITION_STEP = 1024;
const TODAY_LIST_NAME = 'Today';
const UPCOMING_LIST_NAME = 'Upcoming';
const ROUTINE_LIST_NAME = 'Routine';
const UPCOMING_SETUP_KEY = 'upcoming';

export function createTasksStore({ supabase, enableOfflineQueue }) {
    let state = { lists: [], activeView: 'all' };
    let currentUser = null;
    let hasAuthenticatedSession = false;
    let onlineStatus = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    let syncStatus = {
        phase: supabase ? 'idle' : 'local',
        pending: 0,
        error: '',
        lastSuccessAt: 0
    };

    let isSyncing = false;
    let isFlushingQueue = false;
    let activeRemoteWrites = 0;
    let realtimeChannel = null;
    let realtimeRefreshTimer = null;
    let realtimeRetryTimer = null;
    let realtimeRetryCount = 0;
    let pendingRealtimeEvents = [];
    let realtimeEventsOverflowed = false;
    let queuedSyncTimer = null;
    const inFlightEntityWrites = new Map();

    // The queue is consulted on every mutation and status update; parsing
    // localStorage JSON each time is wasted work. Cache per storage key —
    // the key embeds the user scope, so a user switch misses naturally.
    let queueCache = null;
    let queueCacheKey = '';

    const stateListeners = new Set();
    const authListeners = new Set();
    const syncListeners = new Set();

    function emitState() {
        stateListeners.forEach((listener) => listener(state));
    }

    function emitAuth() {
        authListeners.forEach((listener) => listener(currentUser));
    }

    function emitSync() {
        syncListeners.forEach((listener) => listener(syncStatus));
    }

    function updateSyncStatus(patch = {}) {
        syncStatus = { ...syncStatus, ...patch };
        emitSync();
    }

    function isOnline() {
        return onlineStatus !== false;
    }

    function setOnlineState(nextOnline = null) {
        if (typeof nextOnline === 'boolean') {
            onlineStatus = nextOnline;
            return;
        }

        onlineStatus = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    }

    function canSyncRemotely() {
        return Boolean(supabase && currentUser && hasAuthenticatedSession);
    }

    function getScope() {
        return currentUser?.id || 'local';
    }

    function canPersistScopedData() {
        return !supabase || Boolean(currentUser);
    }

    function getStorageKey(scope = getScope()) {
        return `${STORAGE_KEY_PREFIX}:${scope}`;
    }

    function getQueueKey(scope = getScope()) {
        return `${MOBILE_QUEUE_KEY_PREFIX}:${scope}`;
    }

    function getBuiltInSetupKey(scope = getScope()) {
        return `${BUILT_IN_SETUP_KEY_PREFIX}:${scope}`;
    }

    function readJson(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('[Storage] Write skipped:', error);
        }
    }

    function removeStorageKey(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('[Storage] Remove skipped:', error);
        }
    }

    function normalizeCachedUser(user) {
        if (!user || typeof user !== 'object') {
            return null;
        }

        const id = typeof user.id === 'string' ? user.id.trim() : '';
        if (!id) {
            return null;
        }

        return {
            id,
            email: typeof user.email === 'string' ? user.email : ''
        };
    }

    function extractSupabaseUserHint(snapshot) {
        const directUser = normalizeCachedUser(snapshot?.user);
        if (directUser) {
            return directUser;
        }

        const currentSessionUser = normalizeCachedUser(snapshot?.currentSession?.user);
        if (currentSessionUser) {
            return currentSessionUser;
        }

        const sessionUser = normalizeCachedUser(snapshot?.session?.user);
        if (sessionUser) {
            return sessionUser;
        }

        if (!Array.isArray(snapshot)) {
            return null;
        }

        for (const entry of snapshot) {
            const nestedUser = normalizeCachedUser(entry?.user || entry?.currentSession?.user || entry?.session?.user);
            if (nestedUser) {
                return nestedUser;
            }
        }

        return null;
    }

    function persistUserHint(user) {
        const normalized = normalizeCachedUser(user);
        if (normalized) {
            writeJson(AUTH_HINT_KEY, normalized);
            return;
        }

        removeStorageKey(AUTH_HINT_KEY);
    }

    function readStoredUserHint() {
        const persistedHint = normalizeCachedUser(readJson(AUTH_HINT_KEY));
        if (persistedHint) {
            return persistedHint;
        }

        try {
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) {
                    continue;
                }

                const fallbackUser = extractSupabaseUserHint(readJson(key));
                if (fallbackUser) {
                    persistUserHint(fallbackUser);
                    return fallbackUser;
                }
            }
        } catch (error) {
            console.warn('[Auth] Stored user hint lookup skipped:', error);
        }

        return null;
    }

    function normalizeListName(name) {
        return String(name || '').trim().toUpperCase();
    }

    function isBuiltInListName(name) {
        const normalizedName = normalizeListName(name);
        return normalizedName === normalizeListName(TODAY_LIST_NAME)
            || normalizedName === normalizeListName(UPCOMING_LIST_NAME)
            || normalizedName === normalizeListName(ROUTINE_LIST_NAME);
    }

    function readBuiltInSetup() {
        if (!canPersistScopedData()) {
            return {};
        }

        const parsed = readJson(getBuiltInSetupKey());
        return parsed && typeof parsed === 'object' ? parsed : {};
    }

    function persistBuiltInSetup(setup) {
        if (!canPersistScopedData()) {
            return;
        }

        writeJson(getBuiltInSetupKey(), setup);
    }

    function markBuiltInEnsured(key) {
        const builtInSetup = readBuiltInSetup();
        if (builtInSetup[key]) {
            return;
        }

        persistBuiltInSetup({ ...builtInSetup, [key]: true });
    }

    function persistState() {
        if (!canPersistScopedData()) {
            return;
        }

        writeJson(getStorageKey(), normalizeStateSnapshot(state));
    }

    function replaceState(nextState, { persist = true } = {}) {
        state = normalizeStateSnapshot(nextState);
        if (persist) {
            persistState();
        }
        emitState();
    }

    function getQueue() {
        if (!enableOfflineQueue || !canPersistScopedData()) {
            return [];
        }

        const cacheKey = getQueueKey();
        if (queueCache && queueCacheKey === cacheKey) {
            // Copy so callers can splice/push before persisting, exactly as
            // they could when every read produced a fresh parse.
            return [...queueCache];
        }

        const parsed = readJson(cacheKey);
        const queue = !Array.isArray(parsed) ? [] : parsed
            .map((operation) => ({
                retryCount: 0,
                lastError: '',
                lastAttemptAt: 0,
                // Deterministic fallback so ops persisted before opIds existed
                // keep a stable identity across reads (flush reconciliation).
                opId: `${operation.type || 'op'}:${operation.taskId || operation.listId || ''}:${operation.timestamp || 0}`,
                ...operation
            }))
            .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));

        queueCache = queue;
        queueCacheKey = cacheKey;
        return [...queue];
    }

    function persistQueue(queue) {
        if (!enableOfflineQueue || !canPersistScopedData()) {
            return;
        }

        queueCache = [...queue];
        queueCacheKey = getQueueKey();
        writeJson(getQueueKey(), queue);
    }

    function setQueueStatus(queue = getQueue()) {
        const firstError = queue.find((operation) => operation.lastError && !isOperationInNetworkFastRetry(operation));
        updateSyncStatus({
            pending: queue.length,
            phase: queue.length === 0 ? 'idle' : (isOnline() ? (firstError ? 'error' : 'queued') : 'offline'),
            error: firstError ? firstError.lastError : ''
        });

        if (queue.length > 0) {
            scheduleQueuedSync();
        }
    }

    function resetQueuedOperationRetries(queue = getQueue()) {
        let didChange = false;
        const nextQueue = queue.map((operation) => {
            if (!(operation.retryCount > 0) && !(operation.networkRetryCount > 0) && !operation.lastAttemptAt && !operation.lastError) {
                return operation;
            }

            didChange = true;
            return {
                ...operation,
                retryCount: 0,
                networkRetryCount: 0,
                lastAttemptAt: 0,
                lastError: ''
            };
        });

        if (didChange) {
            persistQueue(nextQueue);
        }

        return didChange ? nextQueue : queue;
    }

    function clearQueuedSyncTimer() {
        if (queuedSyncTimer) {
            clearTimeout(queuedSyncTimer);
            queuedSyncTimer = null;
        }
    }

    function getRetryDelayMs(retryCount = 0) {
        const normalizedRetryCount = Math.max(1, retryCount);
        const baseDelayMs = normalizedRetryCount <= 3 ? RECONNECT_QUEUE_RETRY_DELAY_MS : 5000;
        return Math.min(baseDelayMs * normalizedRetryCount, MAX_QUEUE_RETRY_DELAY_MS);
    }

    function getNextQueuedSyncDelayMs(queue = getQueue(), now = Date.now()) {
        if (!Array.isArray(queue) || queue.length === 0) {
            return null;
        }

        const nextAttemptAt = queue.reduce((soonestAttemptAt, operation) => {
            const lastAttemptAt = Number(operation.lastAttemptAt) || 0;
            const retryDelay = lastAttemptAt > 0 ? getRetryDelayMs(operation.retryCount || 0) : 0;
            return Math.min(soonestAttemptAt, lastAttemptAt + retryDelay);
        }, Number.POSITIVE_INFINITY);

        return Math.max(0, nextAttemptAt - now);
    }

    function shouldAttemptQueuedOperation(operation, now = Date.now()) {
        if (!operation.lastAttemptAt) {
            return true;
        }

        return now - operation.lastAttemptAt >= getRetryDelayMs(operation.retryCount || 0);
    }

    function markQueuedOperationFailed(operation, error) {
        // A network-level failure says nothing about the server, so it must
        // not escalate the backoff that exists to protect the server. Server
        // rejections reset the burst: they prove the network works.
        const isNetworkFailure = isNetworkLikeError(error);
        const networkRetryCount = isNetworkFailure ? (operation.networkRetryCount || 0) + 1 : 0;
        const holdEscalation = isNetworkFailure && networkRetryCount <= NETWORK_FAILURE_FAST_RETRY_LIMIT;
        return {
            ...operation,
            retryCount: (operation.retryCount || 0) + (holdEscalation ? 0 : 1),
            networkRetryCount,
            lastError: formatErrorMessage(error, 'Sync failed.').slice(0, 240),
            lastAttemptAt: Date.now()
        };
    }

    // While a queued op is still inside the network-failure burst, the
    // failures are expected reconnect noise — the indicator should read
    // "queued", not "error".
    function isOperationInNetworkFastRetry(operation) {
        const networkRetryCount = operation.networkRetryCount || 0;
        return networkRetryCount > 0 && networkRetryCount <= NETWORK_FAILURE_FAST_RETRY_LIMIT;
    }

    function getOperationEntityKey(operation) {
        if (typeof operation?.type !== 'string') {
            return null;
        }
        if (operation.type.endsWith('_task')) {
            return operation.taskId ? `task:${operation.taskId}` : null;
        }
        if (operation.type.endsWith('_list')) {
            return operation.listId ? `list:${operation.listId}` : null;
        }
        return null;
    }

    // A direct write must not overtake queued ops it depends on: an edit to an
    // entity that already has a queued op, or a task write into a list whose
    // insert is still queued (the server row does not exist yet).
    function hasQueuedOperationBlocking(operation) {
        if (!enableOfflineQueue) {
            return false;
        }

        const queue = getQueue();
        if (queue.length === 0) {
            return false;
        }

        const entityKey = getOperationEntityKey(operation);
        const parentListKey = operation.type?.endsWith('_task') && operation.listId
            ? `list:${operation.listId}`
            : null;

        return queue.some((queued) => {
            const queuedKey = getOperationEntityKey(queued);
            if (entityKey && queuedKey === entityKey) {
                return true;
            }
            return Boolean(parentListKey) && queuedKey === parentListKey && queued.type === 'insert_list';
        });
    }

    // Re-read the entity's version at execution time so a write chained behind
    // another write to the same entity uses the version that write produced,
    // instead of conflicting with our own change.
    function withLiveExpectedVersion(operation) {
        if (operation.type === 'update_task' || operation.type === 'delete_task') {
            const entry = findTaskEntry(operation.taskId);
            if (entry) {
                return { ...operation, expectedVersion: entry.task.version ?? operation.expectedVersion ?? 0 };
            }
        } else if (operation.type === 'update_list' || operation.type === 'delete_list') {
            const list = findList(operation.listId);
            if (list) {
                return { ...operation, expectedVersion: list.version ?? operation.expectedVersion ?? 0 };
            }
        }
        return operation;
    }

    async function runExclusivelyForEntity(entityKey, task) {
        if (!entityKey) {
            return task();
        }

        const previous = inFlightEntityWrites.get(entityKey) || Promise.resolve();
        const run = previous.catch(() => {}).then(task);
        inFlightEntityWrites.set(entityKey, run);
        try {
            return await run;
        } finally {
            if (inFlightEntityWrites.get(entityKey) === run) {
                inFlightEntityWrites.delete(entityKey);
            }
        }
    }

    async function runWithConcurrencyLimit(items, limit, worker) {
        if (items.length === 0) {
            return;
        }

        const pending = [...items];
        const workers = Array.from({ length: Math.min(limit, pending.length) }, async () => {
            while (pending.length > 0) {
                await worker(pending.shift());
            }
        });
        await Promise.all(workers);
    }

    function scheduleQueuedSync({ delayMs = null } = {}) {
        clearQueuedSyncTimer();

        if (!enableOfflineQueue) {
            return;
        }

        const queue = getQueue();
        if (queue.length === 0) {
            return;
        }

        if (!canSyncRemotely() || !isOnline()) {
            return;
        }

        const nextDelayMs = Math.max(0, delayMs ?? getNextQueuedSyncDelayMs(queue) ?? 0);
        queuedSyncTimer = setTimeout(async () => {
            queuedSyncTimer = null;

            if (!enableOfflineQueue || getQueue().length === 0) {
                return;
            }

            if (!canSyncRemotely() || !isOnline()) {
                return;
            }

            if (isSyncing || isFlushingQueue || activeRemoteWrites > 0) {
                scheduleQueuedSync({ delayMs: 250 });
                return;
            }

            await syncNow();

            if (getQueue().length > 0) {
                scheduleQueuedSync();
            }
        }, nextDelayMs);
    }

    function migrateLegacyScopedData(scope = getScope()) {
        if (!scope) {
            return;
        }

        try {
            if (!localStorage.getItem(getStorageKey(scope))) {
                const stateCandidates = [];

                for (const prefix of LEGACY_STATE_KEYS) {
                    stateCandidates.push(`${prefix}:${scope}`);
                }

                if (scope !== 'local') {
                    stateCandidates.push('tasks_app_data_v2');
                }

                const legacyStateKey = stateCandidates.find((candidate) => localStorage.getItem(candidate));
                if (legacyStateKey) {
                    localStorage.setItem(getStorageKey(scope), localStorage.getItem(legacyStateKey));
                }
            }

            if (enableOfflineQueue && !localStorage.getItem(getQueueKey(scope))) {
                const queueCandidates = [];

                for (const prefix of LEGACY_QUEUE_KEYS) {
                    queueCandidates.push(`${prefix}:${scope}`);
                }

                if (scope !== 'local') {
                    queueCandidates.push('tasks_offline_queue');
                }

                const legacyQueueKey = queueCandidates.find((candidate) => localStorage.getItem(candidate));
                if (legacyQueueKey) {
                    localStorage.setItem(getQueueKey(scope), localStorage.getItem(legacyQueueKey));
                    queueCache = null;
                    queueCacheKey = '';
                }
            }
        } catch (error) {
            console.warn('[Storage] Legacy migration skipped:', error);
        }
    }

    function hydrateLocalState() {
        migrateLegacyScopedData();

        const parsed = canPersistScopedData() ? readJson(getStorageKey()) : null;
        if (parsed) {
            replaceState(parsed, { persist: false });
            return;
        }

        const nextState = createDefaultState();
        replaceState(nextState, { persist: canPersistScopedData() });
    }

    function updateHydratedSyncStatus() {
        const queue = getQueue();
        if (enableOfflineQueue && queue.length > 0) {
            setQueueStatus(queue);
            return;
        }

        updateSyncStatus({
            pending: queue.length,
            phase: supabase
                ? (!isOnline() ? 'offline' : 'idle')
                : 'local',
            error: ''
        });
    }

    function shouldKeepCachedUserDuringBootstrap(error = null) {
        if (!enableOfflineQueue || !currentUser) {
            return false;
        }

        if (!isOnline()) {
            return true;
        }

        return Boolean(error) && isNetworkLikeError(error);
    }

    async function restoreCachedUserState() {
        if (!enableOfflineQueue) {
            return false;
        }

        const cachedUser = readStoredUserHint();
        if (!cachedUser) {
            return false;
        }

        stopRealtime();
        currentUser = cachedUser;
        hasAuthenticatedSession = false;
        emitAuth();
        hydrateLocalState();
        await ensureBuiltInLists();
        updateHydratedSyncStatus();
        return true;
    }

    function findList(listId) {
        return state.lists.find((list) => list.id === listId) || null;
    }

    function findListIndexByName(name) {
        const normalizedName = normalizeListName(name);
        return state.lists.findIndex((list) => normalizeListName(list.name) === normalizedName);
    }

    function findTaskEntry(taskId) {
        for (const list of state.lists) {
            const taskIndex = list.tasks.findIndex((task) => task.id === taskId);
            if (taskIndex !== -1) {
                return {
                    list,
                    task: list.tasks[taskIndex],
                    taskIndex
                };
            }
        }

        return null;
    }

    function sortListTasks(list) {
        list.tasks = sortTasksForDisplay(list.tasks);
    }

    function getPositionValue(task, fallbackIndex) {
        const position = normalizePosition(task?.position);
        if (position !== null) {
            return position;
        }
        return (fallbackIndex + 1) * POSITION_STEP;
    }

    function getNextPositionForIndex(tasks, targetIndex) {
        const orderedTasks = sortTasksForDisplay(tasks);
        const clampedIndex = Math.max(0, Math.min(targetIndex, orderedTasks.length));
        const previousTask = clampedIndex > 0 ? orderedTasks[clampedIndex - 1] : null;
        const nextTask = clampedIndex < orderedTasks.length ? orderedTasks[clampedIndex] : null;

        if (!previousTask && !nextTask) {
            return POSITION_STEP;
        }

        if (!previousTask) {
            return getPositionValue(nextTask, 0) - POSITION_STEP;
        }

        if (!nextTask) {
            return getPositionValue(previousTask, orderedTasks.length - 1) + POSITION_STEP;
        }

        const previousPosition = getPositionValue(previousTask, clampedIndex - 1);
        const nextPosition = getPositionValue(nextTask, clampedIndex);
        return (previousPosition + nextPosition) / 2;
    }

    function getNextListPositionForIndex(lists, targetIndex) {
        const orderedLists = sortListsForDisplay(lists);
        const clampedIndex = Math.max(0, Math.min(targetIndex, orderedLists.length));
        const previousList = clampedIndex > 0 ? orderedLists[clampedIndex - 1] : null;
        const nextList = clampedIndex < orderedLists.length ? orderedLists[clampedIndex] : null;

        if (!previousList && !nextList) {
            return POSITION_STEP;
        }

        if (!previousList) {
            return getPositionValue(nextList, 0) - POSITION_STEP;
        }

        if (!nextList) {
            return getPositionValue(previousList, orderedLists.length - 1) + POSITION_STEP;
        }

        const previousPosition = getPositionValue(previousList, clampedIndex - 1);
        const nextPosition = getPositionValue(nextList, clampedIndex);
        return (previousPosition + nextPosition) / 2;
    }

    function applySyncedListMeta(listId, data) {
        const list = findList(listId);
        if (!list || !data) {
            return false;
        }

        list.version = normalizeVersion(data.version);
        if (data.updated_at) {
            list.updatedAt = data.updated_at;
        }
        return true;
    }

    function applySyncedTaskMeta(taskId, data) {
        const entry = findTaskEntry(taskId);
        if (!entry || !data) {
            return false;
        }

        entry.task.version = normalizeVersion(data.version);
        if (data.updated_at) {
            entry.task.updatedAt = data.updated_at;
        }
        return true;
    }

    function getConflictMessage(operation, remoteRecord) {
        const entity = operation.type.includes('_task') ? 'task' : 'list';
        if (!remoteRecord) {
            return `This ${entity} was removed on another device. Latest server state was kept.`;
        }
        if (operation.type.startsWith('delete_')) {
            return `This ${entity} changed on another device before deletion. Latest server state was kept.`;
        }
        return `This ${entity} changed on another device. Latest server state was kept.`;
    }

    async function fetchRemoteRecord(table, id) {
        if (!canSyncRemotely()) {
            return null;
        }

        const { data, error } = await supabase
            .from(table)
            .select('id, version, updated_at')
            .eq('id', id)
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return data;
    }

    function enqueueOperation(operation) {
        if (!enableOfflineQueue || !supabase || !currentUser) {
            return false;
        }

        const queue = getQueue();
        const nextOperation = {
            retryCount: 0,
            lastError: '',
            lastAttemptAt: 0,
            timestamp: Date.now(),
            opId: uid(),
            ...operation
        };

        if (
            nextOperation.data &&
            !nextOperation.data.user_id &&
            (nextOperation.type === 'insert_task' || nextOperation.type === 'insert_list')
        ) {
            nextOperation.data = { ...nextOperation.data, user_id: currentUser.id };
        }

        if (nextOperation.type === 'update_task' && nextOperation.taskId) {
            const pendingInsertIndex = queue.findIndex((queued) => queued.type === 'insert_task' && queued.data?.id === nextOperation.taskId);
            if (pendingInsertIndex !== -1) {
                queue[pendingInsertIndex] = {
                    ...queue[pendingInsertIndex],
                    data: { ...queue[pendingInsertIndex].data, ...nextOperation.data },
                    listId: nextOperation.listId || queue[pendingInsertIndex].listId,
                    timestamp: Date.now(),
                    opId: uid(),
                    retryCount: 0,
                    lastError: '',
                    lastAttemptAt: 0
                };
                persistQueue(queue);
                setQueueStatus(queue);
                scheduleQueuedSync();
                return true;
            }

            const pendingUpdateIndex = queue.findIndex((queued) => queued.type === 'update_task' && queued.taskId === nextOperation.taskId);
            if (pendingUpdateIndex !== -1) {
                queue[pendingUpdateIndex] = {
                    ...queue[pendingUpdateIndex],
                    data: { ...queue[pendingUpdateIndex].data, ...nextOperation.data },
                    listId: nextOperation.listId || queue[pendingUpdateIndex].listId,
                    expectedVersion: queue[pendingUpdateIndex].expectedVersion ?? nextOperation.expectedVersion,
                    timestamp: Date.now(),
                    opId: uid(),
                    retryCount: 0,
                    lastError: '',
                    lastAttemptAt: 0
                };
                persistQueue(queue);
                setQueueStatus(queue);
                scheduleQueuedSync();
                return true;
            }
        }

        if (nextOperation.type === 'update_list' && nextOperation.listId) {
            const pendingInsertIndex = queue.findIndex((queued) => queued.type === 'insert_list' && queued.data?.id === nextOperation.listId);
            if (pendingInsertIndex !== -1) {
                queue[pendingInsertIndex] = {
                    ...queue[pendingInsertIndex],
                    data: { ...queue[pendingInsertIndex].data, ...nextOperation.data },
                    timestamp: Date.now(),
                    opId: uid(),
                    retryCount: 0,
                    lastError: '',
                    lastAttemptAt: 0
                };
                persistQueue(queue);
                setQueueStatus(queue);
                scheduleQueuedSync();
                return true;
            }

            const pendingUpdateIndex = queue.findIndex((queued) => queued.type === 'update_list' && queued.listId === nextOperation.listId);
            if (pendingUpdateIndex !== -1) {
                queue[pendingUpdateIndex] = {
                    ...queue[pendingUpdateIndex],
                    data: { ...queue[pendingUpdateIndex].data, ...nextOperation.data },
                    expectedVersion: queue[pendingUpdateIndex].expectedVersion ?? nextOperation.expectedVersion,
                    timestamp: Date.now(),
                    opId: uid(),
                    retryCount: 0,
                    lastError: '',
                    lastAttemptAt: 0
                };
                persistQueue(queue);
                setQueueStatus(queue);
                scheduleQueuedSync();
                return true;
            }
        }

        if (nextOperation.type === 'delete_task' && nextOperation.taskId) {
            const hadPendingInsert = queue.some((queued) => queued.type === 'insert_task' && queued.data?.id === nextOperation.taskId);
            const filteredQueue = queue.filter((queued) => {
                if (queued.type === 'insert_task' && queued.data?.id === nextOperation.taskId) {
                    return false;
                }
                if ((queued.type === 'update_task' || queued.type === 'delete_task') && queued.taskId === nextOperation.taskId) {
                    return false;
                }
                return true;
            });

            if (filteredQueue.length !== queue.length) {
                persistQueue(filteredQueue);
                setQueueStatus(filteredQueue);
                scheduleQueuedSync();
                if (hadPendingInsert) {
                    return true;
                }
                queue.length = 0;
                queue.push(...filteredQueue);
            }
        }

        if (nextOperation.type === 'delete_list' && nextOperation.listId) {
            const deletedTaskIds = new Set(nextOperation.taskIds || []);
            const hadPendingInsert = queue.some((queued) => queued.type === 'insert_list' && queued.data?.id === nextOperation.listId);
            const filteredQueue = queue.filter((queued) => {
                if (queued.type === 'insert_list' && queued.data?.id === nextOperation.listId) {
                    return false;
                }
                if ((queued.type === 'update_list' || queued.type === 'delete_list') && queued.listId === nextOperation.listId) {
                    return false;
                }
                const queuedTaskId = queued.taskId || queued.data?.id;
                if (queuedTaskId && deletedTaskIds.has(queuedTaskId)) {
                    return false;
                }
                return true;
            });

            if (filteredQueue.length !== queue.length) {
                persistQueue(filteredQueue);
                setQueueStatus(filteredQueue);
                scheduleQueuedSync();
                if (hadPendingInsert) {
                    return true;
                }
                queue.length = 0;
                queue.push(...filteredQueue);
            }
        }

        queue.push(nextOperation);
        queue.sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));
        persistQueue(queue);
        setQueueStatus(queue);
        scheduleQueuedSync({ delayMs: 250 });
        return true;
    }

    async function executeRemoteOperation(operation, { deferStateSideEffects = false } = {}) {
        const applyMeta = (didApply) => {
            if (didApply && !deferStateSideEffects) {
                persistState();
                emitState();
            }
            return didApply;
        };

        if (!canSyncRemotely()) {
            return { conflictMessage: '', appliedMeta: false };
        }

        if (operation.type === 'insert_list') {
            const { data, error } = await supabase
                .from('lists')
                .upsert({ ...operation.data, user_id: currentUser.id })
                .select('id, version, updated_at')
                .single();

            if (error) {
                throw error;
            }

            return { conflictMessage: '', appliedMeta: applyMeta(applySyncedListMeta(operation.listId, data)) };
        }

        if (operation.type === 'update_list') {
            const { data, error } = await supabase
                .from('lists')
                .update(operation.data)
                .eq('id', operation.listId)
                .eq('user_id', currentUser.id)
                .eq('version', operation.expectedVersion ?? 0)
                .select('id, version, updated_at')
                .maybeSingle();

            if (error) {
                throw error;
            }

            if (!data) {
                const remoteRecord = await fetchRemoteRecord('lists', operation.listId);
                return { conflictMessage: getConflictMessage(operation, remoteRecord), appliedMeta: false };
            }

            return { conflictMessage: '', appliedMeta: applyMeta(applySyncedListMeta(operation.listId, data)) };
        }

        if (operation.type === 'delete_list') {
            let deleteAttempt = await supabase
                .from('lists')
                .delete()
                .eq('id', operation.listId)
                .eq('user_id', currentUser.id)
                .eq('version', operation.expectedVersion ?? 0)
                .select('id')
                .maybeSingle();

            if (deleteAttempt.error && deleteAttempt.error.code === '23503') {
                const { error: taskDeleteError } = await supabase
                    .from('tasks')
                    .delete()
                    .eq('list_id', operation.listId)
                    .eq('user_id', currentUser.id);

                if (taskDeleteError) {
                    throw taskDeleteError;
                }

                deleteAttempt = await supabase
                    .from('lists')
                    .delete()
                    .eq('id', operation.listId)
                    .eq('user_id', currentUser.id)
                    .eq('version', operation.expectedVersion ?? 0)
                    .select('id')
                    .maybeSingle();
            }

            if (deleteAttempt.error) {
                throw deleteAttempt.error;
            }

            if (!deleteAttempt.data) {
                const remoteRecord = await fetchRemoteRecord('lists', operation.listId);
                // Already gone on the server: deletion is idempotent, so a
                // record another device removed first is success, not conflict.
                if (!remoteRecord) {
                    return { conflictMessage: '', appliedMeta: false };
                }
                return { conflictMessage: getConflictMessage(operation, remoteRecord), appliedMeta: false };
            }

            return { conflictMessage: '', appliedMeta: false };
        }

        if (operation.type === 'insert_task') {
            const { data, error } = await supabase
                .from('tasks')
                .upsert({ ...operation.data, user_id: currentUser.id })
                .select('id, version, updated_at')
                .single();

            if (error) {
                throw error;
            }

            return { conflictMessage: '', appliedMeta: applyMeta(applySyncedTaskMeta(operation.taskId, data)) };
        }

        if (operation.type === 'update_task') {
            const { data, error } = await supabase
                .from('tasks')
                .update(operation.data)
                .eq('id', operation.taskId)
                .eq('user_id', currentUser.id)
                .eq('version', operation.expectedVersion ?? 0)
                .select('id, version, updated_at')
                .maybeSingle();

            if (error) {
                throw error;
            }

            if (!data) {
                const remoteRecord = await fetchRemoteRecord('tasks', operation.taskId);
                return { conflictMessage: getConflictMessage(operation, remoteRecord), appliedMeta: false };
            }

            return { conflictMessage: '', appliedMeta: applyMeta(applySyncedTaskMeta(operation.taskId, data)) };
        }

        if (operation.type === 'delete_task') {
            const { data, error } = await supabase
                .from('tasks')
                .delete()
                .eq('id', operation.taskId)
                .eq('user_id', currentUser.id)
                .eq('version', operation.expectedVersion ?? 0)
                .select('id')
                .maybeSingle();

            if (error) {
                throw error;
            }

            if (!data) {
                const remoteRecord = await fetchRemoteRecord('tasks', operation.taskId);
                // Idempotent delete: both devices reap expired completed
                // tasks, so "already deleted elsewhere" is success.
                if (!remoteRecord) {
                    return { conflictMessage: '', appliedMeta: false };
                }
                return { conflictMessage: getConflictMessage(operation, remoteRecord), appliedMeta: false };
            }

            return { conflictMessage: '', appliedMeta: false };
        }

        return { conflictMessage: '', appliedMeta: false };
    }

    async function commitMutation(operation, applyLocalMutation) {
        const previousState = cloneStateSnapshot(state);

        applyLocalMutation();
        replaceState(state);

        if (!supabase || !currentUser) {
            return { ok: true, queued: false, conflict: false };
        }

        if (enableOfflineQueue && (!isOnline() || !hasAuthenticatedSession)) {
            enqueueOperation(operation);
            return { ok: true, queued: true, conflict: false };
        }

        if (hasQueuedOperationBlocking(operation)) {
            enqueueOperation(operation);
            return { ok: true, queued: true, conflict: false };
        }

        activeRemoteWrites += 1;
        updateSyncStatus({
            pending: getQueue().length,
            phase: 'syncing',
            error: ''
        });

        try {
            const result = await runExclusivelyForEntity(
                getOperationEntityKey(operation),
                () => executeRemoteOperation(withLiveExpectedVersion(operation))
            );

            if (result.conflictMessage) {
                await refreshFromRemote({ force: true });
                updateSyncStatus({
                    pending: getQueue().length,
                    phase: 'error',
                    error: result.conflictMessage
                });
                return { ok: false, queued: false, conflict: true };
            }

            updateSyncStatus({
                pending: getQueue().length,
                phase: getQueue().length > 0 ? 'queued' : 'synced',
                error: '',
                lastSuccessAt: Date.now()
            });
            return { ok: true, queued: false, conflict: false };
        } catch (error) {
            if (enableOfflineQueue && isNetworkLikeError(error)) {
                enqueueOperation(operation);
                return { ok: true, queued: true, conflict: false };
            }

            replaceState(previousState);
            updateSyncStatus({
                pending: getQueue().length,
                phase: isOnline() ? 'error' : 'offline',
                error: formatErrorMessage(error, 'Unable to save your change.')
            });
            return { ok: false, queued: false, conflict: false, error };
        } finally {
            activeRemoteWrites = Math.max(0, activeRemoteWrites - 1);
        }
    }

    async function refreshFromRemote({ force = false } = {}) {
        if (!canSyncRemotely()) {
            return true;
        }

        const queueLength = getQueue().length;
        if (enableOfflineQueue && !force && (queueLength > 0 || isFlushingQueue)) {
            setQueueStatus(getQueue());
            return true;
        }

        for (const delay of REMOTE_REFRESH_RETRY_DELAYS_MS) {
            if (delay > 0) {
                await sleep(delay);
            }

            try {
                const { data, error } = await supabase
                    .from('lists')
                    .select('*, tasks(*)')
                    .eq('user_id', currentUser.id)
                    .order('created_at', { ascending: true });

                if (error) {
                    throw error;
                }

                const latestQueueLength = getQueue().length;
                if (enableOfflineQueue && !force && (latestQueueLength > 0 || isFlushingQueue)) {
                    setQueueStatus(getQueue());
                    return true;
                }

                const previousView = state.activeView;
                const nextState = normalizeStateSnapshot({
                    activeView: previousView,
                    lists: Array.isArray(data) ? data.map(normalizeList) : []
                });

                if (nextState.activeView !== 'all' && !nextState.lists.some((list) => list.id === nextState.activeView)) {
                    nextState.activeView = 'all';
                }

                // Skip the state swap (and the full re-render it triggers) when
                // the server matches what we already have.
                if (JSON.stringify(nextState) !== JSON.stringify(normalizeStateSnapshot(state))) {
                    replaceState(nextState);
                }
                updateSyncStatus({
                    pending: latestQueueLength,
                    phase: latestQueueLength > 0 ? 'queued' : 'synced',
                    error: '',
                    lastSuccessAt: Date.now()
                });
                return true;
            } catch (error) {
                console.warn('[Sync] Remote refresh failed:', error);
            }
        }

        updateSyncStatus({
            pending: getQueue().length,
            phase: isOnline() ? 'error' : 'offline',
            error: 'Unable to refresh from Supabase right now.'
        });
        return false;
    }

    async function flushQueue({ stabilize = false } = {}) {
        if (!enableOfflineQueue || !canSyncRemotely()) {
            return { completed: true, hadConflicts: false, conflictMessage: '' };
        }

        const queue = getQueue();
        if (queue.length === 0) {
            return { completed: true, hadConflicts: false, conflictMessage: '' };
        }

        if (!isOnline()) {
            setQueueStatus(queue);
            return { completed: false, hadConflicts: false, conflictMessage: '' };
        }

        if (isFlushingQueue) {
            return { completed: false, hadConflicts: false, conflictMessage: '' };
        }

        isFlushingQueue = true;

        if (stabilize) {
            await sleep(MOBILE_RECONNECT_SETTLE_MS);
        }

        updateSyncStatus({
            pending: queue.length,
            phase: 'syncing',
            error: ''
        });

        const now = Date.now();
        const conflicts = [];
        const outcomes = new Map();
        let didApplyRemoteMeta = false;

        try {
            const readyOperations = [];
            for (const operation of queue) {
                if (shouldAttemptQueuedOperation(operation, now)) {
                    readyOperations.push(operation);
                } else {
                    outcomes.set(operation.opId, { status: 'deferred' });
                }
            }

            // Coalescing keeps at most one queued op per entity, so ops only
            // depend on each other across phases: lists must exist before their
            // tasks sync, and task moves out of a doomed list must land before
            // that list's delete cascades. Within a phase, run in parallel.
            const phases = [
                readyOperations.filter((operation) => operation.type === 'insert_list' || operation.type === 'update_list'),
                readyOperations.filter((operation) => operation.type !== 'insert_list' && operation.type !== 'update_list' && operation.type !== 'delete_list'),
                readyOperations.filter((operation) => operation.type === 'delete_list')
            ];

            for (const phaseOperations of phases) {
                await runWithConcurrencyLimit(phaseOperations, QUEUE_FLUSH_CONCURRENCY, async (operation) => {
                    activeRemoteWrites += 1;
                    try {
                        const result = await executeRemoteOperation(operation, { deferStateSideEffects: true });
                        if (result.conflictMessage) {
                            conflicts.push(result.conflictMessage);
                        }
                        if (result.appliedMeta) {
                            didApplyRemoteMeta = true;
                        }
                        outcomes.set(operation.opId, { status: 'done' });
                    } catch (error) {
                        outcomes.set(operation.opId, { status: 'failed', operation: markQueuedOperationFailed(operation, error) });
                    } finally {
                        activeRemoteWrites = Math.max(0, activeRemoteWrites - 1);
                    }
                });
            }

            if (didApplyRemoteMeta) {
                persistState();
                emitState();
            }

            // Rebuild from storage, not from our snapshot: ops enqueued or
            // coalesced while this flush was in flight carry opIds we never
            // saw and must survive untouched.
            const nextQueue = getQueue()
                .map((storedOperation) => {
                    const outcome = outcomes.get(storedOperation.opId);
                    if (!outcome) {
                        return storedOperation;
                    }
                    if (outcome.status === 'done') {
                        return null;
                    }
                    if (outcome.status === 'failed') {
                        return outcome.operation;
                    }
                    return storedOperation;
                })
                .filter(Boolean)
                .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));

            persistQueue(nextQueue);

            if (nextQueue.length === 0) {
                clearQueuedSyncTimer();
                if (conflicts.length > 0) {
                    await refreshFromRemote({ force: true });
                    updateSyncStatus({
                        pending: 0,
                        phase: 'error',
                        error: conflicts[0],
                        lastSuccessAt: Date.now()
                    });
                } else {
                    updateSyncStatus({
                        pending: 0,
                        phase: 'synced',
                        error: '',
                        lastSuccessAt: Date.now()
                    });
                }

                return {
                    completed: true,
                    hadConflicts: conflicts.length > 0,
                    conflictMessage: conflicts[0] || ''
                };
            }

            const firstError = nextQueue.find((operation) => operation.lastError && !isOperationInNetworkFastRetry(operation));
            updateSyncStatus({
                pending: nextQueue.length,
                phase: isOnline() ? (firstError ? 'error' : 'queued') : 'offline',
                error: firstError ? firstError.lastError : (conflicts[0] || '')
            });
            scheduleQueuedSync();

            return {
                completed: false,
                hadConflicts: conflicts.length > 0,
                conflictMessage: conflicts[0] || ''
            };
        } finally {
            isFlushingQueue = false;
        }
    }

    async function waitForActiveWrites() {
        while (activeRemoteWrites > 0) {
            await sleep(100);
        }
    }

    // True when the local state already contains what this event describes —
    // i.e. the event is an echo of this device's own write. Versions only ever
    // come from the server, so local >= remote means "already applied".
    function isRealtimeEventReflected({ table, payload }) {
        const eventType = payload?.eventType;
        if (eventType === 'DELETE') {
            const deletedId = payload?.old?.id;
            if (!deletedId) {
                return false;
            }
            return table === 'lists' ? !findList(deletedId) : !findTaskEntry(deletedId);
        }

        const row = payload?.new;
        if (!row || !row.id || row.version === undefined || row.version === null) {
            return false;
        }

        if (table === 'lists') {
            const list = findList(row.id);
            return Boolean(list) && normalizeVersion(list.version) >= normalizeVersion(row.version);
        }

        const entry = findTaskEntry(row.id);
        return Boolean(entry)
            && normalizeVersion(entry.task.version) >= normalizeVersion(row.version)
            && entry.list.id === row.list_id;
    }

    function handleRealtimeEvent(table, payload) {
        if (!canSyncRemotely()) {
            return;
        }

        // Events during a queue flush are covered by the forced refresh that
        // follows the flush in syncNow.
        if (enableOfflineQueue && (getQueue().length > 0 || isFlushingQueue)) {
            return;
        }

        if (pendingRealtimeEvents.length >= REALTIME_MAX_PENDING_EVENTS) {
            realtimeEventsOverflowed = true;
            pendingRealtimeEvents = [];
        } else if (!realtimeEventsOverflowed) {
            pendingRealtimeEvents.push({ table, payload });
        }

        scheduleRealtimeRefresh();
    }

    function scheduleRealtimeRefresh() {
        if (!canSyncRemotely()) {
            return;
        }

        if (realtimeRefreshTimer) {
            clearTimeout(realtimeRefreshTimer);
        }

        realtimeRefreshTimer = setTimeout(async () => {
            realtimeRefreshTimer = null;

            if (isSyncing || activeRemoteWrites > 0) {
                scheduleRealtimeRefresh();
                return;
            }

            const events = pendingRealtimeEvents;
            const mustRefresh = realtimeEventsOverflowed;
            pendingRealtimeEvents = [];
            realtimeEventsOverflowed = false;

            // Echoes of our own writes carry versions we already applied from
            // the write response — skip the refetch and re-render entirely.
            if (!mustRefresh && events.length > 0 && events.every(isRealtimeEventReflected)) {
                return;
            }

            await refreshFromRemote();
        }, 300);
    }

    function stopRealtime() {
        if (realtimeRefreshTimer) {
            clearTimeout(realtimeRefreshTimer);
            realtimeRefreshTimer = null;
        }

        if (realtimeRetryTimer) {
            clearTimeout(realtimeRetryTimer);
            realtimeRetryTimer = null;
        }

        pendingRealtimeEvents = [];
        realtimeEventsOverflowed = false;

        if (realtimeChannel) {
            const channel = realtimeChannel;
            realtimeChannel = null;
            channel.unsubscribe();
        }
    }

    function scheduleRealtimeRestart() {
        if (realtimeRetryTimer) {
            return;
        }

        realtimeRetryCount += 1;
        const delayMs = Math.min(1000 * 2 ** Math.min(realtimeRetryCount - 1, 5), REALTIME_RETRY_MAX_DELAY_MS);
        realtimeRetryTimer = setTimeout(() => {
            realtimeRetryTimer = null;
            if (!canSyncRemotely() || !isOnline()) {
                return;
            }
            startRealtime();
        }, delayMs);
    }

    function startRealtime() {
        if (!canSyncRemotely()) {
            return;
        }

        stopRealtime();

        const filter = `user_id=eq.${currentUser.id}`;
        const channel = supabase
            .channel(`tasks-db-${currentUser.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'lists', filter }, (payload) => handleRealtimeEvent('lists', payload))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter }, (payload) => handleRealtimeEvent('tasks', payload));

        realtimeChannel = channel;
        channel.subscribe((status) => {
            if (channel !== realtimeChannel) {
                return;
            }

            console.log('[Realtime]', status);

            if (status === 'SUBSCRIBED') {
                const wasRecovering = realtimeRetryCount > 0;
                realtimeRetryCount = 0;
                if (wasRecovering) {
                    // Anything could have changed while the channel was dead.
                    realtimeEventsOverflowed = true;
                    scheduleRealtimeRefresh();
                }
                return;
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                scheduleRealtimeRestart();
            }
        });
    }

    async function syncNow({ stabilize = false } = {}) {
        if (!supabase || !currentUser) {
            return false;
        }

        if (!hasAuthenticatedSession) {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user) {
                    await activateUser(session.user, {
                        sync: false,
                        sessionConfirmed: true,
                        suppressAutoSync: true
                    });
                } else if (!isOnline()) {
                    updateHydratedSyncStatus();
                    return false;
                } else {
                    updateSyncStatus({
                        pending: getQueue().length,
                        phase: getQueue().length > 0 ? 'error' : 'idle',
                        error: getQueue().length > 0 ? 'Sign in again to sync your queued changes.' : ''
                    });
                    return false;
                }
            } catch (error) {
                if (isNetworkLikeError(error)) {
                    updateHydratedSyncStatus();
                    return false;
                }

                updateSyncStatus({
                    pending: getQueue().length,
                    phase: 'error',
                    error: formatErrorMessage(error, 'Sign in again to sync your queued changes.')
                });
                return false;
            }
        }

        if (!isOnline()) {
            if (enableOfflineQueue && getQueue().length > 0) {
                setQueueStatus(getQueue());
            } else {
                updateSyncStatus({
                    pending: getQueue().length,
                    phase: 'offline',
                    error: ''
                });
            }
            return false;
        }

        if (isSyncing) {
            return false;
        }

        isSyncing = true;

        try {
            await waitForActiveWrites();

            const queueResult = await flushQueue({ stabilize });
            if (enableOfflineQueue && getQueue().length > 0) {
                return false;
            }

            const didRefresh = await refreshFromRemote({ force: true });

            // Zero lists after a successful refresh can only mean a fresh
            // account: the built-in lists refuse deletion, so any account
            // that has ever used the app keeps at least those on the server.
            if (didRefresh && state.lists.length === 0) {
                await seedDefaultLists();
            }

            if (queueResult.hadConflicts) {
                updateSyncStatus({
                    pending: getQueue().length,
                    phase: 'error',
                    error: queueResult.conflictMessage
                });
            }

            return didRefresh;
        } finally {
            isSyncing = false;
        }
    }

    async function activateUser(user, { sync = false, sessionConfirmed = true, suppressAutoSync = false } = {}) {
        const userChanged = user?.id !== currentUser?.id;
        currentUser = user;
        hasAuthenticatedSession = sessionConfirmed;
        persistUserHint(user);
        emitAuth();
        hydrateLocalState();
        await ensureBuiltInLists();
        if (sessionConfirmed) {
            startRealtime();
        } else {
            stopRealtime();
        }

        if (!suppressAutoSync && sessionConfirmed && (sync || userChanged)) {
            await syncNow({ stabilize: enableOfflineQueue });
        } else if (enableOfflineQueue && getQueue().length > 0) {
            setQueueStatus(getQueue());
            scheduleQueuedSync();
        } else {
            updateHydratedSyncStatus();
        }
    }

    async function deactivateUser({ clearCachedUser = true } = {}) {
        stopRealtime();
        clearQueuedSyncTimer();
        currentUser = null;
        hasAuthenticatedSession = false;
        if (clearCachedUser) {
            persistUserHint(null);
        }
        emitAuth();
        replaceState({ lists: [], activeView: 'all' }, { persist: false });
        updateSyncStatus({
            pending: 0,
            phase: supabase ? 'idle' : 'local',
            error: '',
            lastSuccessAt: 0
        });
    }

    async function bootstrap() {
        if (!supabase) {
            hydrateLocalState();
            await ensureBuiltInLists();
            emitAuth();
            updateSyncStatus({
                pending: 0,
                phase: 'local',
                error: ''
            });
            return;
        }

        await restoreCachedUserState();

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                await activateUser(session.user, { sync: true, sessionConfirmed: true });
            } else if (shouldKeepCachedUserDuringBootstrap()) {
                updateHydratedSyncStatus();
            } else {
                await deactivateUser();
            }
        } catch (error) {
            console.warn('[Auth] Session bootstrap failed:', error);
            if (shouldKeepCachedUserDuringBootstrap(error)) {
                updateHydratedSyncStatus();
            } else {
                await deactivateUser();
            }
        }

        supabase.auth.onAuthStateChange((event, session) => {
            // supabase-js holds an internal auth lock while these callbacks
            // run; issuing Supabase calls (the sync) inside it can deadlock.
            // Defer to a fresh task so the lock is released first.
            setTimeout(() => {
                (async () => {
                    if (session?.user) {
                        const shouldSync = event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED';
                        await activateUser(session.user, { sync: shouldSync, sessionConfirmed: true });
                        return;
                    }

                    if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
                        await deactivateUser();
                    }
                })().catch((error) => {
                    console.warn('[Auth] State change handling failed:', error);
                });
            }, 0);
        });
    }

    async function signIn(email, password) {
        if (!supabase) {
            return new Error('Supabase is not configured.');
        }

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error || null;
    }

    async function signOut() {
        if (!supabase) {
            return;
        }
        await supabase.auth.signOut();
    }

    function setActiveView(activeView) {
        state.activeView = activeView;
        replaceState(state);
    }

    async function createList(name, options = {}) {
        if (isBuiltInListName(name)) {
            const existingIndex = findListIndexByName(name);
            if (existingIndex !== -1) {
                return {
                    ok: true,
                    skipped: true,
                    listId: state.lists[existingIndex].id
                };
            }
        }

        const listId = uid();
        const createdAt = new Date().toISOString();
        const requestedIndex = Number(options.targetIndex);
        const targetIndex = Number.isFinite(requestedIndex)
            ? Math.max(0, Math.min(Math.trunc(requestedIndex), state.lists.length))
            : state.lists.length;
        const position = getNextListPositionForIndex(state.lists, targetIndex);
        const newList = {
            id: listId,
            name,
            tasks: [],
            createdAt,
            updatedAt: createdAt,
            version: 0,
            position
        };

        const operation = {
            type: 'insert_list',
            listId,
            data: {
                id: listId,
                name,
                created_at: createdAt,
                updated_at: createdAt,
                position,
                user_id: currentUser?.id || null
            }
        };

        return commitMutation(operation, () => {
            state.lists.push(newList);
        });
    }

    async function ensureBuiltInList(name, { afterName = '', setupKey = '' } = {}) {
        if (findListIndexByName(name) !== -1) {
            if (setupKey) {
                markBuiltInEnsured(setupKey);
            }
            return { ok: true, skipped: true };
        }

        if (setupKey && readBuiltInSetup()[setupKey]) {
            return { ok: true, skipped: true };
        }

        const afterIndex = afterName ? findListIndexByName(afterName) : -1;
        const targetIndex = afterIndex === -1 ? state.lists.length : afterIndex + 1;
        const result = await createList(name, { targetIndex });

        if (setupKey && result?.ok) {
            markBuiltInEnsured(setupKey);
        }

        return result;
    }

    async function ensureBuiltInLists() {
        await ensureBuiltInList(UPCOMING_LIST_NAME, {
            afterName: TODAY_LIST_NAME,
            setupKey: UPCOMING_SETUP_KEY
        });
    }

    // First sign-in of a brand-new account: hydrate seeds the default lists
    // locally, but the first forced refresh replaces them with the server's
    // emptiness. Recreate them through createList so they become real server
    // rows. Sequential on purpose — createList positions each list after the
    // previous one, which keeps the starter order stable.
    async function seedDefaultLists() {
        for (const name of DEFAULT_LIST_NAMES) {
            await createList(name);
        }
    }

    async function renameList(listId, name) {
        const list = findList(listId);
        if (!list) {
            return { ok: false };
        }
        if (isBuiltInListName(list.name) || isBuiltInListName(name)) {
            return { ok: false, blocked: true };
        }

        const updatedAt = new Date().toISOString();
        const operation = {
            type: 'update_list',
            listId,
            expectedVersion: list.version ?? 0,
            data: {
                name,
                updated_at: updatedAt
            }
        };

        return commitMutation(operation, () => {
            list.name = name;
            list.updatedAt = updatedAt;
        });
    }

    async function deleteList(listId) {
        const list = findList(listId);
        if (!list) {
            return { ok: false };
        }
        if (isBuiltInListName(list.name)) {
            return { ok: false, blocked: true };
        }

        const operation = {
            type: 'delete_list',
            listId,
            expectedVersion: list.version ?? 0,
            taskIds: list.tasks.map((task) => task.id)
        };

        return commitMutation(operation, () => {
            state.lists = state.lists.filter((candidate) => candidate.id !== listId);
            if (state.activeView === listId) {
                state.activeView = 'all';
            }
        });
    }

    async function addTask(listId, text, date = '') {
        const list = findList(listId);
        if (!list) {
            return { ok: false };
        }

        const taskId = uid();
        const createdAt = new Date().toISOString();
        const position = getNextPositionForIndex(list.tasks, 0);
        const newTask = {
            id: taskId,
            text,
            details: '',
            date,
            time: '',
            createdAt,
            updatedAt: createdAt,
            version: 0,
            position,
            todayPosition: null,
            completedAt: ''
        };

        const operation = {
            type: 'insert_task',
            taskId,
            listId,
            data: {
                id: taskId,
                list_id: listId,
                title: text,
                due_date: date || null,
                notes: '',
                position,
                created_at: createdAt,
                updated_at: createdAt,
                user_id: currentUser?.id || null
            }
        };

        return commitMutation(operation, () => {
            list.tasks.unshift(newTask);
            sortListTasks(list);
        });
    }

    function buildTaskUpdateData(updates, updatedAt) {
        return {
            ...(updates.text !== undefined ? { title: updates.text } : {}),
            ...(updates.details !== undefined ? { notes: updates.details } : {}),
            ...(updates.date !== undefined ? { due_date: updates.date || null } : {}),
            ...(updates.time !== undefined ? { due_time: updates.time || null } : {}),
            ...(updates.position !== undefined ? { position: updates.position } : {}),
            ...(updates.todayPosition !== undefined ? { today_position: updates.todayPosition } : {}),
            ...(updates.completedAt !== undefined ? { completed_at: updates.completedAt || null } : {}),
            updated_at: updatedAt
        };
    }

    async function updateTask(listId, taskId, updates) {
        const list = findList(listId);
        if (!list) {
            return { ok: false };
        }

        const task = list.tasks.find((candidate) => candidate.id === taskId);
        if (!task) {
            return { ok: false };
        }

        const updatedAt = new Date().toISOString();
        const operation = {
            type: 'update_task',
            taskId,
            listId,
            expectedVersion: task.version ?? 0,
            data: buildTaskUpdateData(updates, updatedAt)
        };

        return commitMutation(operation, () => {
            Object.assign(task, updates);
            task.updatedAt = updatedAt;
            sortListTasks(list);
        });
    }

    // Multi-row task update as one visual step: every local change lands in a
    // single state swap (one render), then the row writes fan out in
    // parallel. Reorders used to issue sequential updateTask calls, and each
    // one re-rendered a half-updated order — the board visibly shuffled while
    // a drag settled, and realtime refreshes could sneak in between writes.
    async function updateTasksBatch(entries) {
        const updatedAt = new Date().toISOString();
        const operations = [];

        for (const { listId, taskId, updates } of entries) {
            const list = findList(listId);
            const task = list?.tasks.find((candidate) => candidate.id === taskId);
            if (!list || !task) {
                continue;
            }

            operations.push({
                operation: {
                    type: 'update_task',
                    taskId,
                    listId,
                    expectedVersion: task.version ?? 0,
                    data: buildTaskUpdateData(updates, updatedAt)
                },
                apply: () => {
                    Object.assign(task, updates);
                    task.updatedAt = updatedAt;
                    sortListTasks(list);
                }
            });
        }

        if (operations.length === 0) {
            return { ok: true, skipped: true };
        }

        operations.forEach(({ apply }) => apply());
        replaceState(state);

        if (!supabase || !currentUser) {
            return { ok: true, queued: false, conflict: false };
        }

        const mustQueueAll = enableOfflineQueue && (!isOnline() || !hasAuthenticatedSession);
        const directOperations = [];
        for (const { operation } of operations) {
            if (mustQueueAll || hasQueuedOperationBlocking(operation)) {
                enqueueOperation(operation);
            } else {
                directOperations.push(operation);
            }
        }

        if (directOperations.length === 0) {
            return { ok: true, queued: true, conflict: false };
        }

        // Held for the whole batch so realtime echoes defer until every write
        // has reported back — by then the versions are applied and the echoes
        // are recognized as our own.
        activeRemoteWrites += 1;
        updateSyncStatus({
            pending: getQueue().length,
            phase: 'syncing',
            error: ''
        });

        const conflicts = [];
        let didApplyMeta = false;
        let firstError = null;

        try {
            await runWithConcurrencyLimit(directOperations, QUEUE_FLUSH_CONCURRENCY, async (operation) => {
                try {
                    const result = await runExclusivelyForEntity(
                        getOperationEntityKey(operation),
                        () => executeRemoteOperation(withLiveExpectedVersion(operation), { deferStateSideEffects: true })
                    );
                    if (result.conflictMessage) {
                        conflicts.push(result.conflictMessage);
                    }
                    if (result.appliedMeta) {
                        didApplyMeta = true;
                    }
                } catch (error) {
                    if (enableOfflineQueue && isNetworkLikeError(error)) {
                        enqueueOperation(operation);
                        return;
                    }
                    if (!firstError) {
                        firstError = error;
                    }
                }
            });

            // The write responses only updated versions/updated_at — the order
            // on screen is already final. Persist without emitting; a re-render
            // here would rebuild the board (and reset column scroll) for nothing.
            if (didApplyMeta) {
                persistState();
            }

            if (conflicts.length > 0 || firstError) {
                // Other rows in the batch may already be written, so unwinding
                // locally would lie — the server is the one consistent truth.
                await refreshFromRemote({ force: true });
                updateSyncStatus({
                    pending: getQueue().length,
                    phase: isOnline() ? 'error' : 'offline',
                    error: conflicts[0] || formatErrorMessage(firstError, 'Unable to save your changes.')
                });
                return { ok: false, queued: false, conflict: conflicts.length > 0, error: firstError || undefined };
            }

            updateSyncStatus({
                pending: getQueue().length,
                phase: getQueue().length > 0 ? 'queued' : 'synced',
                error: '',
                lastSuccessAt: Date.now()
            });
            return { ok: true, queued: false, conflict: false };
        } finally {
            activeRemoteWrites = Math.max(0, activeRemoteWrites - 1);
        }
    }

    async function deleteTask(listId, taskId) {
        const list = findList(listId);
        if (!list) {
            return { ok: false };
        }

        const task = list.tasks.find((candidate) => candidate.id === taskId);
        if (!task) {
            return { ok: false };
        }

        const operation = {
            type: 'delete_task',
            taskId,
            listId,
            expectedVersion: task.version ?? 0
        };

        return commitMutation(operation, () => {
            list.tasks = list.tasks.filter((candidate) => candidate.id !== taskId);
        });
    }

    async function moveTask(taskId, fromListId, toListId, targetIndex) {
        const sourceList = findList(fromListId);
        const targetList = findList(toListId);
        if (!sourceList || !targetList) {
            return { ok: false };
        }

        const currentIndex = sourceList.tasks.findIndex((task) => task.id === taskId);
        if (currentIndex === -1) {
            return { ok: false };
        }

        const task = sourceList.tasks[currentIndex];
        const updatedAt = new Date().toISOString();
        // Drop indexes count only pending rows: completed tasks sit in their
        // own section at the bottom and are not drag targets.
        const targetTasksWithoutMovedTask = (fromListId === toListId
            ? targetList.tasks.filter((candidate) => candidate.id !== taskId)
            : targetList.tasks
        ).filter((candidate) => !candidate.completedAt);
        const normalizedIndex = targetIndex < 0
            ? targetTasksWithoutMovedTask.length
            : Math.min(targetIndex, targetTasksWithoutMovedTask.length);
        const position = getNextPositionForIndex(targetTasksWithoutMovedTask, normalizedIndex);

        // Repeated drops into the same gap bisect float midpoints until the
        // midpoint collides with a neighbour and the order can no longer be
        // expressed (~52 drags). When that happens on a same-list move,
        // rewrite the whole pending set sequentially in the intended order —
        // one batch, fresh position headroom.
        if (fromListId === toListId) {
            const orderedPending = sortTasksForDisplay(targetTasksWithoutMovedTask);
            const previousTask = normalizedIndex > 0 ? orderedPending[normalizedIndex - 1] : null;
            const nextTask = normalizedIndex < orderedPending.length ? orderedPending[normalizedIndex] : null;
            const degenerate = (previousTask && position === normalizePosition(previousTask.position))
                || (nextTask && position === normalizePosition(nextTask.position));

            if (degenerate) {
                const intendedOrder = [...orderedPending];
                intendedOrder.splice(normalizedIndex, 0, task);
                const entries = [];
                intendedOrder.forEach((candidate, index) => {
                    const rebalancedPosition = (index + 1) * POSITION_STEP;
                    if (normalizePosition(candidate.position) !== rebalancedPosition) {
                        entries.push({ listId: toListId, taskId: candidate.id, updates: { position: rebalancedPosition } });
                    }
                });
                return updateTasksBatch(entries);
            }
        }

        const operation = {
            type: 'update_task',
            taskId,
            listId: toListId,
            expectedVersion: task.version ?? 0,
            data: {
                position,
                list_id: toListId,
                updated_at: updatedAt
            }
        };

        return commitMutation(operation, () => {
            sourceList.tasks.splice(currentIndex, 1);
            targetList.tasks.splice(normalizedIndex, 0, task);
            task.updatedAt = updatedAt;
            task.position = position;
            sortListTasks(targetList);
            if (sourceList.id !== targetList.id) {
                sortListTasks(sourceList);
            }
        });
    }

    async function moveList(listId, targetIndex) {
        const list = findList(listId);
        if (!list) {
            return { ok: false };
        }

        const currentIndex = state.lists.findIndex((candidate) => candidate.id === listId);
        if (currentIndex === -1) {
            return { ok: false };
        }

        const updatedAt = new Date().toISOString();
        const normalizedIndex = targetIndex < 0 ? state.lists.length : Math.min(targetIndex, state.lists.length);
        const listsWithoutMovedList = state.lists.filter((candidate) => candidate.id !== listId);
        const position = getNextListPositionForIndex(listsWithoutMovedList, normalizedIndex);

        const operation = {
            type: 'update_list',
            listId,
            expectedVersion: list.version ?? 0,
            data: {
                position,
                updated_at: updatedAt
            }
        };

        return commitMutation(operation, () => {
            list.position = position;
            list.updatedAt = updatedAt;
        });
    }

    // Completed one-off tasks linger struck-through until the end of the day
    // they were checked off, then get permanently deleted — clean slate every
    // morning. Routines are exempt — their completion stamp just goes stale
    // at the same midnight boundary and they present as pending again. Both
    // devices run this; deletes are idempotent so whichever reaps first wins
    // quietly.
    async function reapExpiredCompletedTasks(now = Date.now()) {
        let reaped = 0;
        for (const list of [...state.lists]) {
            if (normalizeListName(list.name) === normalizeListName(ROUTINE_LIST_NAME)) {
                continue;
            }
            for (const task of [...list.tasks]) {
                if (isCompletionExpired(task, now)) {
                    await deleteTask(list.id, task.id);
                    reaped += 1;
                }
            }
        }
        return reaped;
    }

    function handleOffline() {
        setOnlineState(false);
        clearQueuedSyncTimer();

        if (enableOfflineQueue && getQueue().length > 0) {
            setQueueStatus(getQueue());
            return;
        }

        updateSyncStatus({
            pending: getQueue().length,
            phase: 'offline',
            error: ''
        });
    }

    async function handleOnline({ settle = true } = {}) {
        setOnlineState(true);

        // A dead channel means cross-device edits only arrive via the fallback
        // poll — revive it as soon as connectivity returns.
        const realtimeDead = !realtimeChannel
            || realtimeRetryTimer
            || realtimeChannel.state === 'closed'
            || realtimeChannel.state === 'errored';
        if (canSyncRemotely() && realtimeDead) {
            startRealtime();
        }

        if (enableOfflineQueue && getQueue().length > 0) {
            const primedQueue = resetQueuedOperationRetries();
            setQueueStatus(primedQueue);
        }

        const didSync = await syncNow({ stabilize: enableOfflineQueue && settle });
        if (enableOfflineQueue && getQueue().length > 0 && isOnline()) {
            scheduleQueuedSync({ delayMs: RECONNECT_QUEUE_RETRY_DELAY_MS });
        }

        return didSync;
    }

    function subscribeState(listener) {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
    }

    function subscribeAuth(listener) {
        authListeners.add(listener);
        return () => authListeners.delete(listener);
    }

    function subscribeSync(listener) {
        syncListeners.add(listener);
        return () => syncListeners.delete(listener);
    }

    return {
        bootstrap,
        signIn,
        signOut,
        syncNow,
        handleOffline,
        handleOnline,
        setActiveView,
        createList,
        renameList,
        deleteList,
        addTask,
        updateTask,
        updateTasksBatch,
        deleteTask,
        moveTask,
        moveList,
        reapExpiredCompletedTasks,
        subscribeState,
        subscribeAuth,
        subscribeSync,
        getState: () => state,
        getCurrentUser: () => currentUser,
        getSyncStatus: () => syncStatus,
        getPendingQueueLength: () => getQueue().length,
        isOfflineQueueEnabled: () => enableOfflineQueue,
        isRealtimeHealthy: () => Boolean(realtimeChannel && realtimeChannel.state === 'joined' && !realtimeRetryTimer),
        isOnline,
        setOnlineState
    };
}
