#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const datasetDirs = process.argv.slice(2);
if (!datasetDirs.length) {
  console.error('Usage: node eval/tools/validate_llmwiki_dataset.mjs <dataset_dir> [...]');
  process.exit(1);
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function fail(msg) { console.error('ERROR:', msg); process.exitCode = 1; }

for (const dir of datasetDirs) {
  const abs = path.resolve(dir);
  const sourcesDir = path.join(abs, 'sources');
  const manifest = readJson(path.join(abs, 'source_manifest.json'));
  const compile = readJson(path.join(abs, 'compile_cases.json'));
  const agent = readJson(path.join(abs, 'agent_cases.json'));
  const files = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.md')).sort();
  if (files.length <= 50 || files.length >= 100) fail(manifest.datasetId + ': source count ' + files.length + ' is not >50 and <100');
  if (manifest.documentCount !== files.length) fail(manifest.datasetId + ': manifest documentCount mismatch');
  if (manifest.sources.length !== files.length) fail(manifest.datasetId + ': manifest sources length mismatch');
  const sourceSet = new Set(files);
  for (const src of manifest.sources) {
    if (!sourceSet.has(src.filename)) fail(manifest.datasetId + ': manifest source missing file ' + src.filename);
    const content = fs.readFileSync(path.join(sourcesDir, src.filename), 'utf8');
    if (sha256(content) !== src.sha256) fail(manifest.datasetId + ': sha256 mismatch for ' + src.filename);
    if (!src.sourceUrl || !src.sourcePath || !src.license) fail(manifest.datasetId + ': incomplete manifest metadata for ' + src.filename);
  }
  if (compile.datasetId !== manifest.datasetId) fail(manifest.datasetId + ": compile datasetId mismatch");
  if (agent.datasetId !== manifest.datasetId) fail(manifest.datasetId + ": agent datasetId mismatch");
  if (!Array.isArray(compile.cases) || compile.cases.length < 25) fail(manifest.datasetId + ": too few compile cases");
  if (!Array.isArray(agent.cases) || agent.cases.length < 20) fail(manifest.datasetId + ": too few agent cases");
  for (const c of compile.cases) {
    for (const f of c.sourceFiles || []) if (!sourceSet.has(f)) fail(manifest.datasetId + ': compile case ' + c.id + ' references missing source ' + f);
    for (const fact of c.expectedFacts || []) {
      if (!sourceSet.has(fact.sourceFile)) fail(manifest.datasetId + ': fact ' + fact.id + ' references missing source ' + fact.sourceFile);
      const content = fs.readFileSync(path.join(sourcesDir, fact.sourceFile), 'utf8');
      if (!content.includes(fact.evidence)) fail(manifest.datasetId + ': evidence not found for ' + fact.id);
    }
  }
  let abstain = 0;
  for (const c of agent.cases) {
    if (c.answerable === false) { abstain++; continue; }
    for (const f of c.relevantSources || []) if (!sourceSet.has(f)) fail(manifest.datasetId + ': agent case ' + c.id + ' references missing source ' + f);
    if (!c.expectedAnswer || !(c.expectedFacts || []).length) fail(manifest.datasetId + ': agent case ' + c.id + ' missing answer/facts');
  }
  if (abstain < 1) fail(manifest.datasetId + ': expected at least one abstain case');
  console.log('ok ' + manifest.datasetId + ': ' + files.length + ' sources, ' + compile.cases.length + ' compile cases, ' + agent.cases.length + ' agent cases');
}
