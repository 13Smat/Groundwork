import type { InputHTMLAttributes } from "react";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
};

export function TextField({ id, label, className, ...props }: TextFieldProps) {
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
      <input id={id} className={classes} {...props} />
    </div>
  );
}
