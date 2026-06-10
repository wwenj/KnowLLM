import { BookOpen, SendHorizontal, Square, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import styles from "./styles.module.less";
import type {
  ConnectionStatus,
  ModelOption,
  SendPayload,
  SessionToolItem,
} from "./types";

interface ChatComposerProps {
  draft: string;
  model: string;
  modelOptions: ModelOption[];
  tools: SessionToolItem[];
  connectionStatus: ConnectionStatus;
  isResponding: boolean;
  onDraftChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSend: (payload: SendPayload) => void;
  onStop: () => void;
}

export function ChatComposer({
  draft,
  model,
  modelOptions,
  tools,
  connectionStatus,
  isResponding,
  onDraftChange,
  onModelChange,
  onSend,
  onStop,
}: ChatComposerProps) {
  const [toolId, setToolId] = useState("");
  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === toolId),
    [toolId, tools],
  );
  const canSend = Boolean(
    draft.trim() &&
      model &&
      connectionStatus === "online" &&
      !isResponding,
  );

  const selectTool = (tool: SessionToolItem) => {
    setToolId((current) => (current === tool.id ? "" : tool.id));
    if (!draft.trim() && tool.defaultFill) onDraftChange(tool.defaultFill);
  };

  const submit = () => {
    if (!canSend) return;
    const content = draft.trim();
    const wireContent = selectedTool
      ? `[assistant:${selectedTool.id}] ${content}`
      : content;
    onSend({ content, wireContent, model });
    onDraftChange("");
    setToolId("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.composerWrap}>
      {tools.length > 0 && (
        <div className={styles.toolBar}>
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.description}
              onClick={() => selectTool(tool)}
              className={cn(styles.toolChip, tool.id === toolId && styles.toolChipActive)}
            >
              <BookOpen size={14} />
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.composer}>
        {selectedTool && (
          <div className={styles.selectedArea}>
            <span className={styles.selectedPill}>
              <BookOpen size={14} />
              <span>Tool：{selectedTool.label}</span>
              <button
                type="button"
                className={styles.selectedPillClear}
                onClick={() => setToolId("")}
                aria-label="清除工具"
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}

        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={selectedTool?.placeholder || "输入你的问题，Enter 发送，Shift + Enter 换行"}
          className={styles.composerTextarea}
        />

        <footer className={styles.composerFooter}>
          <Select value={model} onValueChange={onModelChange} disabled={!modelOptions.length}>
            <SelectTrigger className={styles.modelSelectTrigger}>
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent position="popper">
              {modelOptions.map((option) => (
                <SelectItem key={option.model} value={option.model}>
                  {option.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className={styles.actionArea}>
            {isResponding ? (
              <button
                type="button"
                onClick={onStop}
                className={cn(styles.sendButton, styles.stopButton)}
                aria-label="停止回复"
              >
                <Square size={12} />
                停止
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                onClick={submit}
                className={styles.sendButton}
              >
                <SendHorizontal size={14} />
                发送
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
