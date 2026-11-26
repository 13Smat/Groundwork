import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  placement = "center",
  initialFocusId,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  placement?: "center" | "end";
  /** Move focus to this control when the dialog opens. */
  initialFocusId?: string;
}) {
  const frame =
    placement === "end"
      ? "fixed inset-y-0 right-0 z-50 flex h-full w-[min(100%,32rem)] flex-col overflow-y-auto bg-paper p-6 text-ink shadow-lg focus:outline-none"
      : "fixed left-1/2 top-1/2 z-50 max-h-[min(100%-2rem,48rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md bg-paper p-6 text-ink shadow-lg focus:outline-none";
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
      <DialogPrimitive.Content
        className={frame}
        onOpenAutoFocus={(event) => {
          if (!initialFocusId) {
            return;
          }
          const node = document.getElementById(initialFocusId);
          if (!(node instanceof HTMLElement)) {
            return;
          }
          event.preventDefault();
          node.focus();
        }}
      >
        <DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-2 text-base leading-relaxed text-muted">
          {description}
        </DialogPrimitive.Description>
        <div className="mt-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
