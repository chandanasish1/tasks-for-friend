import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareTasksForDisplay,
    isCompletionExpired,
    isTaskCompleted,
    isTaskCompletedOn,
    normalizeTask,
    sortRoutineTasksForDisplay,
    sortTasksForDisplay,
    sortTodayTasksForDisplay,
    sortTomorrowTasksForDisplay,
    getTodayIso,
    getTomorrowIso,
    toLocalDateIso
} from '../src/utils.mjs';

const localIso = (date) => toLocalDateIso(date);
const TODAY = localIso(new Date());
const YESTERDAY = localIso(new Date(Date.now() - 24 * 3600 * 1000));

test('normalizeTask maps completed_at from the server row', () => {
    const task = normalizeTask({ id: '9c86a1de-0000-4000-8000-000000000001', title: 'x', completed_at: '2026-07-26T10:00:00+00:00' });
    assert.equal(task.completedAt, '2026-07-26T10:00:00+00:00');
    assert.equal(normalizeTask({ title: 'y' }).completedAt, '');
});

test('completion helpers: done, day-scoped done, and midnight expiry', () => {
    const now = Date.now();
    const doneNow = { completedAt: new Date(now).toISOString() };
    const doneYesterday = { completedAt: new Date(now - 25 * 3600 * 1000).toISOString() };

    assert.equal(isTaskCompleted(doneNow), true);
    assert.equal(isTaskCompleted({ completedAt: '' }), false);

    assert.equal(isTaskCompletedOn(doneNow, TODAY), true);
    assert.equal(isTaskCompletedOn(doneYesterday, TODAY), false);
    assert.equal(isTaskCompletedOn(doneYesterday, YESTERDAY), true);

    // Expiry is the local-midnight boundary, not a rolling window: anything
    // completed today survives all day, anything from a previous day is out.
    assert.equal(isCompletionExpired(doneNow, now), false);
    assert.equal(isCompletionExpired(doneYesterday, now), true);
    assert.equal(isCompletionExpired({ completedAt: '' }, now), false);

    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const lateLastNight = { completedAt: new Date(midnight.getTime() - 60 * 1000).toISOString() };
    const earlyToday = { completedAt: new Date(midnight.getTime() + 60 * 1000).toISOString() };
    assert.equal(isCompletionExpired(lateLastNight, now), true, '23:59 yesterday is expired');
    assert.equal(isCompletionExpired(earlyToday, now), false, '00:01 today survives all day');
    assert.equal(isCompletionExpired(doneNow, now + 48 * 3600 * 1000), true, 'today expires by tomorrow');
});

test('compareTasksForDisplay sinks completed tasks, newest completion first', () => {
    const pendingA = { id: 'a', text: 'a', position: 1024 };
    const pendingB = { id: 'b', text: 'b', position: 2048 };
    const doneOld = { id: 'c', text: 'c', position: 0, completedAt: '2026-07-26T08:00:00Z' };
    const doneNew = { id: 'd', text: 'd', position: 0, completedAt: '2026-07-26T10:00:00Z' };

    const sorted = sortTasksForDisplay([doneOld, pendingB, doneNew, pendingA]);
    assert.deepEqual(sorted.map((t) => t.id), ['a', 'b', 'd', 'c']);
});

test('routine sort: done today sinks, yesterday completion is pending again', () => {
    const doneToday = { id: 'x', position: 1024, completedAt: new Date().toISOString() };
    const doneYesterday = { id: 'y', position: 2048, completedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() };
    const pending = { id: 'z', position: 3072 };

    const sorted = sortRoutineTasksForDisplay([doneToday, doneYesterday, pending], TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['y', 'z', 'x']);
});

test('today sort: completed natives sink below pending and overdue', () => {
    const overdue = { id: 'o', date: YESTERDAY, position: 0, _originListId: 'L2' };
    const pendingNative = { id: 'p', position: 1024, _originListId: 'today-id' };
    const doneNative = { id: 'q', position: 0, _originListId: 'today-id', completedAt: new Date().toISOString() };

    const sorted = sortTodayTasksForDisplay([doneNative, pendingNative, overdue], 'today-id', TODAY);
    assert.deepEqual(sorted.map((t) => t.id), ['o', 'p', 'q']);
});

test('tomorrow sort: completed tasks sink, pending tasks sort by time then position', () => {
    const done = { id: 'd', position: 1024, completedAt: new Date().toISOString() };
    const timedLater = { id: 'l', position: 2048, time: '14:00' };
    const timedEarlier = { id: 'e', position: 3072, time: '09:00' };
    const untimed = { id: 'u', position: 512 };

    const sorted = sortTomorrowTasksForDisplay([done, timedLater, untimed, timedEarlier]);
    assert.deepEqual(sorted.map((t) => t.id), ['e', 'l', 'u', 'd']);
});

test('getTomorrowIso returns next day in YYYY-MM-DD format', () => {
    const today = getTodayIso();
    const tomorrow = getTomorrowIso();
    assert.match(tomorrow, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(today, tomorrow);
});
