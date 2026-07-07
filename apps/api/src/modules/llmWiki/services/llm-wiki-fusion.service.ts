import { Injectable } from "@nestjs/common";
import type {
  LlmWikiDraftPage,
  LlmWikiFact,
  LlmWikiFusionResult,
  LlmWikiNormalizedPage,
  LlmWikiPageClaims,
} from "../contracts/llm-wiki.types";
import { runPublishGate } from "./llm-wiki-publish-gate";

@Injectable()
export class LlmWikiFusionService {
  mergeFacts(args: {
    existingFacts: LlmWikiFact[];
    newFacts: LlmWikiFact[];
    pages: LlmWikiDraftPage[];
    pageClaims: LlmWikiPageClaims[];
  }): {
    pages: LlmWikiDraftPage[];
    pageClaims: LlmWikiPageClaims[];
    facts: LlmWikiFact[];
  } {
    const facts = mergeFactLedgers(args.existingFacts, args.newFacts);
    const gate = runPublishGate({ pages: args.pages, pageClaims: args.pageClaims, facts });
    if (!gate.passed) throw new Error(`fact fusion publish gate failed: ${gate.issues.map((item) => item.message).join("; ")}`);
    return { pages: gate.pages, pageClaims: gate.pageClaims, facts };
  }

  async mergeDraft(args: {
    draft: LlmWikiDraftPage;
    source: { source_id: string };
  }): Promise<LlmWikiFusionResult> {
    return {
      action: "create",
      page: args.draft as LlmWikiNormalizedPage,
      sources: [args.source.source_id],
      change_summary: "fact-ledger page created",
      issues: [],
    };
  }
}

function mergeFactLedgers(existingFacts: LlmWikiFact[], newFacts: LlmWikiFact[]): LlmWikiFact[] {
  const byId = new Map<string, LlmWikiFact>();
  for (const fact of existingFacts) byId.set(fact.factId, fact);
  for (const fact of newFacts) byId.set(fact.factId, fact);
  return [...byId.values()];
}
