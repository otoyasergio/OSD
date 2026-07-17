type TextFieldProps = {
  label: string;
  name: string;
  id?: string;
  type?: "text" | "email" | "tel" | "number" | "date" | "password";
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  autoComplete?: string;
  autoFocus?: boolean;
  minLength?: number;
  maxLength?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
};

export function TextField({
  label,
  name,
  id,
  type = "text",
  defaultValue,
  required,
  placeholder,
  hint,
  error,
  autoComplete,
  autoFocus,
  minLength,
  maxLength,
  autoCapitalize,
}: TextFieldProps) {
  const inputId = id ?? name;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="block">
      <label htmlFor={inputId} className="field-label">
        {label}
        {required ? <span className="ml-1 text-[var(--status-danger)]">*</span> : null}
      </label>
      <input
        id={inputId}
        className="input"
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        minLength={minLength}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span
          id={errorId}
          className="mt-1 block text-sm text-[var(--status-danger)]"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

type TextAreaFieldProps = {
  label: string;
  name: string;
  id?: string;
  defaultValue?: string | null;
  rows?: number;
  error?: string | null;
};

export function TextAreaField({
  label,
  name,
  id,
  defaultValue,
  rows = 3,
  error,
}: TextAreaFieldProps) {
  const inputId = id ?? name;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="block">
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <textarea
        id={inputId}
        className="textarea"
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
      />
      {error ? (
        <span
          id={errorId}
          className="mt-1 block text-sm text-[var(--status-danger)]"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

export { FormError } from "@/components/forms/FormError";

/** Shared class for selects outside Field components */
export const SELECT_CLASS = "select";
