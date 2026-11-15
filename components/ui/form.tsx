import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const control =
  "block w-full min-h-11 rounded-ui border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger";

interface FieldProps {
  label: string;
  name: string;
  error?: string[];
  hint?: string;
  children?: ReactNode;
}

/** Label + control + hint + error, wired with aria attributes for screen readers. */
export function Field({ label, name, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error?.length && (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error?.length ? (
        <p id={`${name}-error`} className="text-xs text-danger" role="alert">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { name: string; invalid?: boolean };

export function Input({ className, invalid, name, ...props }: InputProps) {
  return (
    <input
      id={name}
      name={name}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${name}-error` : undefined}
      className={cn(control, className)}
      {...props}
    />
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { name: string; invalid?: boolean };

export function Select({ className, invalid, name, children, ...props }: SelectProps) {
  return (
    <select
      id={name}
      name={name}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${name}-error` : undefined}
      className={cn(control, className)}
      {...props}
    >
      {children}
    </select>
  );
}
