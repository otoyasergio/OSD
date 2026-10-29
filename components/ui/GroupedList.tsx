import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type GroupedListItem = {
  href: string;
  label: string;
  description?: string;
};

type Props = {
  heading?: string;
  items: GroupedListItem[];
};

export function GroupedList({ heading, items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="ios-grouped">
      {heading ? <h2 className="ios-grouped-header">{heading}</h2> : null}
      <ul className="ios-grouped-list">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="ios-grouped-row">
              <span className="ios-grouped-copy">
                <span className="ios-grouped-title">{item.label}</span>
                {item.description ? (
                  <span className="ios-grouped-subtitle">{item.description}</span>
                ) : null}
              </span>
              <ChevronRight className="ios-grouped-chevron" size={18} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
