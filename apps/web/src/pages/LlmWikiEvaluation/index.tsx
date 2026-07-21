import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BUILTIN_COMPILE_EVALUATION_DATASET_ID,
  COMPILE_EVALUATION_SMOKE_CASE_IDS,
  compileEvaluationApi,
  type CompileEvaluationDataset,
  type CompileEvaluationDatasetSummary,
  type CompileEvaluationRun,
  type CompileEvaluationRunSummary,
} from "@/api/evaluation";
import type { ModelOption } from "@/api/model";
import { modelApi } from "@/api/model";
import { EvaluationConfigPanel } from "./components/EvaluationConfigPanel";
import { EvaluationResult } from "./components/EvaluationResult";
import { EvaluationRunHistory } from "./components/EvaluationRunHistory";

export function LlmWikiEvaluation() {
  const [datasets, setDatasets] = useState<CompileEvaluationDatasetSummary[]>(
    [],
  );
  const [datasetId, setDatasetId] = useState("");
  const [dataset, setDataset] = useState<CompileEvaluationDataset | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [judgeModel, setJudgeModel] = useState("");
  const [concurrency, setConcurrency] = useState(20);
  const [runs, setRuns] = useState<CompileEvaluationRunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<CompileEvaluationRun | null>(null);
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
    const response = await compileEvaluationApi
      .listRuns(50, silent)
      .catch(() => ({ items: [] }));
    setRuns(response.items || []);
  }, []);

  const refreshDatasets = useCallback(async (silent = true) => {
    const response = await compileEvaluationApi
      .listDatasets(silent)
      .catch(() => ({ items: [] }));
    const items = response.items || [];
    setDatasets(items);
    setDatasetId((current) =>
      items.some((item) => item.datasetId === current)
        ? current
        : items.find((item) => item.datasetId === BUILTIN_COMPILE_EVALUATION_DATASET_ID)?.datasetId ||
          items[0]?.datasetId ||
          "",
    );
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const modelResponse = await modelApi.list(true);
        const nextModels = modelResponse.items || [];
        setModels(nextModels);
        setJudgeModel(nextModels[0]?.id || "");
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
    void compileEvaluationApi
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
        const next = await compileEvaluationApi
          .getRun(runId, true)
          .catch(() => null);
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
      const uploaded = await compileEvaluationApi.uploadDataset(file);
      await refreshDatasets(true);
      setDataset(uploaded);
      setSelectedCaseIds(uploaded.cases.map((item) => item.id));
      setDatasetId(uploaded.datasetId);
      toast.success("评测数据集已上传");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDeleteDataset = async (targetDatasetId: string) => {
    const target = datasets.find((item) => item.datasetId === targetDatasetId);
    if (!target) return;
    if (!window.confirm(`删除评测集「${target.name}」？历史评测结果不会被级联删除。`)) return;
    setDeletingDatasetId(targetDatasetId);
    try {
      await compileEvaluationApi.deleteDataset(targetDatasetId);
      await refreshDatasets(true);
      toast.success("评测数据集已删除");
    } finally {
      setDeletingDatasetId("");
    }
  };

  const handleStart = async () => {
    if (!dataset || !selectedCaseIds.length || !judgeModel) return;
    setSubmitting(true);
    try {
      const run = await compileEvaluationApi.createRun({
        datasetId: dataset.datasetId,
        caseIds: selectedCaseIds,
        judgeModel,
        concurrency,
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
      toast.info("运行中的评测不能删除");
      return;
    }
    if (!window.confirm(`删除「${target.datasetName}」的这条历史评测结果？`)) return;
    setDeletingRunId(runId);
    try {
      await compileEvaluationApi.deleteRun(runId);
      if (activeRun?.runId === runId) {
        stopPolling();
        setActiveRun(null);
      }
      await refreshRuns(true);
      toast.success("历史评测已删除");
    } finally {
      setDeletingRunId("");
    }
  };

  const handleRetryFailed = async () => {
    if (!activeRun || activeRun.status === "running") return;
    setSubmitting(true);
    try {
      const run = await compileEvaluationApi.retryFailed(activeRun.runId, { judgeModel });
      setActiveRun(run);
      startPolling(run.runId);
      void refreshRuns(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRun = async (runId: string) => {
    stopPolling();
    const run = await compileEvaluationApi.getRun(runId).catch(() => null);
    if (!run) return;
    setActiveRun(run);
    if (run.status === "running") startPolling(run.runId);
  };

  const allSelected =
    Boolean(dataset?.cases.length) &&
    selectedCaseIds.length === dataset?.cases.length;
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
  const selectedFactCount = selectedCases.reduce((total, item) => total + item.expectedFacts.length, 0);
  const selectedSourceCount = new Set(
    selectedCases.flatMap((item) => item.sourceIds),
  ).size;

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100/80">
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(300px,0.42fr)_minmax(0,1fr)] gap-3 overflow-hidden p-3 xl:grid-cols-[360px_minmax(0,1fr)] xl:grid-rows-1">
        <EvaluationConfigPanel
          datasets={datasets}
          datasetId={datasetId}
          dataset={dataset}
          selectedCaseIds={selectedCaseIds}
          models={models}
          judgeModel={judgeModel}
          concurrency={concurrency}
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
          onJudgeModelChange={setJudgeModel}
          onConcurrencyChange={setConcurrency}
          onToggleAll={toggleAll}
          onSelectSmokeCases={() => setSelectedCaseIds(
            dataset?.cases
              .map((item) => item.id)
              .filter((caseId) => COMPILE_EVALUATION_SMOKE_CASE_IDS.includes(
                caseId as (typeof COMPILE_EVALUATION_SMOKE_CASE_IDS)[number],
              )) || [],
          )}
          onToggleCase={toggleCase}
          onStart={handleStart}
        />

        <main className="grid min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-h-0 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
            <EvaluationResult
              run={activeRun}
              retrying={submitting}
              onRetryFailed={() => void handleRetryFailed()}
            />
          </section>
          <EvaluationRunHistory
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
