import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./styles.module.less";
import type { ConversationItem } from "./types";

interface ConversationListProps {
  conversations: ConversationItem[];
  activeConversationId: number | null;
  onSelect: (conversationId: number) => void;
  onNew: () => void;
  onDelete: (conversationId: string) => void;
}

export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onNew,
  onDelete,
}: ConversationListProps) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  return (
    <aside className={styles.historyPanel}>
      <div className={styles.historyHeader}>
        <div className={styles.historyTitleBlock}>
          <h2 className={styles.historyTitle}>对话</h2>
          <span className={styles.historyCount}>{conversations.length} 个会话</span>
        </div>
        <button type="button" className={styles.newChatButton} onClick={onNew}>
          <Plus size={14} />
          新聊天
        </button>
      </div>

      <div className={styles.historyListShell}>
        <div className={styles.historyList} aria-label="会话列表">
          {conversations.map((conversation) => (
            <ConversationButton
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
              onClick={() => onSelect(conversation.id)}
              menuOpen={openMenuId === conversation.id}
              onToggleMenu={() =>
                setOpenMenuId((current) =>
                  current === conversation.id ? null : conversation.id,
                )
              }
              onCloseMenu={() => setOpenMenuId(null)}
              onDelete={() => {
                onDelete(String(conversation.id));
                setOpenMenuId(null);
              }}
            />
          ))}
          {!conversations.length && (
            <div className={styles.emptyState}>
              暂无会话
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function ConversationButton({
  conversation,
  active,
  menuOpen,
  onClick,
  onToggleMenu,
  onCloseMenu,
  onDelete,
}: {
  conversation: ConversationItem;
  active: boolean;
  menuOpen: boolean;
  onClick: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onCloseMenu();
        }
      }}
      className={cn(
        styles.historyItem,
        active && styles.historyItemActive,
        menuOpen && styles.historyItemMenuOpen,
      )}
    >
      <button
        type="button"
        className={styles.historyItemButton}
        onClick={onClick}
        aria-current={active ? "true" : undefined}
      >
        <span className={styles.historyName}>{conversation.title}</span>
        <span className={styles.historyTime}>{conversation.updatedAt}</span>
      </button>
      <button
        type="button"
        className={styles.historyMoreButton}
        onClick={onToggleMenu}
        aria-label={`${conversation.title} 操作`}
        aria-expanded={menuOpen}
      >
        <MoreHorizontal size={16} />
      </button>
      {menuOpen && (
        <div
          className={styles.historyMenu}
          role="menu"
        >
          <button type="button" className={styles.deleteMenuItem} onClick={onDelete} role="menuitem">
            <Trash2 size={13} />
            删除
          </button>
        </div>
      )}
    </div>
  );
}
