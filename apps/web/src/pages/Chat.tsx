import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/api/model";
import { modelApi } from "@/api/model";
import type {
  SessionItem,
  SessionMessage,
  SessionToolItem,
} from "@/api/session";
import { sessionApi } from "@/api/session";
import { SessionWsClient } from "@/api/session-ws";
import { ChatComposer } from "./chat/ChatComposer";
import { ChatMessageList } from "./chat/ChatMessageList";
import { ConversationList } from "./chat/ConversationList";
import styles from "./chat/styles.module.less";
import type {
  ChatMessage,
  ConnectionStatus,
  ConversationItem,
  SendPayload,
} from "./chat/types";

const MODEL_STORAGE_KEY = "zspace.chat.model.v1";
const HISTORY_COLLAPSED_STORAGE_KEY = "zspace.chat.historyCollapsed.v1";

export function Chat() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);
  const [draft, setDraft] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [tools, setTools] = useState<SessionToolItem[]>([]);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [isResponding, setIsResponding] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("offline");
  const [historyCollapsed, setHistoryCollapsed] = useState(
    resolveInitialHistoryCollapsed,
  );

  const wsRef = useRef<SessionWsClient | null>(null);
  const activeSessionRef = useRef<number | null>(null);
  const streamMessageIdRef = useRef<string | null>(null);
  const modelRef = useRef("");
  const loadSeqRef = useRef(0);

  const activeConversation = useMemo(() => {
    return (
      conversations.find((item) => item.id === activeConversationId) || null
    );
  }, [activeConversationId, conversations]);

  const disconnectWebSocket = useCallback(() => {
    wsRef.current?.disconnect();
    wsRef.current = null;
    streamMessageIdRef.current = null;
    setIsResponding(false);
    setConnectionStatus("offline");
  }, []);

  const refreshConversations = useCallback(async () => {
    const res = await sessionApi.list(1, 50, true);
    setConversations(res.list.map(toConversationItem));
    return res.list;
  }, []);

  const ensureStreamingMessage = useCallback((fallbackModel: string) => {
    if (streamMessageIdRef.current) return streamMessageIdRef.current;
    const streamId = `local-agent-${Date.now()}`;
    streamMessageIdRef.current = streamId;
    setIsResponding(true);
    setMessages((prev) => [
      ...prev,
      {
        id: streamId,
        role: "assistant",
        createdAt: formatClockTime(new Date()),
        model: fallbackModel,
        content: "",
        thinking: "",
        streaming: true,
      },
    ]);
    return streamId;
  }, []);

  const updateStreamingMessage = useCallback(
    (delta: { contentDelta?: string; thinkingDelta?: string }) => {
      const streamId = streamMessageIdRef.current;
      if (!streamId) return;
      setMessages((prev) =>
        prev.map((message) =>
          message.id === streamId
            ? {
                ...message,
                content: `${message.content}${delta.contentDelta || ""}`,
                thinking: `${message.thinking || ""}${delta.thinkingDelta || ""}`,
                streaming: true,
              }
            : message,
        ),
      );
    },
    [],
  );

  const connectWebSocket = useCallback(
    (sessionId: number) => {
      wsRef.current?.disconnect();
      setConnectionStatus("connecting");

      const client = new SessionWsClient(sessionId, (connected) => {
        if (activeSessionRef.current !== sessionId) return;
        setConnectionStatus(connected ? "online" : "offline");
        if (!connected) setIsResponding(false);
      });

      client.on("thinking", (event) => {
        if (activeSessionRef.current !== sessionId || !event.content) return;
        ensureStreamingMessage(modelRef.current);
        updateStreamingMessage({ thinkingDelta: event.content });
      });

      client.on("stream", (event) => {
        if (activeSessionRef.current !== sessionId || !event.content) return;
        ensureStreamingMessage(modelRef.current);
        updateStreamingMessage({ contentDelta: event.content });
      });

      client.on("done", (event) => {
        if (activeSessionRef.current !== sessionId) return;
        const streamId = ensureStreamingMessage(
          event.model || modelRef.current,
        );
        setMessages((prev) =>
          prev.map((message) =>
            message.id === streamId
              ? {
                  ...message,
                  id: event.message_id ? String(event.message_id) : message.id,
                  content: event.content || message.content,
                  thinking: event.thinking || message.thinking,
                  model: event.model || message.model,
                  timing: event.timing,
                  streaming: false,
                  createdAt: formatClockTime(new Date()),
                }
              : message,
          ),
        );
        streamMessageIdRef.current = null;
        setIsResponding(false);
        void refreshConversations();
      });

      client.on("session_title", (event) => {
        setConversations((prev) =>
          prev.map((item) =>
            item.id === event.session_id
              ? { ...item, title: event.title }
              : item,
          ),
        );
      });

      client.on("system", (event) => {
        if (event.message === "任务已取消") setIsResponding(false);
      });

      wsRef.current = client;
      void client.connect().catch(() => {
        if (activeSessionRef.current !== sessionId) return;
        setConnectionStatus("offline");
      });
    },
    [ensureStreamingMessage, refreshConversations, updateStreamingMessage],
  );

  const loadSessionDetail = useCallback(
    async (sessionId: number) => {
      const seq = ++loadSeqRef.current;
      activeSessionRef.current = sessionId;
      disconnectWebSocket();
      setLoading(true);

      try {
        const detail = await sessionApi.detail(sessionId, true);
        if (seq !== loadSeqRef.current) return;
        setActiveConversationId(sessionId);
        setMessages(detail.messages.map(toChatMessage));
        connectWebSocket(sessionId);
      } catch {
        if (seq === loadSeqRef.current) toast.error("加载会话失败");
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [connectWebSocket, disconnectWebSocket],
  );

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [sessionRes, modelRes, toolRes] = await Promise.all([
          sessionApi.list(1, 50, true),
          modelApi.list(true),
          sessionApi.listTools(true),
        ]);

        const nextModels = modelRes.items || [];
        const nextSessions = sessionRes.list || [];
        const nextModel = resolveInitialModel(nextModels);
        setModelOptions(nextModels);
        modelRef.current = nextModel;
        setModel(nextModel);
        setTools(toolRes.items || []);
        setConversations(nextSessions.map(toConversationItem));

        const firstSession =
          nextSessions[0] || (await sessionApi.create({ title: "新聊天" }));
        if (!nextSessions.length) {
          setConversations([toConversationItem(firstSession)]);
        }
        await loadSessionDetail(firstSession.id);
      } catch {
        toast.error("Chat 初始化失败");
        setLoading(false);
      }
    };

    void init();
    return () => {
      wsRef.current?.disconnect();
    };
  }, [loadSessionDetail]);

  const handleModelChange = (nextModel: string) => {
    modelRef.current = nextModel;
    setModel(nextModel);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, nextModel);
    } catch {
      // ignore localStorage failure
    }
  };

  const handleNewConversation = async () => {
    try {
      setLoading(true);
      const session = await sessionApi.create({ title: "新聊天" });
      await refreshConversations();
      setDraft("");
      await loadSessionDetail(session.id);
    } catch {
      toast.error("创建会话失败");
      setLoading(false);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    const sessionId = Number(conversationId);
    if (!Number.isInteger(sessionId)) return;

    try {
      await sessionApi.delete(sessionId);
      const nextSessions = (await refreshConversations()).filter(
        (item) => item.id !== sessionId,
      );
      if (sessionId !== activeConversationId) return;

      const next =
        nextSessions[0] || (await sessionApi.create({ title: "新聊天" }));
      await refreshConversations();
      await loadSessionDetail(next.id);
    } catch {
      toast.error("删除会话失败");
    }
  };

  const handleReconnect = () => {
    if (activeConversationId) connectWebSocket(activeConversationId);
  };

  const handleStop = () => {
    if (!isResponding) return;
    wsRef.current?.sendCancel();
    const streamId = streamMessageIdRef.current;
    if (streamId) {
      setMessages((prev) =>
        prev
          .map((message) =>
            message.id === streamId
              ? { ...message, streaming: false }
              : message,
          )
          .filter(
            (message) =>
              message.id !== streamId || message.content || message.thinking,
          ),
      );
    }
    streamMessageIdRef.current = null;
    setIsResponding(false);
  };

  const handleToggleHistoryCollapsed = () => {
    setHistoryCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(HISTORY_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // ignore localStorage failure
      }
      return next;
    });
  };

  const handleSend = (payload: SendPayload) => {
    if (!activeConversationId || !wsRef.current?.isConnected()) {
      toast.warning("WebSocket 未连接");
      return;
    }

    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      createdAt: formatClockTime(new Date()),
      content: payload.content,
    };
    const streamId = `local-agent-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: streamId,
      role: "assistant",
      createdAt: formatClockTime(new Date()),
      model: payload.model,
      content: "",
      thinking: "",
      streaming: true,
    };

    const sent = wsRef.current.sendMessage({
      content: payload.wireContent,
      model: payload.model,
    });
    if (!sent) {
      toast.error("消息发送失败");
      return;
    }

    streamMessageIdRef.current = streamId;
    setIsResponding(true);
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
  };

  return (
    <div className={styles.page}>
      <div
        className={cn(
          styles.layout,
          historyCollapsed && styles.layoutCollapsed,
        )}
      >
        {!historyCollapsed && (
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelect={(sessionId) => {
              if (sessionId !== activeConversationId)
                void loadSessionDetail(sessionId);
            }}
            onNew={() => void handleNewConversation()}
            onDelete={(sessionId) => void handleDeleteConversation(sessionId)}
          />
        )}

        <section className={styles.chatPanel}>
          <header className={styles.chatHeader}>
            <button
              type="button"
              className={cn(
                styles.chatHeaderToggle,
                historyCollapsed && styles.chatHeaderToggleCollapsed,
              )}
              onClick={handleToggleHistoryCollapsed}
              aria-label={historyCollapsed ? "展开菜单" : "收起菜单"}
              aria-expanded={!historyCollapsed}
              data-tooltip={historyCollapsed ? "展开菜单" : "收起菜单"}
            >
              {historyCollapsed ? (
                <ChevronsRight size={17} />
              ) : (
                <ChevronsLeft size={17} />
              )}
            </button>
            <div className={styles.chatTitleWrap}>
              <div className={styles.chatTitleLine}>
                <h1 className={styles.chatTitle}>
                  {activeConversation?.title ||
                    (loading ? "加载中..." : "Chat")}
                </h1>
                <ConnectionStatusInline
                  status={connectionStatus}
                  onReconnect={handleReconnect}
                />
              </div>
            </div>
          </header>

          <ChatMessageList
            messages={messages}
            loading={loading}
          />
          <ChatComposer
            draft={draft}
            model={model}
            modelOptions={modelOptions}
            tools={tools}
            connectionStatus={connectionStatus}
            isResponding={isResponding}
            onDraftChange={setDraft}
            onModelChange={handleModelChange}
            onSend={handleSend}
            onStop={handleStop}
          />
        </section>
      </div>
    </div>
  );
}

function ConnectionStatusInline({
  status,
  onReconnect,
}: {
  status: ConnectionStatus;
  onReconnect: () => void;
}) {
  const online = status === "online";
  const connecting = status === "connecting";
  const label = online ? "在线" : connecting ? "连接中" : "离线";
  const title = online
    ? "WebSocket 已连接"
    : connecting
      ? "WebSocket 正在连接"
      : "WebSocket 离线，点击重连";
  const content = (
    <>
      {online ? (
        <Wifi size={12} />
      ) : connecting ? (
        <RefreshCw size={12} className={styles.connectionStatusSpin} />
      ) : (
        <WifiOff size={12} />
      )}
      <span>{label}</span>
    </>
  );
  const className = cn(
    styles.connectionStatusInline,
    online
      ? styles.connectionStatusOnline
      : connecting
        ? styles.connectionStatusConnecting
        : styles.connectionStatusOffline,
  );

  if (online) {
    return (
      <span className={className} title={title} aria-label={title}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={onReconnect}
      title={title}
      aria-label={title}
    >
      {content}
    </button>
  );
}

function toConversationItem(session: SessionItem): ConversationItem {
  return {
    id: session.id,
    title: session.title,
    updatedAt: formatDateTime(session.updated_at),
  };
}

function toChatMessage(message: SessionMessage): ChatMessage {
  return {
    id: String(message.id),
    role: message.role === "agent" ? "assistant" : "user",
    content: stripRoutePrefix(message.content),
    createdAt: formatClockTime(new Date(message.created_at)),
    model: message.model || undefined,
    timing: message.timing,
    thinking: message.thinking || undefined,
  };
}

function resolveInitialModel(options: ModelOption[]): string {
  const first = options[0]?.model || "";
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored && options.some((option) => option.model === stored))
      return stored;
  } catch {
    // ignore localStorage failure
  }
  return first;
}

function resolveInitialHistoryCollapsed(): boolean {
  try {
    return localStorage.getItem(HISTORY_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    // ignore localStorage failure
  }
  return false;
}

function formatDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatClockTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stripRoutePrefix(content: string): string {
  return content.replace(/^\s*\[assistant:[^\]]+]\s*/, "").trim();
}
