"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadFitmentMakesAction,
  loadFitmentModelsAction,
  loadFitmentPartsAction,
  loadFitmentYearsAction,
} from "@/app/(app)/parts/fitment-actions";
import type { FitmentPartMatch } from "@/lib/services/fitment";
import { FormError } from "@/components/forms/Field";

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base";

type Props = {
  initialYear?: number;
  initialMake?: string;
  initialModel?: string;
  onAddPart?: (part: {
    part_name: string;
    part_number: string;
    unit_price: string;
    catalog_source: "parts_canada";
  }) => void;
};

export function YmmFitmentFilter({
  initialYear,
  initialMake,
  initialModel,
  onAddPart,
}: Props) {
  const [years, setYears] = useState<number[]>([]);
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [year, setYear] = useState(String(initialYear ?? ""));
  const [make, setMake] = useState(initialMake ?? "");
  const [model, setModel] = useState(initialModel ?? "");
  const [specs, setSpecs] = useState<{ field: string; label: string; value: string }[]>([]);
  const [parts, setParts] = useState<FitmentPartMatch[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadFitmentYearsAction()
      .then((rows) => {
        if (!cancelled) setYears(rows);
      })
      .catch(() => {
        if (!cancelled) setYears([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!year) return;
    let cancelled = false;
    loadFitmentMakesAction(Number(year))
      .then((rows) => {
        if (!cancelled) setMakes(rows);
      })
      .catch(() => {
        if (!cancelled) setMakes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  useEffect(() => {
    if (!year || !make) return;
    let cancelled = false;
    loadFitmentModelsAction(Number(year), make)
      .then((rows) => {
        if (!cancelled) setModels(rows);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [year, make]);

  useEffect(() => {
    if (!year || !make || !model) return;
    let cancelled = false;
    startTransition(async () => {
      try {
        const result = await loadFitmentPartsAction(Number(year), make, model);
        if (cancelled) return;
        if (!result) {
          setSpecs([]);
          setParts([]);
          setError("No fitment data for this Year / Make / Model.");
          return;
        }
        setError(null);
        setSpecs(result.specs);
        setParts(result.parts);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load fitment.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [year, make, model]);

  const filteredParts = parts.filter((part) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      part.label.toLowerCase().includes(q) ||
      part.value.toLowerCase().includes(q) ||
      part.catalog_hit?.part_number.toLowerCase().includes(q) ||
      part.catalog_hit?.description_en?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">Year</span>
          <select
            className={SELECT_CLASS}
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setMake("");
              setModel("");
              setMakes([]);
              setModels([]);
              setSpecs([]);
              setParts([]);
              setError(null);
            }}
          >
            <option value="">Select year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Make</span>
          <select
            className={SELECT_CLASS}
            value={make}
            disabled={!year}
            onChange={(e) => {
              setMake(e.target.value);
              setModel("");
              setModels([]);
              setSpecs([]);
              setParts([]);
              setError(null);
            }}
          >
            <option value="">Select make</option>
            {makes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Model</span>
          <select
            className={SELECT_CLASS}
            value={model}
            disabled={!make}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Select model</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pending ? <p className="text-sm text-zinc-500">Loading fitment…</p> : null}
      {error ? <FormError message={error} /> : null}

      {specs.length > 0 ? (
        <div className="rounded border border-zinc-200 bg-zinc-50 p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Vehicle specs
          </h3>
          <dl className="grid gap-1 sm:grid-cols-2">
            {specs.map((spec) => (
              <div key={spec.field} className="text-sm">
                <dt className="text-zinc-500">{spec.label}</dt>
                <dd className="font-medium text-zinc-900">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {parts.length > 0 ? (
        <>
          <label className="block">
            <span className="field-label">Filter parts</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Part name, number, or description…"
              className={SELECT_CLASS}
            />
          </label>
          <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
            {filteredParts.map((part) => (
              <li
                key={part.field}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-zinc-900">{part.label}</p>
                  <p className="text-sm text-zinc-600">{part.value}</p>
                  {part.catalog_hit ? (
                    <p className="text-xs text-zinc-500">
                      PC {part.catalog_hit.part_number}
                      {part.catalog_hit.msrp != null
                        ? ` · MSRP $${part.catalog_hit.msrp.toFixed(2)}`
                        : ""}
                      {part.catalog_hit.stock != null
                        ? ` · Stock ${part.catalog_hit.stock}`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700">Not in Parts Canada catalog</p>
                  )}
                </div>
                {onAddPart && part.catalog_hit ? (
                  <button
                    type="button"
                    className="btn btn-secondary shrink-0"
                    onClick={() =>
                      onAddPart({
                        part_name: part.catalog_hit!.description_en ?? part.label,
                        part_number: part.catalog_hit!.part_number,
                        unit_price:
                          part.catalog_hit!.msrp != null
                            ? String(part.catalog_hit!.msrp)
                            : "",
                        catalog_source: "parts_canada",
                      })
                    }
                  >
                    Add to job
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
