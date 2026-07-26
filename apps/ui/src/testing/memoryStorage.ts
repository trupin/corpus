/**
 * In-memory `Storage` doubles for the jsdom suites.
 *
 * They exist because the ambient `localStorage` under test is not dependable:
 * Node 25 defines its own Web Storage global, which shadows jsdom's and is
 * inert unless `--localstorage-file` points somewhere real. Stubbing
 * `globalThis.localStorage` with one of these keeps the storage tests about
 * `theme.ts`'s behaviour instead of the runner's environment — the real
 * `localStorage` path is covered end-to-end by `e2e/smoke.spec.ts`, in a real
 * browser, which is the only place that evidence is worth anything.
 */

export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
}

/** Models Safari private mode and sandboxed frames, where access throws. */
export function throwingStorage(): Storage {
  const reject = (): never => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    get length(): number {
      return reject();
    },
    clear: reject,
    getItem: reject,
    key: reject,
    removeItem: reject,
    setItem: reject,
  };
}
