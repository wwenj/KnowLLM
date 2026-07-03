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
  if (!Array.isArray(agent.cases) || agent.cases.length < 40 || agent.cases.length > 60) {
    fail(manifest.datasetId + ": agent cases must contain 40-60 cases");
  }
  const compileFactCountBySource = new Map();
  const compileFactsBySource = new Map();
  for (const c of compile.cases) {
    for (const f of c.sourceFiles || []) if (!sourceSet.has(f)) fail(manifest.datasetId + ': compile case ' + c.id + ' references missing source ' + f);
    for (const fact of c.expectedFacts || []) {
      if (!sourceSet.has(fact.sourceFile)) fail(manifest.datasetId + ': fact ' + fact.id + ' references missing source ' + fact.sourceFile);
      if (!fact.fact || fact.fact.length < 10) fail(manifest.datasetId + ': fact text too short for ' + fact.id);
      if (!['definition', 'config', 'procedure', 'constraint', 'warning', 'command', 'general'].includes(fact.type)) {
        fail(manifest.datasetId + ': invalid fact type for ' + fact.id);
      }
      if (!['must', 'should', 'nice'].includes(fact.importance)) fail(manifest.datasetId + ': invalid importance for ' + fact.id);
      const content = fs.readFileSync(path.join(sourcesDir, fact.sourceFile), 'utf8');
      if (!content.includes(fact.evidence)) fail(manifest.datasetId + ': evidence not found for ' + fact.id);
      compileFactCountBySource.set(fact.sourceFile, (compileFactCountBySource.get(fact.sourceFile) || 0) + 1);
      if (!compileFactsBySource.has(fact.sourceFile)) compileFactsBySource.set(fact.sourceFile, new Set());
      compileFactsBySource.get(fact.sourceFile).add(fact.fact);
    }
  }
  for (const file of files) {
    if ((compileFactCountBySource.get(file) || 0) < 3) fail(manifest.datasetId + ': too few compile facts for ' + file);
  }
  let abstain = 0;
  let multiSource = 0;
  const agentTypes = new Set();
  const agentSourceCoverage = new Set();
  const agentQuestions = new Set();
  for (const c of agent.cases) {
    if (!c.id || !c.question || c.question.length < 12) fail(manifest.datasetId + ': invalid agent question for ' + c.id);
    if (agentQuestions.has(c.question)) fail(manifest.datasetId + ': duplicate agent question ' + c.id);
    if (/有什么关键说明|有什么必须保留的事实/.test(c.question)) fail(manifest.datasetId + ': generic agent question ' + c.id);
    agentQuestions.add(c.question);
    agentTypes.add(c.evaluationType);
    if (!c.expectedAnswer || c.expectedAnswer.length < 12 || c.expectedAnswer.length > 2000) {
      fail(manifest.datasetId + ': invalid expectedAnswer for ' + c.id);
    }
    if (!Array.isArray(c.mustInclude) || c.mustInclude.length < 2 || c.mustInclude.length > 6) {
      fail(manifest.datasetId + ': mustInclude must contain 2-6 terms for ' + c.id);
    }
    for (const keyword of c.mustInclude || []) {
      if (typeof keyword !== 'string' || keyword.length < 2 || keyword.length > 80) fail(manifest.datasetId + ': invalid mustInclude for ' + c.id);
      if (!c.expectedAnswer.includes(keyword)) fail(manifest.datasetId + ': mustInclude not found in expectedAnswer for ' + c.id + ': ' + keyword);
    }
    if (c.answerable === false) {
      abstain++;
      if ((c.expectedFacts || []).length || (c.relevantSources || []).length) {
        fail(manifest.datasetId + ': abstain case must not declare facts or sources ' + c.id);
      }
      continue;
    }
    const relevantSources = c.relevantSources || [];
    if (relevantSources.length < 1 || relevantSources.length > 3) {
      fail(manifest.datasetId + ': answerable case must reference 1-3 sources ' + c.id);
    }
    if (relevantSources.length > 1) multiSource++;
    for (const f of relevantSources) {
      if (!sourceSet.has(f)) fail(manifest.datasetId + ': agent case ' + c.id + ' references missing source ' + f);
      agentSourceCoverage.add(f);
    }
    const expectedFacts = c.expectedFacts || [];
    if (expectedFacts.length < 2 || expectedFacts.length > 4) {
      fail(manifest.datasetId + ': agent case must contain 2-4 facts ' + c.id);
    }
    const factIds = new Set();
    for (const [index, value] of expectedFacts.entries()) {
      const fact = typeof value === 'string' ? { id: c.id + '-F' + String(index + 1).padStart(2, '0'), fact: value } : value;
      if (!fact.id || factIds.has(fact.id)) fail(manifest.datasetId + ': duplicate or missing agent fact id for ' + c.id);
      factIds.add(fact.id);
      if (!fact.fact || fact.fact.length < 15 || fact.fact.length > 320) fail(manifest.datasetId + ': invalid agent fact ' + fact.id);
      if (/[：:]$/.test(fact.fact.trim())) fail(manifest.datasetId + ': incomplete agent fact ending with colon ' + fact.id);
      if (!c.expectedAnswer.includes(fact.fact)) fail(manifest.datasetId + ': expectedAnswer missing agent fact ' + fact.id);
      const grounded = relevantSources.some((source) => compileFactsBySource.get(source)?.has(fact.fact));
      if (!grounded) fail(manifest.datasetId + ': agent fact is not grounded in compile facts ' + fact.id);
    }
  }
  const abstainRate = abstain / agent.cases.length;
  if (abstainRate < 0.08 || abstainRate > 0.2) fail(manifest.datasetId + ': abstain ratio must be 8%-20%');
  if (multiSource < 3) fail(manifest.datasetId + ': expected at least 3 multi-source agent cases');
  if (agentTypes.size < 6) fail(manifest.datasetId + ': expected at least 6 agent evaluation types');
  if (agentSourceCoverage.size / files.length < 0.7) fail(manifest.datasetId + ': agent source coverage must be at least 70%');
  console.log('ok ' + manifest.datasetId + ': ' + files.length + ' sources, ' + compile.cases.length + ' compile cases, ' + agent.cases.length + ' agent cases');
}
