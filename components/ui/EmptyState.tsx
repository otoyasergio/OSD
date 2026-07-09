import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title?: string;
  description: string;
  action?: {
    href: string;
    label: string;
  };
  children?: ReactNode;
};

export function EmptyState({ title, description, action, children }: Props) {
  return (
    <div className="empty-state">
      {title ? <p className="empty-state-title">{title}</p> : null}
      <p className={title ? "empty-state-desc" : undefined}>{description}</p>
      {action ? (
        <div className="empty-state-action">
          <Link href={action.href} className="btn btn-primary">
            {action.label}
          </Link>
        </div>
      ) : null}
      {children}
    </div>
  );
}
