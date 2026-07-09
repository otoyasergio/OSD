const INPUT_CLASS =
  "min-h-11 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

type TextFieldProps = {
  label: string;
  name: string;
  type?: "text" | "email" | "tel" | "number" | "date";
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  hint?: string;
};

export function TextField({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  placeholder,
  hint,
}: TextFieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-800">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      <input
        className={INPUT_CLASS}
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        placeholder={placeholder}
      />
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

type TextAreaFieldProps = {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
};

export function TextAreaField({
  label,
  name,
  defaultValue,
  rows = 3,
}: TextAreaFieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-800">
        {label}
      </span>
      <textarea
        className={`${INPUT_CLASS} min-h-24`}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? undefined}
      />
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {message}
    </p>
  );
}
