"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { searchPartsCanadaAction } from "@/app/(app)/work_orders/part-actions";
import type { PartsCanadaSearchHit } from "@/lib/services/partsCanadaCatalog";

export type PartsCanadaSelection = {
  part_name: string;
  part_number: string;
  supplier: string;
  unit_price: string;
  unit_cost: string;
  supplier_stock: string;
  catalog_source: "parts_canada";
};

type Props = {
  canViewCost: boolean;
  canViewPricing?: boolean;
  onSelect: (selection: PartsCanadaSelection) => void;
};

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

export function PartsCanadaFinder({
  canViewCost,
  canViewPricing = true,
  onSelect,
}: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PartsCanadaSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pending, startTransition] = useTransition();

  const runSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setActiveIndex(-1);
      return;
    }

    const requestId = ++requestIdRef.current;
    startTransition(async () => {
      const next = await searchPartsCanadaAction(trimmed);
      if (requestId !== requestIdRef.current) return;
      setResults(next);
      setActiveIndex(next.length > 0 ? 0 : -1);
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

  function pick(hit: PartsCanadaSearchHit) {
    onSelect({
      part_name:
        [hit.brand, hit.description_en].filter(Boolean).join(" — ") || hit.part_number,
      part_number: hit.part_number,
      supplier: "Parts Canada",
      unit_price: hit.msrp != null ? String(hit.msrp) : "",
      unit_cost: hit.dealer_price != null ? String(hit.dealer_price) : "",
      supplier_stock: hit.stock != null ? String(hit.stock) : "",
      catalog_source: "parts_canada",
    });
    setQuery(hit.part_number);
    setOpen(false);
    setResults([]);
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground">
          Find Parts Canada part
        </span>
        <input
          type="search"
          value={query}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder="Part #, brand, or description…"
          className="min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]"
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            setOpen(true);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => runSearch(value), 250);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (!open || results.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              const hit = results[activeIndex];
              if (hit) pick(hit);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </label>
      <p className="mt-1 text-xs text-[var(--status-neutral)]">
        Searches the local Parts Canada catalog (synced daily).{" "}
        {pending ? "Searching…" : null}
      </p>

      {open && query.trim().length >= 2 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-[var(--border)] bg-white shadow-lg"
        >
          {results.length === 0 && !pending ? (
            <li className="px-3 py-3 text-sm text-[var(--status-neutral)]">
              No catalog matches. Sync the catalog from the Parts page if it is empty.
            </li>
          ) : null}
          {results.map((hit, index) => (
            <li key={hit.part_number} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)] ${
                  index === activeIndex ? "bg-[var(--surface-muted)]" : ""
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(hit)}
              >
                <span className="font-semibold text-foreground">
                  {hit.part_number}
                  {hit.brand ? ` · ${hit.brand}` : ""}
                </span>
                <span className="text-[var(--status-neutral)]">
                  {hit.description_en || "No description"}
                </span>
                <span className="text-xs text-[var(--status-neutral)]">
                  {canViewPricing ? `MSRP ${money(hit.msrp)}` : null}
                  {canViewPricing && canViewCost
                    ? ` · Cost ${money(hit.dealer_price)}`
                    : canViewCost
                      ? `Cost ${money(hit.dealer_price)}`
                      : ""}
                  {hit.stock != null ? ` · Stock ${hit.stock}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
