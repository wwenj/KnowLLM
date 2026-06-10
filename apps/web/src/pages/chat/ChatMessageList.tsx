import { Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import styles from "./styles.module.less";
import { ThinkingBlock } from "./ThinkingBlock";
import type { ChatMessage } from "./types";

const LOGO_URL =
  "https://file.ljcdn.com/nebula/313477d365d143b487d041f741e2ce93_1776847846865.png";

interface ChatMessageListProps {
  messages: ChatMessage[];
  loading: boolean;
}

export function ChatMessageList({
  messages,
  loading,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, lastMessage?.content, lastMessage?.thinking]);

  return (
    <div
      className={cn(styles.chatBody, !messages.length && styles.chatBodyEmpty)}
    >
      <div className={styles.messageListInner}>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {!messages.length && (loading ? <LoadingState /> : <EmptyState />)}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className={styles.userMessageRow}>
        <div className={styles.userMessageBox}>
          <div className={styles.userMessage}>
            <MarkdownRenderer
              content={message.content}
              className={cn(styles.messageMarkdown, styles.userMarkdown)}
            />
          </div>
          <MessageMeta message={message} align="right" />
        </div>
      </div>
    );
  }

  return (
    <article className={styles.assistantMessage}>
      <ThinkingBlock content={message.thinking} />
      {message.content ? (
        <MarkdownRenderer
          content={message.content}
          className={styles.messageMarkdown}
        />
      ) : !message.streaming ? (
        <div className={styles.streamingPlaceholder}>暂无回复内容</div>
      ) : null}
      {message.streaming ? (
        <StreamingStatus />
      ) : (
        <MessageMeta message={message} align="left" />
      )}
    </article>
  );
}

function StreamingStatus() {
  return (
    <div className={styles.streamingStatus} aria-live="polite">
      <Loader2 className={styles.streamingSpinner} size={14} />
      <span>正在输出....</span>
    </div>
  );
}

function MessageMeta({
  message,
  align,
}: {
  message: ChatMessage;
  align: "left" | "right";
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const copyContent = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1200);
    } catch {
      // ignore clipboard failure
    }
  };
  const isAssistant = message.role === "assistant";
  const items = [
    message.createdAt || "刚刚",
    isAssistant && message.model,
    isAssistant && formatTiming(message.timing),
  ].filter(Boolean);

  return (
    <div
      className={cn(
        styles.messageMeta,
        align === "right" && styles.messageMetaRight,
      )}
    >
      {items.map((item, index) => (
        <span key={String(item)} className={styles.messageMetaItem}>
          {index > 0 && <span className={styles.metaDivider}>·</span>}
          {item}
        </span>
      ))}
      <button
        type="button"
        className={cn(styles.copyButton, copied && styles.copyButtonCopied)}
        onClick={copyContent}
        disabled={!message.content}
        aria-label={copied ? "已复制" : "复制消息"}
        title={copied ? "已复制" : "复制消息"}
      >
        <Copy size={13} />
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateInner}>
        <div className={styles.emptyStateVisual} aria-hidden="true">
          <img
            src={LOGO_URL}
            alt=""
            draggable={false}
            className={cn(
              styles.emptyLogo,
              "animate-nf-signal-shake",
              "animate-nf-signal-flicker",
              "animate-nf-signal-glitch",
            )}
          />
        </div>
        <span className={styles.emptyStateTitle}>随便问</span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className={styles.emptyState}
      aria-live="polite"
      aria-label="正在加载消息"
    >
      <div className={styles.messageSkeletonGroup}>
        <span className={styles.messageSkeletonWide} />
        <span className={styles.messageSkeletonShort} />
      </div>
    </div>
  );
}

function formatTiming(timing?: ChatMessage["timing"]): string | null {
  if (!timing || typeof timing.total_ms !== "number") return null;
  if (timing.total_ms < 1000) return `${timing.total_ms}ms`;
  return `${(timing.total_ms / 1000).toFixed(1)}s`;
}
