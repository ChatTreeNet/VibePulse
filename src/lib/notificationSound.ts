'use client';

let audioContext: AudioContext | null = null;

const STORAGE_KEY = 'vibepulse:sound-muted';

function getAudioContext(): AudioContext {
    if (!audioContext) {
        audioContext = new AudioContext();
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
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.15);

        // Second tone: E5 (659 Hz) — ascending interval
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = 659;
        gain2.gain.setValueAtTime(0.15, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.3);
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
        osc.frequency.exponentialRampToValueAtTime(698, now + 0.2);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
    } catch {
        // Audio not available — silently ignore
    }
}
