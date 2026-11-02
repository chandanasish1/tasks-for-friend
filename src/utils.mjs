export function uid() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch (error) {
        // Ignore and fall back to a Math.random UUID.
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const random = Math.random() * 16 | 0;
        const value = character === 'x' ? random : (random & 0x3 | 0x8);
        return value.toString(16);
    });
}

export function isUUID(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
}

export function normalizeVersion(version) {
    const parsed = Number(version);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizePosition(position) {
    if (position === null || position === undefined) {
        return null;
    }

    if (typeof position === 'string' && position.trim() === '') {
        return null;
    }

    const parsed = Number(position);
    return Number.isFinite(parsed) ? parsed : null;
}

// Completion is a timestamp, not a boolean, and everything about it is
// day-scoped: a completed one-off stays visible (struck through) until the
// end of the local day it was checked off, then gets reaped — every morning
// starts with a clean slate. Routine tasks use the same stamp and the same
// day boundary, but flip back to pending instead of being deleted.
export function getTodayIso(now = Date.now()) {
    return toLocalDateIso(now);
}

export function getTomorrowIso(now = Date.now()) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toLocalDateIso(tomorrow);
}

export function toLocalDateIso(timestamp) {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export function isTaskCompleted(task = {}) {
    return Boolean(task.completedAt);
}

export function isTaskCompletedOn(task = {}, dateIso = '') {
    return Boolean(dateIso) && Boolean(task.completedAt) && toLocalDateIso(task.completedAt) === dateIso;
}

export function isCompletionExpired(task = {}, now = Date.now()) {
    if (!task.completedAt) {
        return false;
    }
    const completedDay = toLocalDateIso(task.completedAt);
    return Boolean(completedDay) && completedDay < toLocalDateIso(now);
}

// Within one day, timed tasks lead (agenda-style, earliest first) and
// untimed tasks follow in whatever order the other comparators decide.
export function compareTimesWithinDay(left = {}, right = {}) {
    const leftHasTime = Boolean(left.time);
    const rightHasTime = Boolean(right.time);

    if (leftHasTime !== rightHasTime) {
        return leftHasTime ? -1 : 1;
    }

    if (leftHasTime && rightHasTime && left.time !== right.time) {
        return left.time.localeCompare(right.time);
    }

    return 0;
}

export function compareTasksForDisplay(left = {}, right = {}) {
    // Completed tasks sink below everything pending, newest completion first.
    // (Routine lists sort with sortRoutineTasksForDisplay instead — a stale
    // completedAt there means "pending again", not done.)
    const leftDone = isTaskCompleted(left);
    const rightDone = isTaskCompleted(right);
    if (leftDone !== rightDone) {
        return leftDone ? 1 : -1;
    }
    if (leftDone && rightDone && left.completedAt !== right.completedAt) {
        return (right.completedAt || '').localeCompare(left.completedAt || '');
    }

    const leftHasDate = Boolean(left.date);
    const rightHasDate = Boolean(right.date);

    if (leftHasDate && rightHasDate && left.date !== right.date) {
        return left.date.localeCompare(right.date);
    }

    if (leftHasDate !== rightHasDate) {
        return leftHasDate ? -1 : 1;
    }

    const timeOrder = compareTimesWithinDay(left, right);
    if (timeOrder !== 0) {
        return timeOrder;
    }

    const leftPosition = normalizePosition(left.position);
    const rightPosition = normalizePosition(right.position);
    if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
    }

    if (left.createdAt !== right.createdAt) {
        return (right.createdAt || '').localeCompare(left.createdAt || '');
    }

    return String(left.id || '').localeCompare(String(right.id || ''));
}

export function sortTasksForDisplay(tasks = []) {
    return [...tasks].sort(compareTasksForDisplay);
}

