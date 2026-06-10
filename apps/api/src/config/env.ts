import * as fs from "node:fs";
import * as path from "node:path";

export function findWorkspaceRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export function getApiRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

export function getEnvFilePaths(): string[] {
  const env = process.env.NODE_ENV || "development";
  const apiRoot = getApiRoot();
  const workspaceRoot = findWorkspaceRoot(apiRoot);
  return [
    path.join(apiRoot, "env", `.env.${env}`),
    path.join(apiRoot, `.env.${env}`),
    path.join(workspaceRoot, `.env.${env}`),
    path.join(apiRoot, ".env"),
    path.join(workspaceRoot, ".env")
  ];
}
