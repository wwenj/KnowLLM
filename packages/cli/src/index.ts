#!/usr/bin/env node
import { getDefaultWorkspaceDirectories } from "@knowllm/core";

const [, , command = "help"] = process.argv;

function printHelp() {
  console.log(`KnowLLM CLI

Usage:
  knowllm init <dir>
  knowllm start
  knowllm import <file>
  knowllm compile <sourceId>
  knowllm search <query>
  knowllm query <question>
  knowllm lint
  knowllm mcp start
  knowllm skill install codex
`);
}

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "init") {
  console.log("Workspace directories:");
  for (const dir of getDefaultWorkspaceDirectories()) {
    console.log(`- ${dir}`);
  }
  console.log("\nTODO: create workspace files from templates/workspace.");
} else {
  console.log(`TODO: implement command "${command}".`);
  printHelp();
}
