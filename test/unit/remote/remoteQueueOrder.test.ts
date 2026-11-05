import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { remoteReorderQueue, remoteSetQueueOrder, remoteSelectQueueSongAfterEdits } from '@/services/stageRemote';

// Scratchpad order edits must move and remove Host rows, including duplicate occurrences, without clearing playback.

vi.mock('@/services/stageMode', () => ({
    isStageRemoteMode: () => false,
    getStageAuthHeaders: () => ({}),
}));

const songs = (ids: number[]) => ids.map(id => ({ id, sourceRef: { kind: 'online', providerId: 'test', mediaId: String(id) } } as SongResult));

const host = (initial: number[], firstMoveGate?: Promise<void>) => {
    const queue = [...initial];
    let selected: number | null = null;
    let firstMove = true;
    const operations: Array<{ action: string; fromIndex?: number; toIndex?: number; index?: number }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        if (!init.body) return { ok: true, status: 200, json: async () => ({ queue: {
            items: queue.map((id, index) => ({ id: String(id), source: 'test', queueItemId: `test:${id}:${index}` })),
        } }) };
        const operation = JSON.parse(String(init.body));
        if (operation.action === 'move' && firstMove) {
            firstMove = false;
            await firstMoveGate;
        }
        operations.push(operation);
        if (operation.action === 'move') queue.splice(operation.toIndex, 0, ...queue.splice(operation.fromIndex, 1));
        else if (operation.action === 'remove') queue.splice(operation.index, 1);
        else if (operation.action === 'select') {
            const index = Number(operation.queueItemId.split(':').at(-1));
            if (`test:${queue[index]}:${index}` !== operation.queueItemId) throw new Error('Stale queue item');
            selected = queue[index];
        }
        else throw new Error('Unexpected queue operation');
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    return { queue, operations, selected: () => selected };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('remote scratchpad queue order', () => {
    it('waits for a draft move then selects the requested song using the Host identifier, not the old mirror index', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const state = host([1, 2, 3], gate);
        const edit = remoteSetQueueOrder(songs([1, 2, 3]), songs([3, 1, 2]));
        const play = remoteSelectQueueSongAfterEdits(songs([3])[0]);
        await Promise.resolve();
        expect(state.selected()).toBeNull();
        expect(state.operations).toEqual([]);
        release();
        await edit;
        expect(await play).toBe(true);
        expect(state.queue).toEqual([3, 1, 2]);
        expect(state.selected()).toBe(3);
        expect(state.operations.at(-1)).toEqual({ action: 'select', queueItemId: 'test:3:0' });
    });
    it('reorders retained rows then removes the remainder from the tail', async () => {
        const state = host([1, 2, 3, 4]);
        await remoteSetQueueOrder(songs([1, 2, 3, 4]), songs([4, 2]));
        expect(state.queue).toEqual([4, 2]);
        expect(state.operations).toEqual([
            { action: 'move', fromIndex: 3, toIndex: 0 },
            { action: 'move', fromIndex: 2, toIndex: 1 },
            { action: 'remove', index: 3 },
            { action: 'remove', index: 2 },
        ]);
    });

    it('preserves both selected occurrences of a duplicated song', async () => {
        const state = host([1, 2, 1, 3]);
        await remoteSetQueueOrder(songs([1, 2, 1, 3]), songs([1, 3, 1]));
        expect(state.queue).toEqual([1, 3, 1]);
    });

    it('does not delete anything for an order containing an unknown row', async () => {
        const state = host([1, 2]);
        await remoteSetQueueOrder(songs([1, 2]), songs([3]));
        expect(state.operations).toEqual([]);
    });

    it('keeps the existing reorder operation from removing unselected rows', async () => {
        const state = host([1, 2, 3]);
        await remoteReorderQueue(songs([1, 2, 3]), songs([3, 1]));
        expect(state.queue).toEqual([3, 1, 2]);
    });
});
