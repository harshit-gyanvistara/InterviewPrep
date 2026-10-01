"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useDialogState, type PromptOptions, type ConfirmOptions } from "@/lib/dialogContext";

type Pending = (ConfirmOptions & { kind: "confirm"; id: number }) | (PromptOptions & { kind: "prompt"; id: number });

/** The one custom modal used everywhere instead of window.confirm/alert/prompt. Mounted once at the root. */
export function ConfirmDialog() {
  const { pending, resolveConfirm, resolvePrompt } = useDialogState();
  if (!pending) return null;
  // Keyed by request id so a new dialog request gets fresh input state, instead of an effect
  // syncing local state to the changing `pending` object.
  return <DialogBody key={pending.id} pending={pending} resolveConfirm={resolveConfirm} resolvePrompt={resolvePrompt} />;
}

function DialogBody({ pending, resolveConfirm, resolvePrompt }: { pending: Pending; resolveConfirm: (ok: boolean) => void; resolvePrompt: (v: string | null) => void }) {
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(pending.kind === "prompt" ? (pending.defaultValue ?? "") : "");

  useEffect(() => {
    if (pending.kind === "prompt") inputRef.current?.select();
    else confirmBtn.current?.focus();
  }, [pending.kind]);

  const submit = () => {
    if (pending.kind === "prompt") resolvePrompt(value.trim());
    else resolveConfirm(true);
  };
  const cancel = () => {
    if (pending.kind === "prompt") resolvePrompt(null);
    else resolveConfirm(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter" && pending.kind === "confirm") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const danger = pending.kind === "confirm" && pending.danger;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <button aria-label="Cancel" className="absolute inset-0 bg-black/40" onClick={cancel} />
      <div role="alertdialog" aria-modal className="glass relative w-full max-w-sm rounded-[1.75rem] p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          {danger && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger/15 text-danger">
              <AlertTriangle size={18} />
            </span>
          )}
          <div className="flex-1">
            {pending.title && <h2 className="text-lg font-medium">{pending.title}</h2>}
            {pending.message && <p className={`text-sm text-muted ${pending.title ? "mt-1" : ""}`}>{pending.message}</p>}
            {pending.kind === "prompt" && (
              <input
                ref={inputRef}
                className="input mt-3"
                value={value}
                placeholder={pending.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={cancel}>
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button ref={confirmBtn} className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={submit}>
            {pending.confirmLabel ?? (pending.kind === "prompt" ? "Save" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
