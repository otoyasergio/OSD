"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { searchShopRecords } from "@/app/(app)/actions/search";
import type { SearchResult } from "@/lib/services/globalSearch";

const DEBOUNCE_MS = 250;

const SECTION_ORDER = ["work_order", "customer", "motorcycle"] as const;

const SECTION_LABELS: Record<(typeof SECTION_ORDER)[number], string> = {
  work_order: "Work orders",
  customer: "Customers",
  motorcycle: "Motorcycles",
};

type Props = {
  inputId: string;
};

function groupResults(results: SearchResult[]) {
  return SECTION_ORDER.map((type) => ({
    type,
    label: SECTION_LABELS[type],
    items: results.filter((result) => result.type === type),
  })).filter((section) => section.items.length > 0);
}

function flatIndexFor(
  sections: ReturnType<typeof groupResults>,
  type: SearchResult["type"],
  id: string
): number {
  let index = 0;
  for (const section of sections) {
    for (const item of section.items) {
      if (item.type === type && item.id === id) return index;
      index += 1;
    }
  }
  return -1;
}

export function SearchTypeahead({ inputId }: Props) {
  const router = useRouter();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pending, startTransition] = useTransition();

  const sections = groupResults(results);
  const flatResults = sections.flatMap((section) => section.items);
  const showDropdown = open && query.trim().length > 0;

  const runSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setResults([]);
      setActiveIndex(-1);
      return;
    }

    const requestId = ++requestIdRef.current;
    startTransition(async () => {
      try {
        const next = await searchShopRecords(trimmed);
        if (requestId !== requestIdRef.current) return;
        setResults(next);
        setActiveIndex(next.length > 0 ? 0 : -1);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setActiveIndex(-1);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    function onDocumentMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function scheduleSearch(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(value);
    }, DEBOUNCE_MS);
  }

  function navigateTo(result: SearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    router.push(result.href);
  }

  function onSubmit() {
    if (activeIndex >= 0 && flatResults[activeIndex]) {
      navigateTo(flatResults[activeIndex]);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    if (flatResults[0]) {
      navigateTo(flatResults[0]);
      return;
    }
    setOpen(false);
    router.push(`/dashboard?view=board&q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div ref={rootRef} className="search-typeahead">
      <label htmlFor={inputId} className="sr-only">
        Search shop records
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="global-search-input"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-activedescendant={
          activeIndex >= 0 && flatResults[activeIndex]
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        placeholder="Name, bike, WO #, VIN…"
        autoComplete="off"
        enterKeyHint="search"
        value={query}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          setOpen(true);
          scheduleSearch(value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!flatResults.length) return;
            setOpen(true);
            setActiveIndex((current) =>
              current < flatResults.length - 1 ? current + 1 : 0
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!flatResults.length) return;
            setOpen(true);
            setActiveIndex((current) =>
              current <= 0 ? flatResults.length - 1 : current - 1
            );
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
      />
      {showDropdown ? (
        <div
          id={listboxId}
          className="search-typeahead-dropdown"
          role="listbox"
          aria-label="Search results"
        >
          {pending && results.length === 0 ? (
            <div className="search-typeahead-empty">Searching…</div>
          ) : null}
          {!pending && results.length === 0 ? (
            <div className="search-typeahead-empty">No matches</div>
          ) : null}
          {sections.map((section) => (
            <div key={section.type} className="search-typeahead-section">
              <div className="search-typeahead-section-label" aria-hidden="true">
                {section.label}
              </div>
              <ul className="search-typeahead-list">
                {section.items.map((item) => {
                  const index = flatIndexFor(sections, item.type, item.id);
                  const active = index === activeIndex;
                  return (
                    <li key={`${item.type}-${item.id}`}>
                      <button
                        type="button"
                        id={`${listboxId}-option-${index}`}
                        role="option"
                        aria-selected={active}
                        className={
                          active
                            ? "search-typeahead-option is-active"
                            : "search-typeahead-option"
                        }
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          navigateTo(item);
                        }}
                      >
                        <span className="search-typeahead-option-label">
                          {item.label}
                        </span>
                        <span className="search-typeahead-option-meta">
                          {item.meta}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
