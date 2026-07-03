import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  agentEvaluationApi,
  type AgentEvaluationBudget,
  type AgentEvaluationDataset,
  type AgentEvaluationDatasetSummary,
  type AgentEvaluationRun,
  type AgentEvaluationRunSummary,
  type AgentEvaluationSourcePolicy,
} from "@/api/evaluation";
import type { ModelOption } from "@/api/model";
import { modelApi } from "@/api/model";
import { AgentEvaluationConfigPanel } from "./components/AgentEvaluationConfigPanel";
import { AgentEvaluationResult } from "./components/AgentEvaluationResult";
import { AgentEvaluationRunHistory } from "./components/AgentEvaluationRunHistory";

const defaultBudget: AgentEvaluationBudget = {
  maxRounds: 4,
  maxEvidencePages: 48,
  maxRawSources: 12,
  tokenLimit: null,
};

export function LlmWikiAgentEvaluation() {
  const [datasets, setDatasets] = useState<AgentEvaluationDatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [dataset, setDataset] = useState<AgentEvaluationDataset | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [judgeModel, setJudgeModel] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [sourcePolicy, setSourcePolicy] = useState<AgentEvaluationSourcePolicy>("key-sources");
  const [budget, setBudget] = useState<AgentEvaluationBudget>(defaultBudget);
  const [runs, setRuns] = useState<AgentEvaluationRunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<AgentEvaluationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingDatasetId, setDeletingDatasetId] = useState("");
  const [deletingRunId, setDeletingRunId] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const refreshRuns = useCallback(async (silent = true) => {
    const response = await agentEvaluationApi
      .listRuns(50, silent)
      .catch(() => ({ items: [] }));
    setRuns(response.items || []);
  }, []);

  const refreshDatasets = useCallback(async (silent = true) => {
    const response = await agentEvaluationApi
      .listDatasets(silent)
      .catch(() => ({ items: [] }));
    const items = response.items || [];
    setDatasets(items);
    setDatasetId((current) =>
      items.some((item) => item.datasetId === current)
        ? current
        : items[0]?.datasetId || "",
    );
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const modelResponse = await modelApi.list(true);
        const nextModels = modelResponse.items || [];
        setModels(nextModels);
        setJudgeModel(nextModels[0]?.id || "");
        setAgentModel(nextModels[0]?.id || "");
        await Promise.all([refreshDatasets(true), refreshRuns(true)]);
      } finally {
        setLoading(false);
      }
    };
    void init();
    return () => stopPolling();
  }, [refreshDatasets, refreshRuns, stopPolling]);

  useEffect(() => {
    if (!datasetId) {
      setDataset(null);
      setSelectedCaseIds([]);
      return;
    }
    void agentEvaluationApi
      .getDataset(datasetId, true)
      .then((next) => {
        setDataset(next);
        setSelectedCaseIds(next.cases.map((item) => item.id));
      })
      .catch(() => {
        setDataset(null);
        setSelectedCaseIds([]);
      });
  }, [datasetId]);

  const startPolling = useCallback(
    (runId: string) => {
      stopPolling();
      const tick = async () => {
        const next = await agentEvaluationApi.getRun(runId, true).catch(() => null);
        if (!next) return;
        setActiveRun(next);
        if (next.status !== "running") {
          stopPolling();
          void refreshRuns(true);
        }
      };
      void tick();
      pollRef.current = window.setInterval(tick, 1500);
    },
    [refreshRuns, stopPolling],
  );

  const handleUpload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await agentEvaluationApi.uploadDataset(file);
      await refreshDatasets(true);
      setDataset(uploaded);
      setSelectedCaseIds(uploaded.cases.map((item) => item.id));
      setDatasetId(uploaded.datasetId);
      toast.success("Agent 评测数据集已上传");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDeleteDataset = async (targetDatasetId: string) => {
    const target = datasets.find((item) => item.datasetId === targetDatasetId);
    if (!target) return;
    if (!window.confirm(`删除 Agent 评测集「${target.name}」？历史评测结果不会被级联删除。`)) return;
    setDeletingDatasetId(targetDatasetId);
    try {
      await agentEvaluationApi.deleteDataset(targetDatasetId);
      await refreshDatasets(true);
      toast.success("Agent 评测数据集已删除");
    } finally {
      setDeletingDatasetId("");
    }
  };

  const handleStart = async () => {
    if (!dataset || !selectedCaseIds.length || !judgeModel || !agentModel) return;
    setSubmitting(true);
    try {
      const run = await agentEvaluationApi.createRun({
        datasetId: dataset.datasetId,
        caseIds: selectedCaseIds,
        judgeModel,
        agentModel,
        sourcePolicy,
        budget,
      });
      setActiveRun(run);
      startPolling(run.runId);
      void refreshRuns(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    const target = runs.find((item) => item.runId === runId);
    if (!target) return;
    if (target.status === "running") {
      toast.info("运行中的 Agent 评测不能删除");
      return;
    }
    if (!window.confirm(`删除「${target.datasetName}」的这条 Agent 评测结果？`)) return;
    setDeletingRunId(runId);
    try {
      await agentEvaluationApi.deleteRun(runId);
      if (activeRun?.runId === runId) {
        stopPolling();
        setActiveRun(null);
      }
      await refreshRuns(true);
      toast.success("Agent 历史评测已删除");
    } finally {
      setDeletingRunId("");
    }
  };

  const handleOpenRun = async (runId: string) => {
    stopPolling();
    const run = await agentEvaluationApi.getRun(runId).catch(() => null);
    if (!run) return;
    setActiveRun(run);
    if (run.status === "running") startPolling(run.runId);
  };

  const allSelected =
    Boolean(dataset?.cases.length) && selectedCaseIds.length === dataset?.cases.length;
  const toggleAll = () =>
    setSelectedCaseIds(
      allSelected ? [] : dataset?.cases.map((item) => item.id) || [],
    );
  const toggleCase = (caseId: string) => {
    setSelectedCaseIds((current) =>
      current.includes(caseId)
        ? current.filter((item) => item !== caseId)
        : [...current, caseId],
    );
  };

  const selectedCases = dataset?.cases.filter((item) => selectedCaseIds.includes(item.id)) || [];
  const selectedFactCount = selectedCases.reduce(
    (total, item) => total + item.expectedFacts.length,
    0,
  );
  const selectedSourceCount = new Set(
    selectedCases.flatMap((item) => item.relevantSourceIds),
  ).size;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100/80">
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(340px,0.46fr)_minmax(0,1fr)] gap-3 overflow-hidden p-3 xl:grid-cols-[400px_minmax(0,1fr)] xl:grid-rows-1">
        <AgentEvaluationConfigPanel
          datasets={datasets}
          datasetId={datasetId}
          dataset={dataset}
          selectedCaseIds={selectedCaseIds}
          models={models}
          agentModel={agentModel}
          judgeModel={judgeModel}
          sourcePolicy={sourcePolicy}
          budget={budget}
          loading={loading}
          uploading={uploading}
          submitting={submitting}
          deletingDatasetId={deletingDatasetId}
          allSelected={allSelected}
          selectedSourceCount={selectedSourceCount}
          selectedFactCount={selectedFactCount}
          fileRef={fileRef}
          onUpload={(file) => void handleUpload(file)}
          onDatasetChange={setDatasetId}
          onDeleteDataset={(id) => void handleDeleteDataset(id)}
          onAgentModelChange={setAgentModel}
          onJudgeModelChange={setJudgeModel}
          onSourcePolicyChange={setSourcePolicy}
          onBudgetChange={setBudget}
          onToggleAll={toggleAll}
          onToggleCase={toggleCase}
          onStart={handleStart}
        />

        <main className="grid min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-h-0 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
            <AgentEvaluationResult run={activeRun} />
          </section>
          <AgentEvaluationRunHistory
            runs={runs}
            activeRunId={activeRun?.runId || ""}
            deletingRunId={deletingRunId}
            onRefresh={() => refreshRuns(false)}
            onOpen={handleOpenRun}
            onDelete={(id) => void handleDeleteRun(id)}
          />
        </main>
      </div>
    </div>
  );
}
