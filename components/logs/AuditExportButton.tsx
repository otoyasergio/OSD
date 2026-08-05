"use client";

import type { AuditLogEntry } from "@/lib/services/audit";

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function AuditExportButton({ entries }: { entries: AuditLogEntry[] }) {
  function download() {
    const header = [
      "created_at",
      "actor",
      "location",
      "action",
      "entity_type",
      "entity_id",
      "description",
    ];
    const rows = entries.map((entry) => [
      entry.created_at,
      entry.actor ? `${entry.actor.first_name} ${entry.actor.last_name}` : "",
      entry.location?.name ?? "",
      entry.action,
      entry.entity_type,
      entry.entity_id ?? "",
      entry.description,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(String(cell))).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={download}
      disabled={entries.length === 0}
    >
      Export CSV
    </button>
  );
}
