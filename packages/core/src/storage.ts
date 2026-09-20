/**
 * localStorage that never throws.
 *
 * Private browsing, a full quota, and disabled site data all make
 * localStorage throw rather than return null, and a navigation app that dies
 * because it could not save a preference is worse than one that forgets it.
 * Every call here is safe to make without a guard.
 */

export interface Store {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): boolean;
  del(key: string): void;
  /** Keys currently stored, or an empty list if storage is unavailable. */
  keys(prefix?: string): string[];
}

export const store: Store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Almost always the quota: the caller decides whether that is fatal.
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing sensible to do */
    }
  },
  keys(prefix = "") {
    try {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  },
};

export interface StorageReport {
  /** Everything this origin has in localStorage, in kB. */
  totalKB: number;
  /** The biggest keys, largest first — what is actually using the space. */
  top: Array<{ key: string; kB: number }>;
  /**
   * Whether a write of `probeKB` actually succeeded just now.
   *
   * The only question that matters when a hike will not save. localStorage
   * does not report its limit and browsers disagree about it (a WebView is
   * usually around 5 MB per origin), so asking is the only honest answer —
   * and a full quota and switched-off site data fail identically from here.
   */
  canWrite: boolean;
  /** What the failed write said, when it failed. */
  error?: string;
}

/**
 * What is in storage, and whether anything more will fit.
 *
 * Written to be read out loud from a hillside: a walker who is told a hike
 * imported and cannot find it needs to know whether it was ever saved.
 */
export function storageReport(probeKB = 64): StorageReport {
  const sizes: Array<{ key: string; kB: number }> = [];
  let total = 0;
  for (const key of store.keys()) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      /* counted as nothing, which is all that can be said */
    }
    // UTF-16 in every engine that implements it: two bytes a character.
    const bytes = ((raw?.length ?? 0) + key.length) * 2;
    total += bytes;
    sizes.push({ key, kB: Math.round(bytes / 102.4) / 10 });
  }

  const probe = "x".repeat(probeKB * 512); // 512 UTF-16 chars = 1 kB
  let canWrite = false;
  let error: string | undefined;
  try {
    localStorage.setItem("slownav:probe", probe);
    localStorage.removeItem("slownav:probe");
    canWrite = true;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  return {
    totalKB: Math.round(total / 102.4) / 10,
    top: sizes.sort((a, b) => b.kB - a.kB).slice(0, 6),
    canWrite,
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * A short stable id from a string — used to key an imported GPX by its name
 * and length so re-importing the same file does not duplicate it.
 *
 * FNV-1a: not a cryptographic hash, just a well-spread 32-bit one.
 */
export function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
