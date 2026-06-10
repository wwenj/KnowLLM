import { Brain, Loader2, Play } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentProfile } from "@/api/agent";
import type { ModelOption } from "@/api/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AgentType, LlmWikiConfig } from "./types";
import { clamp } from "./utils";

interface AgentConfigPanelProps {
  profiles: AgentProfile[];
  activeAgent: AgentType;
  wikiConfig: LlmWikiConfig;
  modelOptions: ModelOption[];
  loading: boolean;
  submitting: boolean;
  submitDisabled: boolean;
  onAgentChange: (value: AgentType) => void;
  onWikiChange: (value: LlmWikiConfig) => void;
  onSubmit: () => void;
}

export function AgentConfigPanel({
  profiles,
  activeAgent,
  wikiConfig,
  modelOptions,
  loading,
  submitting,
  submitDisabled,
  onAgentChange,
  onWikiChange,
  onSubmit,
}: AgentConfigPanelProps) {
  const supported = activeAgent === "llmWiki";
  return (
    <div className="shrink-0 bg-slate-50">
      <div className="bg-slate-50/95 p-2">
        <AgentSwitch profiles={profiles} value={activeAgent} onChange={onAgentChange} />
      </div>
      <div className="px-3 py-3">
        {supported ? (
          <LlmWikiAgentConfigPanel
            value={wikiConfig}
            modelOptions={modelOptions}
            loading={loading}
            onChange={onWikiChange}
          />
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-800">
            当前前端未实现该 Agent 的配置面板。
          </div>
        )}
        <div className="flex justify-end pt-3">
          <Button
            size="sm"
            disabled={submitting || loading || submitDisabled || !supported}
            onClick={onSubmit}
            className="bg-slate-900 text-white hover:bg-slate-800"
          >
            {submitting ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Play className="mr-1 size-4" />
            )}
            开始执行
          </Button>
        </div>
      </div>
    </div>
  );
}

function AgentSwitch({
  profiles,
  value,
  onChange,
}: {
  profiles: AgentProfile[];
  value: AgentType;
  onChange: (value: AgentType) => void;
}) {
  return (
    <div
      className="grid w-full min-w-0 items-center rounded-lg border border-slate-200/70 bg-white/90 p-1 shadow-sm"
      style={{
        gridTemplateColumns: `repeat(${Math.max(profiles.length, 1)}, minmax(0, 1fr))`,
      }}
    >
      {profiles.map((profile) => {
        const active = value === profile.agentType;
        return (
          <button
            key={profile.agentType}
            type="button"
            onClick={() => onChange(profile.agentType)}
            className={[
              "flex h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-center text-sm font-medium transition-colors",
              active
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-700 hover:bg-slate-50 hover:text-slate-900",
            ].join(" ")}
          >
            <Brain className="size-3.5 shrink-0" />
            <span className="truncate text-center">{profile.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function LlmWikiAgentConfigPanel({
  value,
  modelOptions,
  loading,
  onChange,
}: {
  value: LlmWikiConfig;
  modelOptions: ModelOption[];
  loading: boolean;
  onChange: (value: LlmWikiConfig) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2.5">
        <Field label="模型">
          <Select
            value={value.model}
            onValueChange={(model) => onChange({ ...value, model })}
            disabled={loading || !modelOptions.length}
          >
            <SelectTrigger className="w-full border-stone-300 bg-white">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((option) => (
                <SelectItem key={option.model} value={option.model}>
                  {option.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="结果数">
          <Input
            type="number"
            min={1}
            max={20}
            value={value.limit}
            onChange={(event) =>
              onChange({ ...value, limit: clamp(Number(event.target.value), 1, 20) })
            }
            className="border-stone-300 bg-white"
          />
        </Field>
      </div>
      <Field label="检索问题">
        <Textarea
          rows={7}
          value={value.query}
          onChange={(event) => onChange({ ...value, query: event.target.value })}
          placeholder="输入要让 LLM Wiki Agent 检索和回答的问题"
          className="h-40 min-h-40 max-h-40 resize-none overflow-y-auto"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
