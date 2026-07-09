type Props = {
  title?: string;
  description: string;
};

export function EmptyState({ title, description }: Props) {
  return (
    <div className="empty-state">
      {title ? <p className="empty-state-title">{title}</p> : null}
      <p className={title ? "empty-state-desc" : undefined}>{description}</p>
    </div>
  );
}
