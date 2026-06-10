import { memo, useMemo, type ReactNode } from "react";
import { Bot, Sparkles } from "lucide-react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { ImageRenderer } from "./ImageRenderer";
import { MarkdownRenderBoundary } from "./MarkdownRenderBoundary";

interface MarkdownRendererProps {
  content?: string | null;
  className?: string;
  emptyFallback?: ReactNode;
  components?: Components;
  copyableCode?: boolean;
  imagePreview?: boolean;
  openLinksInNewTab?: boolean;
  skipHtml?: boolean;
}

type HastElementLike = {
  tagName?: string;
  children?: HastElementLike[];
};

type MessageDirective = {
  kind: "assistant" | "skill";
  value: string;
};

type ParsedMarkdown = {
  markdown: string;
  directive: MessageDirective | null;
};

const MESSAGE_DIRECTIVE_RE = /^\s*\[(assistant|skill):([A-Za-z0-9._-]+)\]\s*/;

function isElementNode(value: unknown): value is HastElementLike {
  return typeof value === "object" && value !== null && "tagName" in value;
}

function hasDirectImageChild(node: unknown): boolean {
  if (!isElementNode(node) || !Array.isArray(node.children)) {
    return false;
  }

  return node.children.some((child) => {
    return isElementNode(child) && child.tagName === "img";
  });
}

function getLanguage(className?: string): string {
  return /language-([\w-]+)/.exec(className || "")?.[1] || "";
}

function isExternalHref(href?: string): boolean {
  return Boolean(href && /^https?:\/\//i.test(href));
}

function parseMessageDirective(markdown: string): ParsedMarkdown {
  const match = MESSAGE_DIRECTIVE_RE.exec(markdown);
  if (!match) {
    return { markdown, directive: null };
  }

  return {
    markdown: markdown.slice(match[0].length),
    directive: {
      kind: match[1] as MessageDirective["kind"],
      value: match[2],
    },
  };
}

function MarkdownRenderer({
  content,
  className,
  emptyFallback = null,
  components,
  copyableCode = true,
  imagePreview = true,
  openLinksInNewTab = true,
  skipHtml = false,
}: MarkdownRendererProps) {
  const markdown = content ?? "";
  const parsedMarkdown = useMemo(() => parseMessageDirective(markdown), [markdown]);

  const markdownComponents = useMemo<Components>(() => {
    const baseComponents: Components = {
      pre({ children }) {
        return <>{children}</>;
      },
      code({ children, className: codeClassName, ...props }) {
        const rawCode = String(children ?? "");
        const language = getLanguage(codeClassName);
        const isBlock = Boolean(language) || rawCode.includes("\n");

        if (isBlock) {
          return (
            <CodeBlock
              code={rawCode.replace(/\n$/, "")}
              language={language}
              copyable={copyableCode}
            />
          );
        }

        return (
          <code
            className={cn(
              "rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800",
              codeClassName,
            )}
            {...props}
          >
            {children}
          </code>
        );
      },
      img({ src, alt }) {
        return (
          <ImageRenderer
            src={src}
            alt={alt}
            preview={imagePreview}
          />
        );
      },
      p({ node, children, ...props }) {
        if (hasDirectImageChild(node)) {
          return <div {...props}>{children}</div>;
        }

        return <p {...props}>{children}</p>;
      },
      a({ href, children, className: linkClassName, ...props }) {
        const external = openLinksInNewTab && isExternalHref(href);

        return (
          <a
            {...props}
            href={href}
            target={external ? "_blank" : props.target}
            rel={external ? "noreferrer" : props.rel}
            className={cn(
              "font-medium text-sky-700 underline-offset-3 hover:underline",
              linkClassName,
            )}
          >
            {children}
          </a>
        );
      },
      table({ children, className: tableClassName, ...props }) {
        return (
          <div className="not-prose my-4 max-w-full overflow-x-auto rounded-lg border border-slate-200">
            <table
              {...props}
              className={cn(
                "m-0 w-full min-w-max border-collapse bg-white text-left text-sm",
                tableClassName,
              )}
            >
              {children}
            </table>
          </div>
        );
      },
      th({ children, className: cellClassName, ...props }) {
        return (
          <th
            {...props}
            className={cn(
              "border-b border-r border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 last:border-r-0",
              cellClassName,
            )}
          >
            {children}
          </th>
        );
      },
      td({ children, className: cellClassName, ...props }) {
        return (
          <td
            {...props}
            className={cn(
              "border-b border-r border-slate-200 px-3 py-2 align-top text-slate-700 last:border-r-0",
              cellClassName,
            )}
          >
            {children}
          </td>
        );
      },
      input({ type, className: inputClassName, ...props }) {
        if (type !== "checkbox") {
          return <input type={type} className={inputClassName} {...props} />;
        }

        return (
          <input
            {...props}
            type="checkbox"
            className={cn(
              "mt-1 size-3.5 rounded border-slate-300 accent-slate-900",
              inputClassName,
            )}
          />
        );
      },
    };

    return {
      ...baseComponents,
      ...components,
    };
  }, [
    components,
    copyableCode,
    imagePreview,
    openLinksInNewTab,
  ]);

  if (!parsedMarkdown.markdown.trim() && !parsedMarkdown.directive) {
    return emptyFallback;
  }

  return (
    <MarkdownRenderBoundary resetKey={markdown}>
      <article
        className={cn(
          "prose prose-sm max-w-none break-words prose-slate",
          "prose-headings:tracking-normal prose-headings:text-slate-950",
          "prose-p:leading-6 prose-p:text-slate-700",
          "prose-li:my-1 prose-li:text-slate-700",
          "prose-blockquote:border-l-slate-300 prose-blockquote:bg-slate-50 prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:text-slate-600",
          "prose-hr:border-slate-200",
          "prose-pre:m-0 prose-pre:bg-transparent prose-pre:p-0",
          "prose-code:before:content-none prose-code:after:content-none",
          "prose-img:m-0",
          className,
        )}
      >
        {parsedMarkdown.directive && (
          <MessageDirectiveBadge directive={parsedMarkdown.directive} />
        )}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          skipHtml={skipHtml}
        >
          {parsedMarkdown.markdown}
        </ReactMarkdown>
      </article>
    </MarkdownRenderBoundary>
  );
}

function MessageDirectiveBadge({ directive }: { directive: MessageDirective }) {
  const isSkill = directive.kind === "skill";
  const Icon = isSkill ? Sparkles : Bot;
  const label = isSkill ? "Skill" : "工具";

  return (
    <div
      className={cn(
        "not-prose mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
        isSkill
          ? "bg-emerald-50 text-emerald-700"
          : "bg-blue-50 text-blue-700",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="shrink-0">{label}</span>
      <span className={cn("h-3 w-px", isSkill ? "bg-emerald-200" : "bg-blue-200")} />
      <span className="min-w-0 truncate font-semibold">{directive.value}</span>
    </div>
  );
}

export { MarkdownRenderer };
export type { MarkdownRendererProps };
export default memo(MarkdownRenderer);