// Today ordering:
//  1. Overdue tasks (due before today) pin to the very top so an unfinished
//     item can never get buried; among them, oldest date first, so the groups
//     render contiguously (one date header each).
//  2. Then by todayPosition: a dedicated slot written when the user drags
//     inside Today. Once placed, it drives the order across the whole list,
//     so native and pulled-in tasks interleave freely. It is kept in sync
//     with each task's home-list position, so reordering Today reorders the
//     source list and vice versa.
//  3. Among tasks not yet dragged, pulled-in tasks lead Today's own (native)
//     ones — so a task arriving from another list starts at the top — then
//     they fall back to home-list order.
// Tasks must carry _originListId/_originListIndex (set during aggregation).
export function sortTodayTasksForDisplay(tasks, builtInListId, todayIso) {
    const isNative = (task) => task._originListId === builtInListId;
    const isOverdue = (task) => Boolean(task.date) && task.date < todayIso;
    return [...tasks].sort((left, right) => {
        // Done-for-today sinks below everything pending. The aggregation
        // pre-computes _doneInToday (a routine's stale stamp from yesterday
        // means pending, not done); raw completedAt is only a fallback.
        const leftDone = left._doneInToday !== undefined ? left._doneInToday : isTaskCompleted(left);
        const rightDone = right._doneInToday !== undefined ? right._doneInToday : isTaskCompleted(right);
        if (leftDone !== rightDone) {
            return leftDone ? 1 : -1;
        }
        if (leftDone && rightDone && left.completedAt !== right.completedAt) {
            return (right.completedAt || '').localeCompare(left.completedAt || '');
        }

        const leftOverdue = isOverdue(left);
        const rightOverdue = isOverdue(right);
        if (leftOverdue !== rightOverdue) {
            return leftOverdue ? -1 : 1;
        }

        if (leftOverdue && rightOverdue && left.date !== right.date) {
            return left.date.localeCompare(right.date);
        }

        // Same day (both today, or overdue from the same date): timed tasks
        // order by time ahead of any manual placement.
        const timeOrder = compareTimesWithinDay(left, right);
        if (timeOrder !== 0) {
            return timeOrder;
        }

        const leftPos = normalizePosition(left.todayPosition);
        const rightPos = normalizePosition(right.todayPosition);
        const leftPlaced = leftPos !== null;
        const rightPlaced = rightPos !== null;

        if (leftPlaced !== rightPlaced) {
            return leftPlaced ? 1 : -1;
        }

        if (leftPlaced && rightPlaced && leftPos !== rightPos) {
            return leftPos - rightPos;
        }

        if (!leftPlaced && !rightPlaced) {
            const leftNative = isNative(left);
            const rightNative = isNative(right);
            if (leftNative !== rightNative) {
                return leftNative ? 1 : -1;
            }

            const leftListIndex = Number.isInteger(left._originListIndex) ? left._originListIndex : 0;
            const rightListIndex = Number.isInteger(right._originListIndex) ? right._originListIndex : 0;
            if (leftListIndex !== rightListIndex) {
                return leftListIndex - rightListIndex;
            }

            const leftListPos = normalizePosition(left.position);
            const rightListPos = normalizePosition(right.position);
            if (leftListPos !== null && rightListPos !== null && leftListPos !== rightListPos) {
                return leftListPos - rightListPos;
            }
        }

        if (left.createdAt !== right.createdAt) {
            return (right.createdAt || '').localeCompare(left.createdAt || '');
        }

        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

// Upcoming: aggregated future-dated tasks, ordered by date, then time, then
// home-list position.
export function sortUpcomingTasksForDisplay(tasks) {
    return [...tasks].sort((left, right) => {
        const leftDate = left.date || '';
        const rightDate = right.date || '';
        if (leftDate && rightDate && leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate);
        }

        if (Boolean(leftDate) !== Boolean(rightDate)) {
            return leftDate ? -1 : 1;
        }

        const timeOrder = compareTimesWithinDay(left, right);
        if (timeOrder !== 0) {
            return timeOrder;
        }

        const leftPosition = normalizePosition(left.position);
        const rightPosition = normalizePosition(right.position);
        if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) {
            return leftPosition - rightPosition;
        }

        if (left.createdAt !== right.createdAt) {
            return (right.createdAt || '').localeCompare(left.createdAt || '');
        }

        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

// Tomorrow: aggregated tasks dated for tomorrow, ordered by completed status,
// then time, then position.
export function sortTomorrowTasksForDisplay(tasks) {
    return [...tasks].sort((left, right) => {
        const leftDone = isTaskCompleted(left);
        const rightDone = isTaskCompleted(right);
        if (leftDone !== rightDone) {
            return leftDone ? 1 : -1;
        }
        if (leftDone && rightDone && left.completedAt !== right.completedAt) {
            return (right.completedAt || '').localeCompare(left.completedAt || '');
        }

        const timeOrder = compareTimesWithinDay(left, right);
        if (timeOrder !== 0) {
            return timeOrder;
        }

        const leftPosition = normalizePosition(left.position);
        const rightPosition = normalizePosition(right.position);
        if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) {
            return leftPosition - rightPosition;
        }

        if (left.createdAt !== right.createdAt) {
            return (right.createdAt || '').localeCompare(left.createdAt || '');
        }

        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

// Routine: the list's own manual order, with tasks already done today sunk
// to the bottom (they reset — and float back up — at the midnight rollover).
// compareTasksForDisplay's done-sink keys off any completedAt, which would
// wrongly sink a routine finished yesterday, so this comparator masks
// completedAt and applies its own day-scoped done rule.
export function sortRoutineTasksForDisplay(tasks, todayIso) {
    return [...tasks].sort((left, right) => {
        const leftDone = isTaskCompletedOn(left, todayIso);
        const rightDone = isTaskCompletedOn(right, todayIso);
        if (leftDone !== rightDone) {
            return leftDone ? 1 : -1;
        }

        return compareTasksForDisplay({ ...left, completedAt: '' }, { ...right, completedAt: '' });
    });
}

export function compareListsForDisplay(left = {}, right = {}) {
    const leftPosition = normalizePosition(left.position);
    const rightPosition = normalizePosition(right.position);

    if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) {
        return leftPosition - rightPosition;
    }

    if (left.createdAt !== right.createdAt) {
        return (left.createdAt || '').localeCompare(right.createdAt || '');
    }

    return String(left.id || '').localeCompare(String(right.id || ''));
}

export function sortListsForDisplay(lists = []) {
    return [...lists].sort(compareListsForDisplay);
}

// Postgres `time` columns come back as "HH:MM:SS"; the UI works in "HH:MM".
export function normalizeTime(value) {
    const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
    return match ? `${match[1]}:${match[2]}` : '';
}

export function normalizeTask(task = {}) {
    const createdAt = task.createdAt || task.created_at || '';
    return {
        id: isUUID(task.id) ? task.id : uid(),
        text: task.text ?? task.title ?? '',
        details: task.details ?? task.notes ?? '',
        date: task.date ?? task.due_date ?? '',
        time: normalizeTime(task.time ?? task.due_time ?? ''),
        createdAt,
        updatedAt: task.updatedAt || task.updated_at || createdAt,
        version: normalizeVersion(task.version),
        position: normalizePosition(task.position),
        todayPosition: normalizePosition(task.todayPosition ?? task.today_position),
        completedAt: task.completedAt ?? task.completed_at ?? ''
    };
}

export function normalizeList(list = {}) {
    const createdAt = list.createdAt || list.created_at || '';
    return {
        id: isUUID(list.id) ? list.id : uid(),
        name: (list.name || 'Untitled').trim() || 'Untitled',
        createdAt,
        updatedAt: list.updatedAt || list.updated_at || createdAt,
        version: normalizeVersion(list.version),
        position: normalizePosition(list.position),
        tasks: Array.isArray(list.tasks) ? sortTasksForDisplay(list.tasks.map(normalizeTask)) : []
    };
}

export function normalizeStateSnapshot(snapshot = {}) {
    return {
        activeView: snapshot.activeView || 'all',
        lists: Array.isArray(snapshot.lists) ? sortListsForDisplay(snapshot.lists.map(normalizeList)) : []
    };
}

export function cloneStateSnapshot(snapshot = {}) {
    const normalized = normalizeStateSnapshot(snapshot);
    if (typeof structuredClone === 'function') {
        return structuredClone(normalized);
    }
    return JSON.parse(JSON.stringify(normalized));
}

// The starter set every fresh account begins with. Today, Upcoming and
// Routine are the name-activated smart lists; the rest are regular lists.
// Used both for the local-mode default state and for seeding a brand-new
// account's first server rows (store.seedDefaultLists).
export const DEFAULT_LIST_NAMES = ['Today', 'Tomorrow', 'Upcoming', 'Routine', 'Commitments', 'Academics'];

export function createDefaultState() {
    return normalizeStateSnapshot({
        activeView: 'all',
        lists: DEFAULT_LIST_NAMES.map((name, index) => ({
            id: uid(),
            name,
            tasks: [],
            position: (index + 1) * 1024
        }))
    });
}

export function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export function formatErrorMessage(error, fallback = 'Something went wrong.') {
    const message = error && typeof error.message === 'string' ? error.message.trim() : '';
    return message || fallback;
}

export function isNetworkLikeError(error) {
    const message = `${error && error.message ? error.message : error || ''}`.toLowerCase();
    return (
        navigator.onLine === false ||
        message.includes('failed to fetch') ||
        message.includes('network request failed') ||
        message.includes('networkerror') ||
        message.includes('network error') ||
        message.includes('fetch failed') ||
        message.includes('load failed')
    );
}
