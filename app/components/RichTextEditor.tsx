"use client";

import { useEffect, type ReactNode } from "react";
import { Extension, InputRule } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListTodo,
  Minus,
  Strikethrough,
} from "lucide-react";

type RichTextEditorProps = {
  content: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  className?: string;
};

/**
 * Markdown-style shortcuts for task checklists:
 * - `[] ` or `[ ] ` → unchecked task item
 * - `[x] ` / `[X] ` → checked task item
 */
const TaskListMarkdownShortcuts = Extension.create({
  name: "taskListMarkdownShortcuts",
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[\s?\]\s$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).toggleTaskList().run();
        },
      }),
      new InputRule({
        find: /^\s*\[[xX]\]\s$/,
        handler: ({ chain, range }) => {
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              const { $from } = tr.selection;
              for (let d = $from.depth; d > 0; d -= 1) {
                const node = $from.node(d);
                if (node.type.name === "taskItem") {
                  tr.setNodeMarkup($from.before(d), undefined, {
                    ...node.attrs,
                    checked: true,
                  });
                  break;
                }
              }
              return true;
            })
            .run();
        },
      }),
    ];
  },
});

function ToolbarButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-zinc-200 transition disabled:opacity-40 ${
        active
          ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
          : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({
  content,
  onChange,
  editable = true,
  className = "",
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        // Dedicated HorizontalRule extension provides the `---` markdown shortcut.
        horizontalRule: false,
        heading: { levels: [1, 2, 3] },
      }),
      HorizontalRule,
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskListMarkdownShortcuts,
    ],
    content: content || "<p></p>",
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none min-h-[320px] px-4 py-3 focus:outline-none text-zinc-100 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_li[data-type=taskItem]]:flex [&_li[data-type=taskItem]]:gap-2 [&_li[data-type=taskItem]>label]:mt-1 [&_hr]:my-6 [&_hr]:border-zinc-700",
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange?.(current.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = content || "<p></p>";
    if (current !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) {
    return (
      <div className={`rounded-xl border border-zinc-800 bg-zinc-950/60 ${className}`}>
        <div className="px-4 py-8 text-sm text-zinc-500">Loading editor…</div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-950/60 ${className}`}
    >
      {editable ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
          <ToolbarButton
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Strikethrough"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-zinc-700" aria-hidden />
          <ToolbarButton
            label="Heading 1"
            active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 2"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 3"
            active={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-zinc-700" aria-hidden />
          <ToolbarButton
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Checklist"
            active={editor.isActive("taskList")}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListTodo className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Horizontal rule"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
      <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
        Shortcuts: <code className="text-zinc-400">*</code> list ·{" "}
        <code className="text-zinc-400">[]</code> checklist ·{" "}
        <code className="text-zinc-400">---</code> separator
      </p>
    </div>
  );
}
