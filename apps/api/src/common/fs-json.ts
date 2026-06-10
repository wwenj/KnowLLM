import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, payload: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}

export function readText(file: string, fallback = ""): string {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : fallback;
  } catch {
    return fallback;
  }
}

export function writeText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, file);
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
