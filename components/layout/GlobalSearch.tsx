"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";

export function GlobalSearch() {
  const router = useRouter();
  const inputId = useId();

  return (
    <form
      className="global-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const q = new FormData(form).get("q");
        const query = typeof q === "string" ? q.trim() : "";
        if (!query) {
          router.push("/dashboard?view=board");
          return;
        }
        const params = new URLSearchParams({ q: query, view: "board" });
        router.push(`/dashboard?${params.toString()}`);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        Search work orders
      </label>
      <input
        id={inputId}
        className="global-search-input"
        name="q"
        type="search"
        placeholder="Search WO #, customer, bike…"
        autoComplete="off"
        enterKeyHint="search"
      />
    </form>
  );
}
