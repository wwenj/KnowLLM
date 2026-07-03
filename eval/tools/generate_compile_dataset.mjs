#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const datasetDir = path.resolve(process.argv[2] || "eval/zh_klipper3d_manual_mini");
const manifestFile = path.join(datasetDir, "source_manifest.json");
const sourcesDir = path.join(datasetDir, "sources");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sourceContent(filename) {
  return fs.readFileSync(path.join(sourcesDir, filename), "utf8");
}

function normalizeFactText(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyType(text) {
  const value = text.toLowerCase();
  if (/警告|注意|请注意|避免|不要|不能|错误|风险|损坏|故障|caution|warning/.test(text)) return "warning";
  if (/命令|运行|执行|g-code|gcode|api|save_config|make |query_|probe|calibrate|restart/.test(value)) return "command";
  if (/配置|参数|引脚|printer\.cfg|config|pin|section|serial|baud|i2c|spi|can/.test(value)) return "config";
  if (/步骤|流程|安装|校准|刷写|更新|测试|检查|验证|调平|测量/.test(text)) return "procedure";
  if (/必须|需要|要求|限制|无法|不支持|只支持|通常|默认|建议/.test(text)) return "constraint";
  if (/支持|用于|可以|提供|介绍|描述|参考/.test(text)) return "definition";
  return "general";
}

function importanceFor(type, text) {
  if (/警告|必须|不能|不要|错误|损坏|故障|安全|风险|无效|失败/.test(text)) return "must";
  if (type === "warning" || type === "config" || type === "command" || type === "constraint") return "must";
  if (type === "procedure" || type === "definition") return "should";
  return "nice";
}

function candidateScore(text, type) {
  let score = 0;
  if (type === "warning") score += 70;
  if (type === "config") score += 60;
  if (type === "command") score += 58;
  if (type === "constraint") score += 55;
  if (type === "procedure") score += 45;
  if (type === "definition") score += 35;
  if (/必须|需要|应该|建议|默认|只|不能|不要|错误|注意|警告/.test(text)) score += 20;
  if (/[0-9]/.test(text)) score += 10;
  if (/`[^`]+`/.test(text)) score += 8;
  if (text.length >= 35 && text.length <= 220) score += 12;
  if (text.length > 360) score -= 25;
  return score;
}

function splitSentences(block) {
  const trimmed = block.trim();
  const matches = trimmed.match(/[^。！？!?]+[。！？!?]?/g) || [trimmed];
  const out = [];
  for (const item of matches) {
    const text = item.trim();
    for (const fragment of splitLongSentence(text)) {
      if (fragment.length >= 24) out.push(fragment);
    }
  }
  return out.length ? out : [trimmed];
}

function splitLongSentence(text) {
  if (text.length <= 220) return [text];
  let fragments = splitByDelimiters(text, "；;");
  if (fragments.some((item) => item.length > 260)) fragments = splitByDelimiters(text, "，,");
  return fragments.length ? fragments : [text];
}

function splitByDelimiters(text, delimiters) {
  const out = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!delimiters.includes(text[index])) continue;
    const fragment = text.slice(start, index + 1).trim();
    if (fragment.length >= 24) out.push(fragment);
    start = index + 1;
  }
  const tail = text.slice(start).trim();
  if (tail.length >= 24) out.push(tail);
  return out;
}

function extractBlocks(content) {
  const blocks = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let buffer = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      if (buffer.length) {
        blocks.push(buffer.join("\n").trim());
        buffer = [];
      }
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed) {
      if (buffer.length) {
        blocks.push(buffer.join("\n").trim());
        buffer = [];
      }
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      if (buffer.length) {
        blocks.push(buffer.join("\n").trim());
        buffer = [];
      }
      continue;
    }
    if (/^\|/.test(trimmed) || /^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      if (buffer.length) {
        blocks.push(buffer.join("\n").trim());
        buffer = [];
      }
      blocks.push(trimmed);
      continue;
    }
    buffer.push(line);
  }
  if (buffer.length) blocks.push(buffer.join("\n").trim());
  return blocks;
}

function candidatesFor(content) {
  const seen = new Set();
  const candidates = [];
  for (const block of extractBlocks(content)) {
    if (!/[一-龥A-Za-z]/.test(block)) continue;
    if (/^\|[-:\s|]+\|?$/.test(block)) continue;
    for (const evidence of splitSentences(block)) {
      if (evidence.length < 20 || evidence.length > 520) continue;
      if (!content.includes(evidence)) continue;
      const fact = normalizeFactText(evidence);
      if (fact.length < 18 || seen.has(fact)) continue;
      seen.add(fact);
      const type = classifyType(fact);
      candidates.push({
        fact,
        evidence,
        type,
        importance: importanceFor(type, fact),
        score: candidateScore(fact, type),
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.fact.length - b.fact.length);
}

function pickFacts(content) {
  const candidates = candidatesFor(content);
  const selected = [];
  const typeCounts = new Map();
  for (const item of candidates) {
    const count = typeCounts.get(item.type) || 0;
    if (selected.length < 3 || count < 2) {
      selected.push(item);
      typeCounts.set(item.type, count + 1);
    }
    if (selected.length >= 6) break;
  }
  if (selected.length < 3) {
    for (const item of candidates) {
      if (!selected.includes(item)) selected.push(item);
      if (selected.length >= 3) break;
    }
  }
  return selected.slice(0, 6);
}

const manifest = readJson(manifestFile);
const compileCases = [];
const uploadCases = [];
const uploadSources = [];

for (const [index, source] of manifest.sources.entries()) {
  const content = sourceContent(source.filename);
  const caseId = `C${String(index + 1).padStart(3, "0")}`;
  const facts = pickFacts(content).map((item, factIndex) => ({
    id: `${caseId}-F${String(factIndex + 1).padStart(2, "0")}`,
    fact: item.fact,
    sourceFile: source.filename,
    evidence: item.evidence,
    type: item.type,
    importance: item.importance,
  }));
  if (facts.length < 3) {
    throw new Error(`${source.filename} only produced ${facts.length} facts`);
  }
  compileCases.push({
    id: caseId,
    name: `${source.title || source.filename.replace(/\.md$/, "")} 事实保真`,
    sourceFiles: [source.filename],
    expectedFacts: facts,
  });
  uploadCases.push({
    id: caseId,
    name: `${source.title || source.filename.replace(/\.md$/, "")} 事实保真`,
    sourceIds: [source.id],
    expectedFacts: facts,
  });
  uploadSources.push({
    id: source.id,
    filename: source.filename,
    content,
  });
}

writeJson(path.join(datasetDir, "compile_cases.json"), {
  datasetId: manifest.datasetId,
  name: `${manifest.name}：编译事实保真评测`,
  sourceDir: "sources",
  cases: compileCases,
});

writeJson(path.join(datasetDir, "upload_compile_dataset.json"), {
  datasetId: manifest.datasetId,
  name: `${manifest.name}：编译事实保真评测`,
  sources: uploadSources,
  cases: uploadCases,
});

console.log(`generated ${compileCases.length} cases / ${compileCases.reduce((sum, item) => sum + item.expectedFacts.length, 0)} facts`);
