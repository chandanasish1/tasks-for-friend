import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser shims so the store runs in local mode (no Supabase).
const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    key: (index) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; }
};
try {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
} catch {
    // Node exposes a getter-only navigator in some versions; local mode
    // tolerates whatever is there.
}

const { createTasksStore } = await import('../src/store.mjs');
const { sortTasksForDisplay, normalizePosition } = await import('../src/utils.mjs');

async function freshStore() {
    storage.clear();
    const store = createTasksStore({ supabase: null, enableOfflineQueue: false });
    await store.bootstrap();
    return store;
}

function listByName(store, name) {
    return store.getState().lists.find((list) => list.name.toUpperCase() === name.toUpperCase());
}

test('completing a task keeps it (stamped) instead of deleting it', async () => {
    const store = await freshStore();
    const list = listByName(store, 'Commitments');
    await store.addTask(list.id, 'buy filters');
    const task = listByName(store, 'Commitments').tasks[0];

    await store.updateTask(list.id, task.id, { completedAt: new Date().toISOString() });
    const after = listByName(store, 'Commitments').tasks.find((t) => t.id === task.id);
    assert.ok(after, 'task must survive completion');
    assert.ok(after.completedAt, 'completion stamp recorded');

    // Undo restores it to pending.
    await store.updateTask(list.id, task.id, { completedAt: '' });
    assert.equal(listByName(store, 'Commitments').tasks.find((t) => t.id === task.id).completedAt, '');
});

test('reaper deletes one-offs from previous days, keeps today\'s and all routines', async () => {
    const store = await freshStore();
    await store.createList('routine');
    const commitments = listByName(store, 'Commitments');
    const routine = listByName(store, 'routine');

    await store.addTask(commitments.id, 'expired one-off');
    await store.addTask(commitments.id, 'fresh one-off');
    await store.addTask(routine.id, 'old routine');

    // Yesterday (always a previous local day) vs right now (always today).
    const expiredStamp = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const freshStamp = new Date().toISOString();
    const byText = (name, text) => listByName(store, name).tasks.find((t) => t.text === text);

    await store.updateTask(commitments.id, byText('Commitments', 'expired one-off').id, { completedAt: expiredStamp });
    await store.updateTask(commitments.id, byText('Commitments', 'fresh one-off').id, { completedAt: freshStamp });
    await store.updateTask(routine.id, byText('routine', 'old routine').id, { completedAt: expiredStamp });

    const reaped = await store.reapExpiredCompletedTasks();

    assert.equal(reaped, 1, 'exactly the expired one-off is reaped');
    assert.equal(byText('Commitments', 'expired one-off'), undefined);
    assert.ok(byText('Commitments', 'fresh one-off'), 'fresh completion survives');
    assert.ok(byText('routine', 'old routine'), 'routines are never reaped');
});

test('repeated same-gap drags stay ordered: auto-rebalance beats float limits', async () => {
    const store = await freshStore();
    const list = listByName(store, 'Commitments');
    await store.addTask(list.id, 'bottom');
    await store.addTask(list.id, 'middle');
    await store.addTask(list.id, 'top');

    // Alternate dropping the outer tasks into the same middle gap. Each drop
    // halves the float gap; without rebalancing this breaks after ~52 drops.
    for (let i = 0; i < 200; i += 1) {
        const ordered = sortTasksForDisplay(listByName(store, 'Commitments').tasks);
        const mover = i % 2 === 0 ? ordered[0] : ordered[2];
        const result = await store.moveTask(mover.id, list.id, list.id, 1);
        assert.ok(result.ok, `move ${i} must succeed`);
    }

    const finalTasks = sortTasksForDisplay(listByName(store, 'Commitments').tasks);
    const positions = finalTasks.map((t) => normalizePosition(t.position));
    assert.equal(new Set(positions).size, 3, 'no position collisions after 200 same-gap drags');
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'strict order preserved');
});

// Just enough of the supabase-js surface for the fresh-account flow:
// sign-in session, an empty lists table that remembers upserts, and a
// realtime channel that does nothing.
function createFakeSupabase() {
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'friend@example.com' };
    const serverLists = [];
    const fake = {
        serverLists,
        upsertCount: 0,
        auth: {
            async getSession() { return { data: { session: { user } } }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            async signInWithPassword() { return { error: null }; },
            async signOut() {}
        },
        channel() {
            return {
                state: 'joined',
                on() { return this; },
                subscribe() { return this; },
                unsubscribe() {}
            };
        },
        from(table) {
            return {
                upsert(row) {
                    return {
                        select() {
                            return {
                                async single() {
                                    if (table !== 'lists') {
                                        return { data: null, error: new Error(`unexpected upsert into ${table}`) };
                                    }
                                    fake.upsertCount += 1;
                                    serverLists.push({ ...row, version: 0, tasks: [] });
                                    return { data: { id: row.id, version: 0, updated_at: row.updated_at }, error: null };
                                }
                            };
                        }
                    };
                },
                select() {
                    return {
                        eq() {
                            return {
                                async order() {
                                    return { data: table === 'lists' ? serverLists.map((list) => ({ ...list })) : [], error: null };
                                },
                                async maybeSingle() { return { data: null, error: null }; }
                            };
                        }
                    };
                }
            };
        }
    };
    return fake;
}

test('first sign-in of an empty account seeds the default lists on the server', async () => {
    storage.clear();
    const fakeSupabase = createFakeSupabase();
    const store = createTasksStore({ supabase: fakeSupabase, enableOfflineQueue: false });
    await store.bootstrap();

    const names = store.getState().lists.map((list) => list.name);
    assert.deepEqual(names, ['Today', 'Upcoming', 'Routine', 'Commitments', 'Academics']);
    assert.equal(fakeSupabase.upsertCount, 5, 'each default list becomes a real server row');
    assert.equal(fakeSupabase.serverLists.length, 5);

    // A later sync must not reseed: the server now has the lists.
    await store.syncNow();
    assert.equal(fakeSupabase.upsertCount, 5, 'no duplicate seeding on subsequent syncs');
    assert.equal(store.getState().lists.length, 5);
});

test('completed tasks are excluded from drop-index math', async () => {
    const store = await freshStore();
    const list = listByName(store, 'Commitments');
    await store.addTask(list.id, 'c');
    await store.addTask(list.id, 'b');
    await store.addTask(list.id, 'a');
    const byText = (text) => listByName(store, 'Commitments').tasks.find((t) => t.text === text);

    await store.updateTask(list.id, byText('a').id, { completedAt: new Date().toISOString() });

    // Pending order is [b, c]; move c to pending index 0 — the completed
    // task must not shift the target slot.
    await store.moveTask(byText('c').id, list.id, list.id, 0);
    const pending = sortTasksForDisplay(listByName(store, 'Commitments').tasks).filter((t) => !t.completedAt);
    assert.deepEqual(pending.map((t) => t.text), ['c', 'b']);
});
