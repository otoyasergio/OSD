"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

type SearchScope = "work_orders" | "customers" | "motorcycles";

const SCOPE_OPTIONS: { value: SearchScope; label: string }[] = [
  { value: "work_orders", label: "Work orders" },
  { value: "customers", label: "Customers" },
  { value: "motorcycles", label: "Motorcycles" },
];

function buildSearchHref(scope: SearchScope, query: string): string {
  if (!query) {
    if (scope === "customers") return "/customers";
    if (scope === "motorcycles") return "/motorcycles";
    return "/dashboard?view=board";
  }

  const params = new URLSearchParams({ q: query });
  if (scope === "customers") return `/customers?${params.toString()}`;
  if (scope === "motorcycles") return `/motorcycles?${params.toString()}`;
  params.set("view", "board");
  return `/dashboard?${params.toString()}`;
}

export function GlobalSearch() {
  const router = useRouter();
  const inputId = useId();
  const scopeId = useId();
  const [scope, setScope] = useState<SearchScope>("work_orders");

  return (
    <form
      className="global-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const q = formData.get("q");
        const query = typeof q === "string" ? q.trim() : "";
        const scopeField = formData.get("scope");
        let activeScope: SearchScope =
          scopeField === "customers" || scopeField === "motorcycles"
            ? scopeField
            : "work_orders";
        if (query && /^wo-?\d+/i.test(query)) {
          activeScope = "work_orders";
        }
        router.push(buildSearchHref(activeScope, query));
      }}
    >
      <label htmlFor={scopeId} className="sr-only">
        Search scope
      </label>
      <select
        id={scopeId}
        className="global-search-scope"
        name="scope"
        value={scope}
        onChange={(event) => setScope(event.target.value as SearchScope)}
        aria-label="Search scope"
      >
        {SCOPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label htmlFor={inputId} className="sr-only">
        Search shop records
      </label>
      <input
        id={inputId}
        className="global-search-input"
        name="q"
        type="search"
        placeholder="Name, bike, WO #, VIN…"
        autoComplete="off"
        enterKeyHint="search"
      />
    </form>
  );
}
