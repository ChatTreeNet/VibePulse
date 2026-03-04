'use client';

let audioContext: AudioContext | null = null;

const STORAGE_KEY = 'vibepulse:sound-muted';

function getAudioContext(): AudioContext {
    if (!audioContext) {
        audioContext = new AudioContext();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    return audioContext;
}

export function isMuted(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setMuted(muted: boolean): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, String(muted));
}

/**
 * Ensure AudioContext is unlocked after a user gesture.
 * Call this from any click handler to enable future sound playback.
 */
export function unlockAudio(): void {
    try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        // Play a silent buffer to fully unlock on iOS/Safari
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
    } catch {
        // ignore
    }
}

/**
 * Two-tone ascending chime — used for question.asked / permission.asked
 * A gentle, non-alarming notification that user input is needed.
 */
export function playAttentionSound(): void {
    if (isMuted()) return;
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        // First tone: C5 (523 Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.value = 523;
        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.2);

        // Second tone: E5 (659 Hz) — ascending interval
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = 659;
        gain2.gain.setValueAtTime(0.3, now + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.4);

        // Third tone: G5 (784 Hz) — more noticeable
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = 'sine';
        osc3.frequency.value = 784;
        gain3.gain.setValueAtTime(0.25, now + 0.3);
        gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.start(now + 0.3);
        osc3.stop(now + 0.55);
    } catch {
        // Audio not available — silently ignore
    }
}

/**
 * Descending alert tone — used for retry/error states.
 * Slightly more urgent than the attention chime.
 */
export function playAlertSound(): void {
    if (isMuted()) return;
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        // Descending tone: A5 → F5
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(698, now + 0.25);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);

        // Second hit
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(698, now + 0.2);
        osc2.frequency.exponentialRampToValueAtTime(523, now + 0.45);
        gain2.gain.setValueAtTime(0.25, now + 0.2);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.2);
        osc2.stop(now + 0.5);
    } catch {
        // Audio not available — silently ignore
    }
}

export function playCompleteSound(): void {
    if (isMuted()) return;
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659, now);
        osc.frequency.exponentialRampToValueAtTime(988, now + 0.18);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(988, now + 0.12);
        osc2.frequency.exponentialRampToValueAtTime(1318, now + 0.32);
        gain2.gain.setValueAtTime(0.18, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.36);
    } catch {
        // Audio not available — silently ignore
    }
}
