export type StageChipTone = "teal" | "orange" | "muted" | "danger";

export function stageChipClass(tone: StageChipTone): string {
  return `stage-chip stage-chip--${tone}`;
}

export function StageChip({
  label,
  tone = "teal",
}: {
  label: string;
  tone?: StageChipTone;
}) {
  return <span className={stageChipClass(tone)}>{label}</span>;
}
