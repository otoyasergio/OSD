"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AddressSuggestion } from "@/lib/address/suggestions";

const DEBOUNCE_MS = 300;

type Props = {
  defaultValue?: string | null;
  error?: string | null;
};

export function AddressAutocomplete({ defaultValue, error }: Props) {
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const [edited, setEdited] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [source, setSource] = useState<"geoapify" | "nrcan" | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = `${inputId}-hint`;
  const showDropdown = open && (loading || suggestions.length > 0);

  useEffect(() => {
    function onDocumentMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, []);

  useEffect(() => {
    const query = value.trim();
    if (!edited || query.length < 4) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/address-suggestions?q=${encodeURIComponent(query)}`,
          { cache: "no-store", signal: controller.signal }
        );
        const body = (await response.json()) as {
          suggestions?: AddressSuggestion[];
          source?: "geoapify" | "nrcan";
        };
        if (!response.ok) throw new Error("ADDRESS_SEARCH_FAILED");
        const next = body.suggestions ?? [];
        setSource(body.source ?? null);
        setSuggestions(next);
        setActiveIndex(next.length > 0 ? 0 : -1);
        setOpen(next.length > 0);
      } catch (fetchError) {
        if ((fetchError as Error).name !== "AbortError") {
          setSuggestions([]);
          setActiveIndex(-1);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [edited, value]);

  function selectSuggestion(suggestion: AddressSuggestion) {
    setValue(suggestion.label);
    setEdited(false);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    setStatusMessage(
      suggestion.postalCode
        ? `Postal code ${suggestion.postalCode} added.`
        : "Include the postal code manually while the fallback lookup is active."
    );
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (!suggestions.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current < suggestions.length - 1 ? current + 1 : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && open && suggestions.length > 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex] ?? suggestions[0]);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={rootRef} className="customer-picker block">
      <label htmlFor={inputId} className="field-label">
        Address
      </label>
      <input
        id={inputId}
        className="input"
        name="address"
        type="text"
        role="combobox"
        value={value}
        autoComplete="street-address"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ")}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          setEdited(true);
          setStatusMessage("");
          if (nextValue.trim().length < 4) {
            setLoading(false);
            setSuggestions([]);
            setActiveIndex(-1);
            setOpen(false);
          } else {
            setOpen(true);
          }
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={onInputKeyDown}
      />
      <span id={hintId} className="field-hint">
        {source === "nrcan"
          ? "Free fallback active. Include the postal code manually."
          : "Start with the street number and name; the postal code is added after selection."}
      </span>
      {source === "geoapify" ? (
        <a
          className="mt-1 block text-xs text-[var(--muted)] underline"
          href="https://www.geoapify.com/"
          target="_blank"
          rel="noreferrer"
        >
          Powered by Geoapify
        </a>
      ) : null}
      {statusMessage ? (
        <span className="mt-1 block text-sm text-[var(--muted)]" role="status">
          {statusMessage}
        </span>
      ) : null}
      {error ? (
        <span
          id={errorId}
          className="mt-1 block text-sm text-[var(--status-danger)]"
          role="alert"
        >
          {error}
        </span>
      ) : null}
      {showDropdown ? (
        <div
          id={listboxId}
          className="customer-picker-dropdown"
          role="listbox"
          aria-label="Address suggestions"
        >
          {loading && suggestions.length === 0 ? (
            <div className="customer-picker-empty">Searching addresses…</div>
          ) : null}
          {suggestions.length > 0 ? (
            <ul className="customer-picker-list">
              {suggestions.map((suggestion, index) => {
                const active = index === activeIndex;
                return (
                  <li key={`${suggestion.label}-${index}`}>
                    <button
                      type="button"
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={active}
                      className={
                        active
                          ? "customer-picker-option is-active"
                          : "customer-picker-option"
                      }
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectSuggestion(suggestion)}
                    >
                      <span className="customer-picker-option-label">
                        {suggestion.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
