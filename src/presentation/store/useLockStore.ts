import { create } from 'zustand';
import { hasPin } from '../../services/security/AppLock';

/** Délai en arrière-plan au-delà duquel l'application se reverrouille. */
export const RELOCK_AFTER_MS = 60_000;

interface LockState {
  pinEnabled: boolean;
  locked: boolean;
  backgroundedAt?: number;
  init(): Promise<void>;
  unlock(): void;
  setPinEnabled(enabled: boolean): void;
  onBackground(now?: number): void;
  onForeground(now?: number): void;
}

export const useLockStore = create<LockState>((set, get) => ({
  pinEnabled: false,
  locked: false,
  async init() {
    const enabled = await hasPin().catch(() => false);
    set({ pinEnabled: enabled, locked: enabled });
  },
  unlock: () => set({ locked: false }),
  setPinEnabled: enabled => set({ pinEnabled: enabled, locked: false }),
  onBackground: (now = Date.now()) => set({ backgroundedAt: now }),
  onForeground: (now = Date.now()) => {
    const { pinEnabled, backgroundedAt } = get();
    if (pinEnabled && backgroundedAt !== undefined && now - backgroundedAt >= RELOCK_AFTER_MS) {
      set({ locked: true });
    }
    set({ backgroundedAt: undefined });
  },
}));
