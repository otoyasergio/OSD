"use client";

export function PassportPrintButton() {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}
