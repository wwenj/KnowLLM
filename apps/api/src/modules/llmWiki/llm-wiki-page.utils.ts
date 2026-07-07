export function isWikiMarkdownPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(index\.md|summaries\/[a-f0-9]{32}\.md|(?:concepts|entities|references|procedures|changelogs|troubleshooting)\/[A-Za-z0-9._-]+\.md)$/.test(value)
  );
}

export function assertWikiMarkdownPath(value: unknown): asserts value is string {
  if (!isWikiMarkdownPath(value)) throw new Error("wiki page path 非法");
}

export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const text = stripInlineCode(stripFencedCode(content));
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const target = (match[1] || "").split("|")[0].split("#")[0].trim();
    if (target && !links.includes(target)) links.push(target);
  }
  return links;
}

export function extractWikiPagePaths(content: string): string[] {
  return extractWikiLinks(content).filter(isWikiMarkdownPath);
}

function stripFencedCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}

function stripInlineCode(content: string): string {
  return content.replace(/`[^`]*`/g, "");
}
