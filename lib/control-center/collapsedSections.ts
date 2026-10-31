"use client";

import { useCallback, useSyncExternalStore } from "react";

export const CONTROL_CENTER_COLLAPSED_STORAGE_KEY =
  "otomoto.controlCenter.collapsedSections";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONTROL_CENTER_COLLAPSED_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function emitCollapsedSections() {
  for (const listener of listeners) listener();
}

/**
 * Choices made after the browser refused to store them (Safari with cookies
 * blocked throws on `localStorage`). They last for this page load only.
 */
let unstoredSections: Record<string, boolean> | null = null;

export function readCollapsedSections(): Record<string, boolean> {
  if (unstoredSections) return { ...unstoredSections };
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CONTROL_CENTER_COLLAPSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sections: Record<string, boolean> = {};
    for (const [id, collapsed] of Object.entries(parsed)) {
      if (collapsed === true) sections[id] = true;
    }
    return sections;
  } catch {
    return {};
  }
}

export function writeCollapsedSection(sectionId: string, collapsed: boolean) {
  const sections = readCollapsedSections();
  if (collapsed) sections[sectionId] = true;
  else delete sections[sectionId];
  try {
    window.localStorage.setItem(
      CONTROL_CENTER_COLLAPSED_STORAGE_KEY,
      JSON.stringify(sections)
    );
  } catch {
    unstoredSections = sections;
  }
  emitCollapsedSections();
}

function collapsedSnapshot(sectionId: string | undefined) {
  if (!sectionId) return false;
  return readCollapsedSections()[sectionId] === true;
}

/** Remember which Control Center section is shrunk. The server render stays open. */
export function useCollapsedSection(sectionId: string | undefined) {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => collapsedSnapshot(sectionId),
    () => false
  );

  const toggle = useCallback(() => {
    if (!sectionId) return;
    writeCollapsedSection(sectionId, !collapsedSnapshot(sectionId));
  }, [sectionId]);

  return {
    collapsible: Boolean(sectionId),
    collapsed: Boolean(sectionId) && collapsed,
    toggle,
  };
}
