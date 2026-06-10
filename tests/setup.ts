import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom provides a localStorage implementation, but we guard against
// environments where it is missing and ensure a clean slate per test.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // Unmount any rendered React trees and reset DOM/localStorage between tests.
  cleanup();
  localStorage.clear();
});
