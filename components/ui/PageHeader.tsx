import Link from "next/link";

type Props = {
  title: string;
  subtitle?: string;
  subtitleHref?: string;
  actions?: React.ReactNode;
};

export function PageHeader({ title, subtitle, subtitleHref, actions }: Props) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? (
          subtitleHref ? (
            <p className="page-subtitle">
              <Link href={subtitleHref} className="underline-offset-4 hover:underline">
                {subtitle}
              </Link>
            </p>
          ) : (
            <p className="page-subtitle">{subtitle}</p>
          )
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
