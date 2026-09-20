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
