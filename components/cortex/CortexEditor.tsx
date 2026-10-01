"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Code2,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Loader2,
  Sparkles,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { aiAssist } from "@/lib/aiAssist";
import { usePrompt } from "@/lib/dialogContext";

/**
 * The full editing surface behind Cortex — a proper rich-text editor (headings, lists, checklists,
 * quotes, code, links, undo/redo), not a plain textarea. `onChange` fires on every edit with HTML;
 * the caller is responsible for debouncing/saving it.
 */
export function CortexEditor({
  content,
  onChange,
  editable = true,
  placeholder = "Start writing…",
  pageTitle,
}: {
  content: string;
  onChange: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
  /** Passed to the AI assist calls for relevance; purely contextual, not rendered. */
  pageTitle?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "underline text-accent" } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content,
    editorProps: {
      attributes: { class: "cortex-prose min-h-[50vh] outline-none" },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Keep the editor's content in sync when switching pages (a new `content` prop for the same instance).
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== content) editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, content]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return null;

  return (
    <div className="grid gap-3">
      <Toolbar editor={editor} pageTitle={pageTitle} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, pageTitle }: { editor: Editor; pageTitle?: string }) {
  const prompt = usePrompt();
  const [aiBusy, setAiBusy] = useState<"improve" | "generate" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const improveWithAi = async () => {
    if (aiBusy) return;
    const current = editor.getText().trim();
    if (!current) {
      setAiError("Write something first, then improve it.");
      return;
    }
    setAiBusy("improve");
    setAiError(null);
    try {
      const html = await aiAssist({ mode: "improve", text: editor.getHTML(), contextTitle: pageTitle });
      editor.commands.setContent(html, { emitUpdate: true });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Couldn't improve this page.");
    } finally {
      setAiBusy(null);
    }
  };

  const writeForMe = async () => {
    if (aiBusy) return;
    const instruction = await prompt({ title: "Write for me", message: "What should this cover?", placeholder: "e.g. A checklist for system design interviews", defaultValue: pageTitle ?? "" });
    if (!instruction) return;
    setAiBusy("generate");
    setAiError(null);
    try {
      const html = await aiAssist({ mode: "generate", instruction, contextTitle: pageTitle });
      const empty = !editor.getText().trim();
      if (empty) editor.commands.setContent(html, { emitUpdate: true });
      else editor.chain().focus("end").insertContent(html).run();
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Couldn't write that.");
    } finally {
      setAiBusy(null);
    }
  };

  const setLink = async () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = await prompt({ title: "Link", placeholder: "https://", defaultValue: prev ?? "" });
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const items: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean }[] = [
    { icon: <Bold size={15} />, label: "Bold", active: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
    { icon: <Italic size={15} />, label: "Italic", active: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run() },
    { icon: <UnderlineIcon size={15} />, label: "Underline", active: editor.isActive("underline"), onClick: () => editor.chain().focus().toggleUnderline().run() },
    { icon: <Strikethrough size={15} />, label: "Strikethrough", active: editor.isActive("strike"), onClick: () => editor.chain().focus().toggleStrike().run() },
    { icon: <Heading1 size={15} />, label: "Heading 1", active: editor.isActive("heading", { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: <Heading2 size={15} />, label: "Heading 2", active: editor.isActive("heading", { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: <Heading3 size={15} />, label: "Heading 3", active: editor.isActive("heading", { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { icon: <List size={15} />, label: "Bullet list", active: editor.isActive("bulletList"), onClick: () => editor.chain().focus().toggleBulletList().run() },
    { icon: <ListOrdered size={15} />, label: "Numbered list", active: editor.isActive("orderedList"), onClick: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: <ListChecks size={15} />, label: "Checklist", active: editor.isActive("taskList"), onClick: () => editor.chain().focus().toggleTaskList().run() },
    { icon: <Quote size={15} />, label: "Quote", active: editor.isActive("blockquote"), onClick: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: <Code2 size={15} />, label: "Code block", active: editor.isActive("codeBlock"), onClick: () => editor.chain().focus().toggleCodeBlock().run() },
    { icon: <Link2 size={15} />, label: "Link", active: editor.isActive("link"), onClick: setLink },
    { icon: <Minus size={15} />, label: "Divider", onClick: () => editor.chain().focus().setHorizontalRule().run() },
    { icon: <Eraser size={15} />, label: "Clear formatting", onClick: () => editor.chain().focus().clearNodes().unsetAllMarks().run() },
    { icon: <Undo2 size={15} />, label: "Undo", onClick: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    { icon: <Redo2 size={15} />, label: "Redo", onClick: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },
  ];

  return (
    <div className="sticky top-0 z-10 grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-card p-1.5 shadow-sm">
        {items.map((it, i) => (
          <button
            key={i}
            type="button"
            title={it.label}
            aria-label={it.label}
            aria-pressed={it.active}
            disabled={it.disabled}
            onClick={it.onClick}
            className={`grid h-8 w-8 place-items-center rounded-lg transition disabled:opacity-30 ${it.active ? "bg-accent text-accent-ink" : "text-muted hover:bg-soft"}`}
          >
            {it.icon}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" onClick={writeForMe} disabled={!!aiBusy} className="flex items-center gap-1.5 rounded-full bg-hl px-3 py-1.5 text-xs font-medium disabled:opacity-50">
          {aiBusy === "generate" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Write for me
        </button>
        <button type="button" onClick={improveWithAi} disabled={!!aiBusy} className="flex items-center gap-1.5 rounded-full bg-hl px-3 py-1.5 text-xs font-medium disabled:opacity-50">
          {aiBusy === "improve" ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />} Improve with AI
        </button>
      </div>
      {aiError && <p className="px-1 text-xs text-danger">{aiError}</p>}
    </div>
  );
}
