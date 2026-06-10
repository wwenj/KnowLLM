import * as fs from "node:fs";
import * as path from "node:path";
import { findWorkspaceRoot, getApiRoot } from "./env";

export function getDataRoot(): string {
  const configured = String(process.env.KNOWLLM_DATA_ROOT || "").trim();
  const root = configured
    ? path.resolve(configured)
    : path.join(findWorkspaceRoot(getApiRoot()), ".knowllm");
  fs.mkdirSync(root, { recursive: true });
  return root;
}
