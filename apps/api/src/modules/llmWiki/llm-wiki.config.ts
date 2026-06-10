import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";

export const llmWikiConfig = {
  root: path.join(getDataRoot(), "llm-wiki", "default"),
  maxUploadBytes: 10 * 1024 * 1024,
  maxSourceChars: 120_000,
  maxWikiFileBytes: 1024 * 1024,
  maxSearchResults: 20
};
