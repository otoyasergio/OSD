"use client";

import { useId } from "react";
import { SearchTypeahead } from "@/components/layout/SearchTypeahead";

export function GlobalSearch() {
  const inputId = useId();

  return (
    <div className="global-search" role="search">
      <SearchTypeahead inputId={inputId} />
    </div>
  );
}
