import { usePassthroughStatusStore } from './passthroughStatusStore';

// Keeps Web playback silent synchronously while the native helper owns the sound.

export const createWebOutputGate = (context: AudioContext) => {
    const node = context.createGain();
    const sync = () => {
        node.gain.value = usePassthroughStatusStore.getState().silenceWebOutput ? 0 : 1;
    };
    sync();
    const unsubscribe = usePassthroughStatusStore.subscribe((state, previous) => {
        if (state.silenceWebOutput !== previous.silenceWebOutput) sync();
    });
    return {
        node,
        dispose: () => {
            unsubscribe();
            node.disconnect();
        },
    };
};
