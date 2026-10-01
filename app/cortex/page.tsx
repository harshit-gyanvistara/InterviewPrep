"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { CortexEditor } from "@/components/cortex/CortexEditor";
import { db, uid, useBinders, useCortexPage, useCortexPages } from "@/lib/db";
import { useConfirm, usePrompt } from "@/lib/dialogContext";
import { BINDER_ICONS, PAGE_ICONS, createPage, ensureSeedBinders, htmlToText, wordCount } from "@/lib/cortex";
import type { Binder, CortexPage } from "@/lib/types";

export default function CortexRoute() {
  return (
    <Suspense>
      <CortexApp />
    </Suspense>
  );
}

function CortexApp() {
  const router = useRouter();
  const params = useSearchParams();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const { data: binders, loading: bindersLoading } = useBinders();
  const seededRef = useRef(false);
  useEffect(() => {
    if (!bindersLoading && binders && binders.length === 0 && !seededRef.current) {
      seededRef.current = true;
      ensureSeedBinders();
    }
  }, [bindersLoading, binders]);

  const binderId = params.get("binder") ?? binders?.[0]?.id;
  const pageIdParam = params.get("page") ?? undefined;

  const { data: pages = [] } = useCortexPages(binderId);
  const pageId = pageIdParam ?? pages[0]?.id;
  const { data: page } = useCortexPage(pageId);

  const goto = (b?: string, p?: string) => {
    const qs = new URLSearchParams();
    if (b) qs.set("binder", b);
    if (p) qs.set("page", p);
    router.replace(`/cortex${qs.toString() ? `?${qs}` : ""}`);
  };

  const [mobilePane, setMobilePane] = useState<"binders" | "pages" | "editor">(pageIdParam ? "editor" : binderId ? "pages" : "binders");

  const selectBinder = (id: string) => {
    goto(id, undefined);
    setMobilePane("pages");
  };
  const selectPage = (bId: string, pId: string) => {
    goto(bId, pId);
    setMobilePane("editor");
  };

  const newBinder = async () => {
    const name = (await prompt({ title: "New binder", placeholder: "e.g. System Design" }))?.trim();
    if (!name) return;
    const icon = BINDER_ICONS[Math.floor(Math.random() * BINDER_ICONS.length)];
    const binder: Binder = { id: uid(), name, icon, createdAt: Date.now() };
    await db.binders.put(binder);
    selectBinder(binder.id);
  };

  const newPage = async (bId: string) => {
    const p = await createPage(bId);
    selectPage(bId, p.id);
  };

  const deleteBinder = async (b: Binder) => {
    const ok = await confirm({ title: `Delete "${b.name}"?`, message: "This deletes the binder and every page inside it. This cannot be undone.", confirmLabel: "Delete binder", danger: true });
    if (!ok) return;
    const its = (await db.cortexPages.list()).filter((p) => p.binderId === b.id);
    for (const p of its) await db.cortexPages.remove(p.id);
    await db.binders.remove(b.id);
    if (binderId === b.id) goto(undefined, undefined);
  };

  const renameBinder = async (b: Binder) => {
    const name = (await prompt({ title: "Rename binder", defaultValue: b.name }))?.trim();
    if (!name) return;
    await db.binders.put({ ...b, name });
  };

  const deletePage = async (p: CortexPage) => {
    const ok = await confirm({ message: `Delete "${p.title}"?`, danger: true });
    if (!ok) return;
    await db.cortexPages.remove(p.id);
    if (pageId === p.id) goto(binderId, undefined);
  };

  if (bindersLoading || !binders) return null;

  return (
    <div className="grid h-[75vh] gap-4 lg:h-full lg:grid-cols-[220px_280px_1fr]">
      <BinderList
        binders={binders}
        selectedId={binderId}
        onSelect={selectBinder}
        onNew={newBinder}
        onRename={renameBinder}
        onDelete={deleteBinder}
        className={mobilePane === "binders" ? "" : "hidden lg:flex"}
      />
      <PageList
        binder={binders.find((b) => b.id === binderId)}
        pages={pages}
        selectedId={pageId}
        onSelect={(id) => binderId && selectPage(binderId, id)}
        onNew={() => binderId && newPage(binderId)}
        onDelete={deletePage}
        onBack={() => setMobilePane("binders")}
        className={mobilePane === "pages" ? "" : "hidden lg:flex"}
      />
      <PageEditor page={page} onBack={() => setMobilePane("pages")} className={mobilePane === "editor" ? "" : "hidden lg:block"} />
    </div>
  );
}

