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
      <span className="field-label">
        {label}
        {required ? <span className="ml-1 text-[var(--status-danger)]">*</span> : null}
      </span>
      <input
        className="input"
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        placeholder={placeholder}
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
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
      <span className="field-label">{label}</span>
      <textarea
        className="textarea"
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
    <p role="alert" className="alert-error">
      {message}
    </p>
  );
}

/** Shared class for selects outside Field components */
export const SELECT_CLASS = "select";
