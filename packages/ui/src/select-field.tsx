import type { SelectHTMLAttributes } from "react";

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
};

export function SelectField({ id, label, className, children, ...props }: SelectFieldProps) {
  const classes = [
    "min-h-11 w-full rounded-md border border-line bg-paper px-3 text-base text-ink",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <select id={id} className={classes} {...props}>
        {children}
      </select>
    </div>
  );
}
