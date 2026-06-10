import { Injectable } from "@nestjs/common";
import type { AgentArtifact } from "../agent.types";

@Injectable()
export class AgentResultRendererService {
  render(args: {
    agentType: string;
    rawContent: string;
    artifacts: AgentArtifact[];
    status: string;
    errors: string[];
    extra?: Record<string, unknown>;
  }) {
    const textResult = String(args.rawContent || "").trim();
    const warnings = args.errors.map((item) => String(item || "").trim()).filter(Boolean);
    const markdown = renderMarkdown(textResult, args.status, warnings);
    return {
      markdown,
      resultJson: {
        status: args.status,
        kind: args.artifacts.length && textResult ? "mixed" : args.artifacts.length ? "artifact" : "text",
        artifacts: args.artifacts,
        textResult,
        warnings,
        agentType: args.agentType,
        ...(args.extra || {})
      }
    };
  }
}

function renderMarkdown(textResult: string, status: string, warnings: string[]): string {
  const sections: string[] = [];
  if (textResult) sections.push(textResult);
  else if (status === "success") sections.push("任务已完成。");
  if (warnings.length) {
    sections.push(["## 注意事项", ...warnings.slice(0, 5).map((item) => `- ${singleLine(item, 220)}`)].join("\n"));
  }
  return `${sections.map((section) => section.trim()).filter(Boolean).join("\n\n")}\n`;
}

function singleLine(text: string, limit: number): string {
  const normalized = String(text || "").split(/\s+/).filter(Boolean).join(" ");
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit).replace(/\s+$/, "")}...`;
}
