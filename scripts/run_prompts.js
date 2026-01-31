#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

const USAGE = 'Usage: node run_prompts.js <systemprompt file> <prompt file> <repeat count>';

const readTextFile = (filePath, label) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error(`Missing ${label} file path. ${USAGE}`);
  }
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  if (!content.trim()) {
    throw new Error(`${label} file is empty: ${resolved}`);
  }
  return content;
};

const loadConfig = (configPath) => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file is invalid: ${configPath}`);
  }
  if (!parsed.ai || typeof parsed.ai !== 'object') {
    throw new Error(`Config file missing ai block: ${configPath}`);
  }
  return parsed;
};

const runOnce = async (index, systemPrompt, userPrompt, metadataLabel) => {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const responseText = await LLMClient.chatCompletion({
    messages,
    metadataLabel,
    validateXML: false,
    output: 'stderr',
  });

  if (typeof responseText !== 'string' || responseText.trim() === '') {
    throw new Error(`Empty response received for run ${index}.`);
  }

  if (typeof LLMClient.logPrompt === 'function') {
    LLMClient.logPrompt({
      prefix: 'run_prompt',
      metadataLabel,
      systemPrompt,
      generationPrompt: userPrompt,
      response: responseText,
      output: 'stderr',
    });
  }

  return responseText;
};

const main = async () => {
  const [, , systemPath, promptPath, repeatRaw] = process.argv;
  if (!systemPath || !promptPath || !repeatRaw) {
    throw new Error(USAGE);
  }

  const repeatCount = Number.parseInt(repeatRaw, 10);
  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error('Repeat count must be a positive integer.');
  }

  const scriptDir = __dirname;
  const rootDir = path.resolve(scriptDir, '..');
  const configPath = path.join(scriptDir, 'config.yaml');

  const config = loadConfig(configPath);
  Globals.baseDir = rootDir;
  Globals.config = config;

  const systemPrompt = readTextFile(systemPath, 'System prompt');
  const userPrompt = readTextFile(promptPath, 'Prompt');

  const metadataLabel = 'run_prompts';
  const startTime = process.hrtime.bigint();

  const tasks = Array.from({ length: repeatCount }, (_, index) =>
    runOnce(index + 1, systemPrompt, userPrompt, metadataLabel)
  );

  const results = await Promise.all(tasks);
  const endTime = process.hrtime.bigint();

  results.forEach((result, index) => {
    if (index > 0) {
      process.stdout.write('\n\n---\n\n');
    }
    process.stdout.write(result);
  });

  const averageMs = Number(endTime - startTime) / 1e6 / repeatCount;
  process.stdout.write(`\n\nAverage prompt runtime: ${averageMs.toFixed(2)} ms\n`);
};

main().catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