function BinderList({
  binders,
  selectedId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  className,
}: {
  binders: Binder[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (b: Binder) => void;
  onDelete: (b: Binder) => void;
  className: string;
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-3xl bg-card p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Binders</h2>
        <button onClick={onNew} aria-label="New binder" className="grid h-7 w-7 place-items-center rounded-full hover:bg-soft">
          <Plus size={15} />
        </button>
      </div>
      <div className="grid gap-1 overflow-y-auto">
        {binders.map((b) => (
          <div key={b.id} className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm ${selectedId === b.id ? "bg-accent text-accent-ink" : "hover:bg-soft"}`}>
            <button onClick={() => onSelect(b.id)} className="flex flex-1 items-center gap-2 text-left">
              <span>{b.icon}</span>
              <span className="truncate">{b.name}</span>
            </button>
            <span className={`flex shrink-0 opacity-0 group-hover:opacity-100`}>
              <button onClick={() => onRename(b)} aria-label={`Rename ${b.name}`} className={`grid h-6 w-6 place-items-center rounded-full ${selectedId === b.id ? "hover:bg-white/15" : "hover:bg-card"}`}>
                <Pencil size={12} />
              </button>
              <button onClick={() => onDelete(b)} aria-label={`Delete ${b.name}`} className={`grid h-6 w-6 place-items-center rounded-full ${selectedId === b.id ? "hover:bg-white/15" : "hover:bg-card"}`}>
                <Trash2 size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageList({
  binder,
  pages,
  selectedId,
  onSelect,
  onNew,
  onDelete,
  onBack,
  className,
}: {
  binder?: Binder;
  pages: CortexPage[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (p: CortexPage) => void;
  onBack: () => void;
  className: string;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.title.toLowerCase().includes(q) || htmlToText(p.contentHtml).toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)));
  }, [pages, query]);

  return (
    <div className={`flex flex-col gap-3 rounded-3xl bg-card p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="grid h-7 w-7 place-items-center rounded-full hover:bg-soft lg:hidden" aria-label="Back to binders">
          <ArrowLeft size={15} />
        </button>
        <h2 className="flex-1 truncate text-sm font-semibold">{binder ? `${binder.icon} ${binder.name}` : "Select a binder"}</h2>
        {binder && (
          <button onClick={onNew} aria-label="New page" className="grid h-7 w-7 place-items-center rounded-full hover:bg-soft">
            <Plus size={15} />
          </button>
        )}
      </div>
      {binder && (
        <label className="relative">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input py-2 pl-8 text-sm" placeholder="Search this binder…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      <div className="grid flex-1 content-start gap-1 overflow-y-auto">
        {!binder ? (
          <p className="p-3 text-sm text-muted">Pick or create a binder to see its pages.</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-sm text-muted">{pages.length === 0 ? "No pages yet." : "Nothing matches."}</p>
        ) : (
          shown.map((p) => (
            <div key={p.id} className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm ${selectedId === p.id ? "bg-accent text-accent-ink" : "hover:bg-soft"}`}>
              <button onClick={() => onSelect(p.id)} className="flex flex-1 items-center gap-2 overflow-hidden text-left">
                <span>{p.icon}</span>
                <span className="flex-1 truncate">
                  <span className="block truncate font-medium">{p.title || "Untitled"}</span>
                  <span className={`block truncate text-xs ${selectedId === p.id ? "opacity-70" : "text-muted"}`}>{new Date(p.updatedAt).toLocaleDateString()}</span>
                </span>
                {p.pinned && <Pin size={12} className="shrink-0" />}
              </button>
              <button
                onClick={() => onDelete(p)}
                aria-label={`Delete ${p.title}`}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-0 group-hover:opacity-100 ${selectedId === p.id ? "hover:bg-white/15" : "hover:bg-card"}`}
              >
                <Trash2 size={12} />
              </button>
              <ChevronRight size={13} className={`shrink-0 lg:hidden ${selectedId === p.id ? "" : "text-muted"}`} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PageEditor({ page, onBack, className }: { page?: CortexPage; onBack: () => void; className: string }) {
  if (!page) {
    return (
      <div className={`grid place-items-center rounded-3xl bg-card p-8 text-center ${className}`}>
        <div>
          <Sparkles className="mx-auto mb-3 text-muted" size={28} />
          <p className="text-sm text-muted">Pick a page, or create one, to start writing.</p>
        </div>
      </div>
    );
  }
  // Keyed by page.id so switching pages remounts this with fresh state, instead of an effect
  // syncing local state to a changing prop.
  return <PageEditorInner key={page.id} page={page} onBack={onBack} className={className} />;
}

function PageEditorInner({ page, onBack, className }: { page: CortexPage; onBack: () => void; className: string }) {
  const confirm = useConfirm();
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [html, setHtml] = useState(page.contentHtml);
  const [showIcons, setShowIcons] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = (patch: Partial<CortexPage>) => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await db.cortexPages.put({ ...page, title, icon, contentHtml: html, ...patch, updatedAt: Date.now() });
      setSaveState("saved");
    }, 500);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const words = wordCount(html);

  return (
    <div className={`flex flex-col rounded-3xl bg-card p-5 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="grid h-7 w-7 place-items-center rounded-full hover:bg-soft lg:hidden" aria-label="Back to pages">
          <ArrowLeft size={15} />
        </button>
        <div className="relative">
          <button onClick={() => setShowIcons((v) => !v)} className="grid h-9 w-9 place-items-center rounded-xl bg-soft text-lg">
            {icon}
          </button>
          {showIcons && (
            <div className="glass absolute left-0 top-11 z-20 grid grid-cols-8 gap-1 rounded-2xl p-2 shadow-xl">
              {PAGE_ICONS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setIcon(e);
                    setShowIcons(false);
                    scheduleSave({ icon: e });
                  }}
                  className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-soft"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
          placeholder="Untitled page"
          className="flex-1 bg-transparent text-xl font-medium outline-none"
        />
        <button
          onClick={() => {
            const next = !page.pinned;
            db.cortexPages.put({ ...page, pinned: next });
          }}
          aria-label={page.pinned ? "Unpin" : "Pin"}
          className={`grid h-8 w-8 place-items-center rounded-full hover:bg-soft ${page.pinned ? "text-accent" : "text-muted"}`}
        >
          {page.pinned ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <button
          onClick={async () => (await confirm({ message: `Delete "${page.title}"?`, danger: true })) && db.cortexPages.remove(page.id)}
          aria-label="Delete page"
          className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-soft hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <CortexEditor
          key={page.id}
          content={html}
          pageTitle={title}
          onChange={(next) => {
            setHtml(next);
            scheduleSave({ contentHtml: next });
          }}
          placeholder="Write your prep material — headings, checklists, code, anything."
        />
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          {saveState === "saving" && <>Saving…</>}
          {saveState === "saved" && (
            <>
              <Check size={12} className="text-ok" /> Saved
            </>
          )}
          {saveState === "idle" && <>{page.updatedAt !== page.createdAt ? `Edited ${new Date(page.updatedAt).toLocaleString()}` : "New page"}</>}
        </span>
        <span className="flex items-center gap-1">
          <FileText size={12} /> {words} word{words === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
