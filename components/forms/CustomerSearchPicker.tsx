"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { searchCustomersAction } from "@/app/(app)/customers/actions";
import type { Customer } from "@/lib/services/customers";
import { customerPickerInterimResults } from "@/lib/forms/customerSearch";

const DEBOUNCE_MS = 200;

const INPUT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

type Props = {
  value: string;
  /** Seed options (e.g. first page) and lookup for a preselected customer. */
  initialCustomers: Customer[];
  onChange: (customerId: string, customer: Customer | null) => void;
  required?: boolean;
  disabled?: boolean;
};

function formatCustomerLabel(customer: Customer): string {
  return `${customer.last_name}, ${customer.first_name}`;
}

function formatCustomerMeta(customer: Customer): string {
  const parts: string[] = [];
  if (customer.phone) parts.push(customer.phone);
  if (customer.email) parts.push(customer.email);
  return parts.join(" · ");
}

export function CustomerSearchPicker({
  value,
  initialCustomers,
  onChange,
  required = false,
  disabled = false,
}: Props) {
  const listboxId = useId();
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>(initialCustomers);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [knownCustomers, setKnownCustomers] = useState<Customer[]>(initialCustomers);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = useMemo(
    () => knownCustomers.find((c) => c.customer_id === value) ?? null,
    [knownCustomers, value]
  );

  const showDropdown = open && !disabled;

  const mergeKnown = useCallback((rows: Customer[]) => {
    setKnownCustomers((prev) => {
      const byId = new Map(prev.map((c) => [c.customer_id, c]));
      for (const row of rows) byId.set(row.customer_id, row);
      return [...byId.values()];
    });
  }, []);

  const runSearch = useCallback(
    (term: string) => {
      const requestId = ++requestIdRef.current;
      setSearching(true);
      startTransition(async () => {
        try {
          const next = await searchCustomersAction(term);
          if (requestId !== requestIdRef.current) return;
          setResults(next);
          mergeKnown(next);
          setActiveIndex(next.length > 0 ? 0 : -1);
        } catch {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setActiveIndex(-1);
        } finally {
          if (requestId === requestIdRef.current) setSearching(false);
        }
      });
    },
    [mergeKnown]
  );

  function scheduleSearch(term: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearching(true);
    debounceRef.current = setTimeout(() => runSearch(term), DEBOUNCE_MS);
  }

  function cancelPendingSearch() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    requestIdRef.current += 1;
    setSearching(false);
  }

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

  function selectCustomer(customer: Customer) {
    cancelPendingSearch();
    mergeKnown([customer]);
    onChange(customer.customer_id, customer);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  }

  function clearSelection() {
    cancelPendingSearch();
    onChange("", null);
    setQuery("");
    setResults(initialCustomers);
    setActiveIndex(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!results.length) return;
      setOpen(true);
      setActiveIndex((current) => (current < results.length - 1 ? current + 1 : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!results.length) return;
      setOpen(true);
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const choice = results[activeIndex] ?? results[0];
      if (choice) selectCustomer(choice);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  if (selected) {
    return (
      <div className="customer-picker">
        <div className="customer-picker-selected">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground">
              {formatCustomerLabel(selected)}
            </div>
            {formatCustomerMeta(selected) ? (
              <div className="truncate text-sm text-[var(--status-neutral)]">
                {formatCustomerMeta(selected)}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-secondary shrink-0"
            onClick={clearSelection}
            disabled={disabled}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="customer-picker">
      <label htmlFor={inputId} className="sr-only">
        Search customers by name, email, or phone
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className={INPUT_CLASS}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-required={required || undefined}
        aria-activedescendant={
          activeIndex >= 0 && results[activeIndex]
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        placeholder="Search name, email, or phone…"
        autoComplete="off"
        enterKeyHint="search"
        disabled={disabled}
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          const interim = customerPickerInterimResults(knownCustomers, next);
          setQuery(next);
          setResults(interim);
          setActiveIndex(interim.length > 0 ? 0 : -1);
          setOpen(true);
          scheduleSearch(next);
        }}
        onFocus={() => {
          setOpen(true);
          if (!query.trim() && results.length === 0) {
            runSearch("");
          }
        }}
        onKeyDown={onInputKeyDown}
      />
      {showDropdown ? (
        <div
          id={listboxId}
          className="customer-picker-dropdown"
          role="listbox"
          aria-label="Customer matches"
        >
          {(searching || pending) && results.length === 0 ? (
            <div className="customer-picker-empty">Searching…</div>
          ) : null}
          {!searching && !pending && results.length === 0 ? (
            <div className="customer-picker-empty">No customers found</div>
          ) : null}
          {results.length > 0 ? (
            <ul className="customer-picker-list">
              {results.map((customer, index) => {
                const active = index === activeIndex;
                return (
                  <li key={customer.customer_id}>
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
                      onClick={() => selectCustomer(customer)}
                    >
                      <span className="customer-picker-option-label">
                        {formatCustomerLabel(customer)}
                      </span>
                      {formatCustomerMeta(customer) ? (
                        <span className="customer-picker-option-meta">
                          {formatCustomerMeta(customer)}
                        </span>
                      ) : null}
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
