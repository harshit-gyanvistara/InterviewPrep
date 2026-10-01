"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red) instead of the default accent. */
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

type PendingConfirm = ConfirmOptions & { kind: "confirm"; id: number; resolve: (ok: boolean) => void };
type PendingPrompt = PromptOptions & { kind: "prompt"; id: number; resolve: (value: string | null) => void };
type Pending = PendingConfirm | PendingPrompt;

interface DialogCtxValue {
  pending: Pending | null;
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  prompt: (opts: PromptOptions | string) => Promise<string | null>;
  resolveConfirm: (ok: boolean) => void;
  resolvePrompt: (value: string | null) => void;
}

const DialogCtx = createContext<DialogCtxValue | null>(null);

/**
 * App-wide replacement for window.confirm/alert/prompt. Mount once near the root; any component
 * calls useConfirm()/usePrompt() to get an async function backed by a custom modal instead of the
 * browser's native dialogs.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const normalized: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      setPending({ ...normalized, kind: "confirm", id: Date.now(), resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions | string) => {
    const normalized: PromptOptions = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<string | null>((resolve) => {
      setPending({ ...normalized, kind: "prompt", id: Date.now(), resolve });
    });
  }, []);

  const resolveConfirm = useCallback(
    (ok: boolean) => {
      if (pending?.kind === "confirm") pending.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  const resolvePrompt = useCallback(
    (value: string | null) => {
      if (pending?.kind === "prompt") pending.resolve(value);
      setPending(null);
    },
    [pending],
  );

  const value = useMemo(() => ({ pending, confirm, prompt, resolveConfirm, resolvePrompt }), [pending, confirm, prompt, resolveConfirm, resolvePrompt]);
  return <DialogCtx.Provider value={value}>{children}</DialogCtx.Provider>;
}

/** Returns an async confirm(message | options) => Promise<boolean>, replacing window.confirm. */
export function useConfirm() {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useConfirm must be used inside <DialogProvider>");
  return ctx.confirm;
}

/** Returns an async prompt(message | options) => Promise<string | null>, replacing window.prompt. */
export function usePrompt() {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("usePrompt must be used inside <DialogProvider>");
  return ctx.prompt;
}

export function useDialogState() {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useDialogState must be used inside <DialogProvider>");
  return ctx;
}
