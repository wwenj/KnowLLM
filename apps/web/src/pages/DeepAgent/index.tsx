import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type {
  AgentProfile,
  AgentRunDetail,
  AgentRunEvent,
  AgentRunSummary,
} from "@/api/agent";
import { agentApi } from "@/api/agent";
import type { ModelOption } from "@/api/model";
import { modelApi } from "@/api/model";
import { AgentConfigPanel } from "./components/AgentConfigPanel";
import { HistoryCard } from "./components/HistoryCard";
import { RunOutputPanel } from "./components/RunOutputPanel";
import {
  FALLBACK_PROFILES,
  TERMINAL,
  type AgentType,
  type LlmWikiConfig,
  type StatusKey,
} from "./types";
import {
  RUN_CONFIG_STORAGE_KEY,
  buildLogPayload,
  buildRunBody,
  clamp,
  numberValue,
  pickModel,
  readStoredConfig,
  stringValue,
} from "./utils";

export function DeepAgent() {
  const [searchParams] = useSearchParams();
  const [profiles, setProfiles] = useState<AgentProfile[]>(FALLBACK_PROFILES);
  const [activeAgent, setActiveAgent] = useState<AgentType>("llmWiki");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [wikiConfig, setWikiConfig] = useState<LlmWikiConfig>(readStoredConfig);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [selectedRunAgent, setSelectedRunAgent] = useState<AgentType | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusKey>("idle");
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [history, setHistory] = useState<AgentRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"process" | "result">("process");
  const pollRef = useRef<number | null>(null);
  const loadedQueryRunRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshHistory = useCallback(async (silent = true) => {
    if (!silent) setHistoryLoading(true);
    try {
      const res = await agentApi.listAllRuns(50, true);
      setHistory(res.items || []);
    } catch {
      setHistory([]);
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const [profileRes, modelRes, defaults] = await Promise.all([
          agentApi.listAgents(true).catch(() => ({ items: FALLBACK_PROFILES })),
          modelApi.list(true),
          agentApi.getDefaults<Record<string, unknown>>("llmWiki", true).catch(() => ({})),
        ]);
        const nextProfiles = profileRes.items?.length ? profileRes.items : FALLBACK_PROFILES;
        const nextModels = modelRes.items || [];
        const defaultValues = defaults as Record<string, unknown>;
        setProfiles(nextProfiles);
        setActiveAgent(nextProfiles[0]?.agentType || "llmWiki");
        setModelOptions(nextModels);
        setWikiConfig((current) => ({
          ...current,
          limit: clamp(numberValue(defaultValues.limit, current.limit), 1, 20),
          fastModel: pickModel(current.fastModel || stringValue(defaultValues.fastModel), nextModels),
          qualityModel: pickModel(current.qualityModel || stringValue(defaultValues.qualityModel), nextModels),
        }));
        void refreshHistory(true);
      } catch {
        toast.error("Agent 配置加载失败");
      } finally {
        setLoadingConfig(false);
      }
    };
    void init();
    return () => stopPolling();
  }, [refreshHistory, stopPolling]);

  useEffect(() => {
    if (loadingConfig) return;
    try {
      window.localStorage.setItem(RUN_CONFIG_STORAGE_KEY, JSON.stringify(wikiConfig));
    } catch {
      // ignore storage failures
    }
  }, [loadingConfig, wikiConfig]);

  const startPolling = useCallback(
    (agentType: AgentType, id: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const next = await agentApi.getRun(agentType, id, true);
          setDetail(next);
          setEvents(next.events || []);
          setStatus(next.status);
          if (TERMINAL.includes(next.status)) {
            stopPolling();
            void refreshHistory(true);
          }
        } catch {
          // keep polling while the run is starting
        }
      };
      void tick();
      pollRef.current = window.setInterval(tick, 1500);
    },
    [refreshHistory, stopPolling],
  );

  useEffect(() => {
    if (loadingConfig) return;
    const agentType = searchParams.get("agentType");
    const queryRunId = searchParams.get("runId") || "";
    if (agentType !== "llmWiki" || !/^[a-f0-9]{32}$/.test(queryRunId)) return;
    const key = `${agentType}:${queryRunId}`;
    if (loadedQueryRunRef.current === key) return;
    loadedQueryRunRef.current = key;
    setActiveAgent(agentType);
    setSelectedRunAgent(agentType);
    setRunId(queryRunId);
    setStatus("running");
    setEvents([]);
    setDetail(null);
    void agentApi.getRun(agentType, queryRunId, true).then((next) => {
      setDetail(next);
      setEvents(next.events || []);
      setStatus(next.status);
      if (next.status === "running") startPolling(agentType, queryRunId);
      else setActiveTab("result");
    }).catch(() => {
      setStatus("idle");
      toast.error("Agent Run 加载失败");
    });
  }, [loadingConfig, searchParams, startPolling]);

  const handleSubmit = async () => {
    if (activeAgent !== "llmWiki" || !wikiConfig.query.trim()) return;
    setSubmitting(true);
    setEvents([{ type: "client", msg: "请求已提交，等待 Agent 启动…" }]);
    setDetail(null);
    setActiveTab("process");
    try {
      const res = await agentApi.createRun("llmWiki", buildRunBody(wikiConfig));
      setSelectedRunAgent("llmWiki");
      setRunId(res.runId);
      setStatus("running");
      startPolling("llmWiki", res.runId);
      void refreshHistory(true);
    } catch {
      setStatus("idle");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedRunAgent || !runId || status !== "running") return;
    await agentApi.cancelRun(selectedRunAgent, runId).catch(() => undefined);
  };

  const handleSelectHistory = async (item: AgentRunSummary) => {
    stopPolling();
    setSelectedRunAgent(item.agentType);
    setRunId(item.runId);
    setStatus(item.status);
    setEvents([]);
    setDetail(null);
    try {
      const next = await agentApi.getRun(item.agentType, item.runId);
      setDetail(next);
      setEvents(next.events || []);
      setStatus(next.status);
      if (next.status === "running") startPolling(item.agentType, item.runId);
      else setActiveTab("result");
    } catch {
      // toast already shown
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildLogPayload(detail, events), null, 2));
      toast.success("日志已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(buildLogPayload(detail, events), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-${selectedRunAgent || "llmWiki"}-${runId || "log"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100/80 p-3">
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,44%)_minmax(0,1fr)] gap-3 overflow-hidden xl:grid-cols-[380px_minmax(0,1fr)] xl:grid-rows-1">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <AgentConfigPanel
            profiles={profiles}
            activeAgent={activeAgent}
            wikiConfig={wikiConfig}
            modelOptions={modelOptions}
            loading={loadingConfig}
            submitting={submitting}
            submitDisabled={
              activeAgent !== "llmWiki" ||
              !wikiConfig.query.trim() ||
              !wikiConfig.fastModel ||
              !wikiConfig.qualityModel
            }
            onAgentChange={setActiveAgent}
            onWikiChange={setWikiConfig}
            onSubmit={handleSubmit}
          />
          <HistoryCard
            history={history}
            activeRunKey={selectedRunAgent && runId ? `${selectedRunAgent}:${runId}` : null}
            loading={historyLoading}
            onRefresh={() => refreshHistory(false)}
            onSelect={handleSelectHistory}
          />
        </aside>
        <RunOutputPanel
          events={events}
          detail={detail}
          status={status}
          agentType={selectedRunAgent}
          runId={runId}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onCancel={handleCancel}
          onCopy={handleCopy}
          onDownload={handleDownload}
        />
      </div>
    </div>
  );
}
