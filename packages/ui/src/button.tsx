import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";

const base =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50";

const variants = {
  primary: "bg-accent text-paper",
  secondary: "bg-paper text-ink ring-1 ring-line",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: keyof typeof variants;
};

export function Button({
  asChild = false,
  variant = "primary",
  className,
  type,
  ...props
}: ButtonProps) {
  const classes = [base, variants[variant], className].filter(Boolean).join(" ");
  if (asChild) {
    return <Slot className={classes} {...props} />;
  }
  return <button className={classes} type={type ?? "button"} {...props} />;
}
