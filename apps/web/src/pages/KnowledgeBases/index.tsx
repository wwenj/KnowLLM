import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { llmWikiNextApi, type KnowledgeBase } from "@/api/llmWikiNext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function KnowledgeBases() {
  const navigate = useNavigate();
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null);
  const [target, setTarget] = useState<KnowledgeBase | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await llmWikiNextApi.listKnowledgeBases();
      setItems(result.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = (mode: "create" | "rename" | "delete", item: KnowledgeBase | null = null) => {
    setTarget(item);
    setName(mode === "rename" ? item?.name || "" : "");
    setDialog(mode);
  };

  const submit = async () => {
    if (dialog === "delete" && target) {
      setSubmitting(true);
      try {
        await llmWikiNextApi.deleteKnowledgeBase(target.id);
        toast.success("知识库已删除，已清空其 Wiki 编译内容");
        setDialog(null);
        await refresh();
      } finally { setSubmitting(false); }
      return;
    }
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const item = dialog === "create"
        ? await llmWikiNextApi.createKnowledgeBase(name)
        : await llmWikiNextApi.renameKnowledgeBase(target!.id, name);
      setDialog(null);
      await refresh();
      if (dialog === "create") navigate(`/llm-wiki-next/${item.id}`);
      else toast.success("知识库名称已更新");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-6 py-7">
      <header className="flex items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium tracking-wide text-slate-500">KNOWLEDGE WORKSPACE</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">知识库</h1>
          <p className="mt-1 text-sm text-slate-500">选择一个知识库，管理文档编译、发布和检索。</p>
        </div>
        <Button onClick={() => open("create")}><Plus />新建知识库</Button>
      </header>

      <main className="py-6">
        {loading ? <div className="text-sm text-slate-500">正在加载知识库…</div> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="group relative min-h-36 border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400">
                <button type="button" onClick={() => navigate(`/llm-wiki-next/${item.id}`)} className="block w-full pr-8 text-left">
                  <BookOpen className="size-4 text-slate-500" />
                  <h2 className="mt-5 truncate text-base font-semibold text-slate-900">{item.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">进入 LLM Wiki 工作台</p>
                </button>
                <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" aria-label="重命名" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => open("rename", item)}><Pencil className="size-3.5" /></button>
                  <button type="button" aria-label="删除" className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => open("delete", item)}><Trash2 className="size-3.5" /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <Dialog open={Boolean(dialog)} onOpenChange={(value) => !value && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === "create" ? "新建知识库" : dialog === "rename" ? "重命名知识库" : "删除知识库"}</DialogTitle>
            <DialogDescription>{dialog === "delete" ? `将永久清空“${target?.name}”的所有 Wiki 编译内容。关联 Agent 和评测历史会保留。` : "输入一个清晰的知识库名称。"}</DialogDescription>
          </DialogHeader>
          {dialog !== "delete" && <Input autoFocus value={name} maxLength={80} placeholder="例如：产品帮助中心" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void submit()} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={submitting}>取消</Button>
            <Button variant={dialog === "delete" ? "destructive" : "default"} disabled={submitting || (dialog !== "delete" && !name.trim())} onClick={() => void submit()}>{dialog === "delete" ? "确认删除" : dialog === "create" ? "创建并进入" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
