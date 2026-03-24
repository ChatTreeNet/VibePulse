'use client';

let audioContext: AudioContext | null = null;

const STORAGE_KEY = 'vibepulse:sound-muted';
const MUTE_CHANGE_EVENT = 'vibepulse:sound-muted-change';
const SOUND_LOG_THROTTLE_MS = 10000;
const soundLogLastAt = new Map<string, number>();

function shouldLogSound(key: string): boolean {
    const now = Date.now();
    const lastAt = soundLogLastAt.get(key) ?? 0;
    if (now - lastAt < SOUND_LOG_THROTTLE_MS) {
        return false;
    }
    soundLogLastAt.set(key, now);
    return true;
}

function logSoundInfo(key: string, message: string): void {
    if (!shouldLogSound(`info:${key}`)) return;
    console.info(`[VibePulse sound] ${message}`);
}

function logSoundWarning(key: string, message: string, error: unknown): void {
    if (!shouldLogSound(`warn:${key}`)) return;
    console.warn(`[VibePulse sound] ${message}`, error);
}

function getAudioContext(): AudioContext {
    if (!audioContext) {
        audioContext = new AudioContext();
    }
    return audioContext;
}

function runWithAudio(
    key: string,
    mutedMessage: string,
    failureMessage: string,
    play: (ctx: AudioContext, now: number) => void
): void {
    if (isMuted()) {
        logSoundInfo(`${key}-muted`, mutedMessage);
        return;
    }

    try {
        const ctx = getAudioContext();
        const playNow = () => {
            try {
                play(ctx, ctx.currentTime);
            } catch (error) {
                logSoundWarning(key, failureMessage, error);
            }
        };

        if (ctx.state === 'running') {
            playNow();
            return;
        }

        void ctx
            .resume()
            .then(() => {
                if (ctx.state === 'running') {
                    playNow();
                    return;
                }
                logSoundWarning(`${key}-state`, `${failureMessage} (AudioContext not running after resume)`, new Error(ctx.state));
            })
            .catch((error) => {
                logSoundWarning(`${key}-resume`, `${failureMessage} (AudioContext resume failed)`, error);
            });
    } catch (error) {
        logSoundWarning(key, failureMessage, error);
    }
}

export function isMuted(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setMuted(muted: boolean): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, String(muted));
    window.dispatchEvent(new Event(MUTE_CHANGE_EVENT));
}

export function subscribeMuted(onStoreChange: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => {};
    }

    const handleMutedChange = () => {
        onStoreChange();
    };

    const handleStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
            onStoreChange();
        }
    };

    window.addEventListener(MUTE_CHANGE_EVENT, handleMutedChange);
    window.addEventListener('storage', handleStorage);

    return () => {
        window.removeEventListener(MUTE_CHANGE_EVENT, handleMutedChange);
        window.removeEventListener('storage', handleStorage);
    };
}

/**
 * Ensure AudioContext is unlocked after a user gesture.
 * Call this from any click handler to enable future sound playback.
 */
export function unlockAudio(): void {
    try {
        const ctx = getAudioContext();
        const prime = () => {
            const buffer = ctx.createBuffer(1, 1, 22050);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
        };

        if (ctx.state === 'running') {
            prime();
            return;
        }

        void ctx
            .resume()
            .then(() => {
                if (ctx.state === 'running') {
                    prime();
                    return;
                }
                logSoundWarning('unlock-state', 'unlockAudio() resume did not reach running state', new Error(ctx.state));
            })
            .catch((error) => {
                logSoundWarning('unlock-resume', 'Failed to resume AudioContext in unlockAudio()', error);
            });
    } catch (error) {
        logSoundWarning('unlock-audio', 'unlockAudio() failed', error);
    }
}

/**
 * Two-tone ascending chime — used for question.asked / permission.asked
 * A gentle, non-alarming notification that user input is needed.
 */
export function playAttentionSound(): void {
    runWithAudio(
        'play-attention',
        'Skipped playAttentionSound() because muted',
        'playAttentionSound() failed',
        (ctx, now) => {
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
        }
    );
}

/**
 * Descending alert tone — used for retry/error states.
 * Slightly more urgent than the attention chime.
 */
export function playAlertSound(): void {
    runWithAudio(
        'play-alert',
        'Skipped playAlertSound() because muted',
        'playAlertSound() failed',
        (ctx, now) => {
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
        }
    );
}

export function playCompleteSound(): void {
    runWithAudio(
        'play-complete',
        'Skipped playCompleteSound() because muted',
        'playCompleteSound() failed',
        (ctx, now) => {
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
        }
    );
}

export function playToggleFeedbackSound(): void {
    runWithAudio(
        'play-toggle-feedback',
        'Skipped playToggleFeedbackSound() because muted',
        'playToggleFeedbackSound() failed',
        (ctx, now) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(740, now);
        osc.frequency.exponentialRampToValueAtTime(920, now + 0.1);
        gain.gain.setValueAtTime(0.13, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
        }
    );
}
