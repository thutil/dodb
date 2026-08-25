import { useSyncExternalStore } from "react";

/**
 * Shared SQL text between the "SQL" console tab and the "Query" (visual builder) tab.
 *
 * Kept as a module-level store rather than page state so that:
 *  - the value survives a tab switch even though the views unmount, and
 *  - typing in one tab does not re-render the whole `Home` page tree.
 *
 * Mirrors the existing module-level `schemaCache` pattern in SqlConsole.tsx.
 */

let sharedSql = "";
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function getSharedSql(): string {
  return sharedSql;
}

export function setSharedSql(sql: string): void {
  if (sql === sharedSql) return;
  sharedSql = sql;
  emit();
}

export function subscribeSharedSql(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the shared SQL text. */
export function useSharedSql(): string {
  return useSyncExternalStore(subscribeSharedSql, getSharedSql, getSharedSql);
}
