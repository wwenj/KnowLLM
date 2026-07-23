import { useState, type FormEvent } from "react";
import {
  BookOpen,
  Braces,
  FileSearch,
  FileText,
  Loader2,
  Play,
  Search,
} from "lucide-react";
import { llmWikiNextApi } from "@/api/llmWikiNext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ToolName = "getCatalog" | "readPage" | "readSource" | "searchWiki";

interface ToolResult {
  tool: ToolName;
  params: Record<string, string | number>;
  data?: unknown;
  error?: string;
}

const TOOL_LABELS: Record<ToolName, string> = {
  getCatalog: "getCatalog",
  readPage: "readPage",
  readSource: "readSource",
  searchWiki: "searchWiki",
};

export function ToolsWorkspace() {
  const [pageKey, setPageKey] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [startLine, setStartLine] = useState("");
  const [endLine, setEndLine] = useState("");
  const [query, setQuery] = useState("");
  const [activeTool, setActiveTool] = useState<ToolName>("getCatalog");
  const [runningTool, setRunningTool] = useState<ToolName | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);

  const execute = async (
    tool: ToolName,
    params: Record<string, string | number>,
    request: () => Promise<unknown>,
  ) => {
    if (runningTool) return;
    setRunningTool(tool);
    setResult({ tool, params });
    try {
      const data = await request();
      setResult({ tool, params, data });
    } catch (error) {
      setResult({
        tool,
        params,
        error: error instanceof Error ? error.message : "查询失败",
      });
    } finally {
      setRunningTool(null);
    }
  };

  const runCatalog = () =>
    void execute("getCatalog", {}, llmWikiNextApi.getToolsCatalog);

  const runPage = (event: FormEvent) => {
    event.preventDefault();
    const normalized = pageKey.trim();
    if (!normalized) {
      setResult({ tool: "readPage", params: {}, error: "请输入 pageKey" });
      return;
    }
    void execute("readPage", { pageKey: normalized }, () =>
      llmWikiNextApi.readToolsPage(normalized),
    );
  };

  const runSource = (event: FormEvent) => {
    event.preventDefault();
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) {
      setResult({ tool: "readSource", params: {}, error: "请输入 sourceId" });
      return;
    }
    const normalizedStartLine = startLine.trim();
    const parsedStartLine = normalizedStartLine
      ? Number(normalizedStartLine)
      : undefined;
    const normalizedEndLine = endLine.trim();
    const parsedEndLine = normalizedEndLine
      ? Number(normalizedEndLine)
      : undefined;
    if (
      parsedStartLine !== undefined &&
      (!Number.isInteger(parsedStartLine) || parsedStartLine < 1)
    ) {
      setResult({
        tool: "readSource",
        params: {
          sourceId: normalizedSourceId,
          startLine: normalizedStartLine,
        },
        error: "startLine 必须是正整数",
      });
      return;
    }
    if (
      parsedEndLine !== undefined &&
      (!Number.isInteger(parsedEndLine) || parsedEndLine < 1)
    ) {
      setResult({
        tool: "readSource",
        params: { sourceId: normalizedSourceId, endLine: normalizedEndLine },
        error: "endLine 必须是正整数",
      });
      return;
    }
    if (
      parsedStartLine !== undefined &&
      parsedEndLine !== undefined &&
      parsedStartLine > parsedEndLine
    ) {
      setResult({
        tool: "readSource",
        params: {
          sourceId: normalizedSourceId,
          startLine: parsedStartLine,
          endLine: parsedEndLine,
        },
        error: "startLine 不能大于 endLine",
      });
      return;
    }
    const params = {
      sourceId: normalizedSourceId,
      ...(parsedStartLine === undefined ? {} : { startLine: parsedStartLine }),
      ...(parsedEndLine === undefined ? {} : { endLine: parsedEndLine }),
    };
    void execute("readSource", params, () =>
      llmWikiNextApi.readToolsSource(
        normalizedSourceId,
        parsedStartLine,
        parsedEndLine,
      ),
    );
  };

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) {
      setResult({ tool: "searchWiki", params: {}, error: "请输入查询关键词" });
      return;
    }
    void execute("searchWiki", { query: normalized }, () =>
      llmWikiNextApi.searchToolsWiki(normalized),
    );
  };

  const busy = runningTool !== null;

  return (
    <div className="grid min-h-0 flex-1 overflow-hidden bg-slate-50/40 lg:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-b border-slate-200 p-3 lg:border-r lg:border-b-0">
        <div className="mb-3 px-1">
          <h2 className="text-sm font-semibold text-slate-900">
            Wiki 查询 Tools
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            手动调用最新正式 Wiki 的只读查询能力，不会读取待发布数据。
          </p>
        </div>

        <Tabs
          value={activeTool}
          onValueChange={(value) => setActiveTool(value as ToolName)}
          className="gap-3"
        >
          <TabsList className="grid h-auto w-full grid-cols-4 p-1">
            {(Object.keys(TOOL_LABELS) as ToolName[]).map((tool) => (
              <TabsTrigger
                key={tool}
                value={tool}
                className="h-8 min-w-0 px-1 font-mono text-[11px]"
              >
                <span className="truncate">{TOOL_LABELS[tool]}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {activeTool === "getCatalog" && (
            <ToolCard
              icon={<BookOpen />}
              name="getCatalog"
              description="获取完整 Wiki 页面目录和正式原文映射。"
            >
              <ToolButton
                tool="getCatalog"
                runningTool={runningTool}
                disabled={busy}
                onClick={runCatalog}
              />
            </ToolCard>
          )}

          {activeTool === "readPage" && (
            <ToolCard
              icon={<FileText />}
              name="readPage"
              description="按 pageKey 读取正文、Facts 和关联页面。"
            >
              <form className="space-y-2" onSubmit={runPage}>
                <Field label="pageKey">
                  <Input
                    value={pageKey}
                    onChange={(event) => setPageKey(event.target.value)}
                    placeholder="8 位 pageKey"
                    className="h-8 bg-white font-mono text-xs"
                    disabled={busy}
                  />
                </Field>
                <ToolButton
                  tool="readPage"
                  runningTool={runningTool}
                  disabled={busy || !pageKey.trim()}
                />
              </form>
            </ToolCard>
          )}

          {activeTool === "readSource" && (
            <ToolCard
              icon={<FileSearch />}
              name="readSource"
              description="读取正式 Wiki 引用的原文和对应页面。"
            >
              <form className="space-y-2" onSubmit={runSource}>
                <Field label="sourceId">
                  <Input
                    value={sourceId}
                    onChange={(event) => setSourceId(event.target.value)}
                    placeholder="16 位 sourceId"
                    className="h-8 bg-white font-mono text-xs"
                    disabled={busy}
                  />
                </Field>
                <Field label="startLine（可选）">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={startLine}
                    onChange={(event) => setStartLine(event.target.value)}
                    placeholder="默认 1"
                    className="h-8 bg-white text-xs"
                    disabled={busy}
                  />
                </Field>
                <Field label="endLine（可选）">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={endLine}
                    onChange={(event) => setEndLine(event.target.value)}
                    placeholder="默认原文末行"
                    className="h-8 bg-white text-xs"
                    disabled={busy}
                  />
                </Field>
                <ToolButton
                  tool="readSource"
                  runningTool={runningTool}
                  disabled={busy || !sourceId.trim()}
                />
              </form>
            </ToolCard>
          )}

          {activeTool === "searchWiki" && (
            <ToolCard
              icon={<Search />}
              name="searchWiki"
              description="匹配标题、目标、Facts 和 Wiki 正文。"
            >
              <form className="space-y-2" onSubmit={runSearch}>
                <Field label="query">
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="输入查询关键词"
                    className="h-8 bg-white text-xs"
                    disabled={busy}
                  />
                </Field>
                <ToolButton
                  tool="searchWiki"
                  runningTool={runningTool}
                  disabled={busy || !query.trim()}
                />
              </form>
            </ToolCard>
          )}
        </Tabs>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col bg-white">
        <div className="flex h-11 flex-none items-center gap-2 border-b border-slate-200 px-4">
          <Braces className="size-4 text-slate-400" />
          <h2 className="text-sm font-medium text-slate-800">调用结果</h2>
          {result && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
              {TOOL_LABELS[result.tool]}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!result ? (
            <div className="flex h-full min-h-48 items-center justify-center text-center text-sm text-slate-400">
              选择左侧 Tool 并手动执行，结果将在这里显示。
            </div>
          ) : runningTool === result.tool && result.data === undefined ? (
            <div className="flex h-full min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              正在执行 {TOOL_LABELS[result.tool]}
            </div>
          ) : (
            <div className="space-y-3">
              <ResultBlock title="请求参数" value={result.params} />
              {result.error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  {result.error}
                </div>
              ) : (
                <ResultBlock title="响应数据" value={result.data} />
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ToolCard({
  icon,
  name,
  description,
  children,
}: {
  icon: React.ReactNode;
  name: ToolName;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-slate-400 [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-mono text-xs font-semibold text-slate-800">
            {name}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function ToolButton({
  tool,
  runningTool,
  disabled,
  onClick,
}: {
  tool: ToolName;
  runningTool: ToolName | null;
  disabled: boolean;
  onClick?: () => void;
}) {
  const running = runningTool === tool;
  return (
    <Button
      type={onClick ? "button" : "submit"}
      size="sm"
      className="h-8 w-full text-xs"
      disabled={disabled}
      onClick={onClick}
    >
      {running ? <Loader2 className="animate-spin" /> : <Play />}
      {running ? "执行中" : "执行"}
    </Button>
  );
}

function ResultBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium text-slate-500">{title}</h3>
      <pre className="overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-slate-100">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </section>
  );
}
