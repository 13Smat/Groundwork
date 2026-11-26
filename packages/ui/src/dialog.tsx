import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
      <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-md bg-paper p-6 text-ink shadow-lg focus:outline-none">
        <DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-2 text-base leading-relaxed text-muted">
          {description}
        </DialogPrimitive.Description>
        <div className="mt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
