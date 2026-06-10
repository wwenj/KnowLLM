import * as path from "node:path";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function titleFromMarkdown(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return normalizeWhitespace(match?.[1] || fallback).slice(0, 160) || "Untitled";
}

export function slugify(value: string, fallback = "item"): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

export function safeFilename(filename: string): string {
  const base = path.basename(String(filename || "source.txt")).replace(/[^\p{L}\p{N} ._()-]+/gu, "_");
  return base.trim().slice(0, 180) || "source.txt";
}

export function safeMarkdownPath(input: string, fallback = "index.md"): string {
  const raw = String(input || fallback).replace(/\\/g, "/").trim();
  const normalized = path.posix.normalize(raw || fallback);
  if (
    !normalized ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith("/") ||
    normalized === ".."
  ) {
    throw new Error("path 非法");
  }
  return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function snippet(content: string, query: string, size = 180): string {
  const text = normalizeWhitespace(stripFrontmatter(content));
  if (!text) return "";
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, size);
  const start = Math.max(0, idx - 70);
  const end = Math.min(text.length, idx + query.length + 110);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}
