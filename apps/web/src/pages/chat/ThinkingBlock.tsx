import { BrainCircuit, ChevronRight } from "lucide-react";
import { useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import styles from "./styles.module.less";

export function ThinkingBlock({ content }: { content?: string }) {
  const [open, setOpen] = useState(true);

  if (!content?.trim()) return null;

  return (
    <div className={styles.thinkingBlock}>
      <button
        type="button"
        className={styles.thinkingHeader}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={styles.thinkingHeaderMain}>
          <BrainCircuit className={styles.thinkingIcon} />
          <span className={styles.thinkingLabel}>思考链路</span>
          <ChevronRight
            className={cn(
              styles.thinkingToggle,
              open && styles.thinkingToggleExpanded,
            )}
          />
        </span>
      </button>
      <div
        className={cn(
          styles.thinkingContentShell,
          !open && styles.thinkingContentShellCollapsed,
        )}
        aria-hidden={!open}
      >
        <div className={styles.thinkingContentViewport}>
          <div className={styles.thinkingContent}>
            <MarkdownRenderer content={content} className={styles.thinkingMarkdown} />
          </div>
        </div>
      </div>
    </div>
  );
}
