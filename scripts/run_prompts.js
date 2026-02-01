#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const nunjucks = require('nunjucks');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

const USAGE = 'Usage: node run_prompts.js <systemprompt file> <prompt file> <repeat count> [xmlTag] [requiredRegex]';

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
  return { content, resolved };
};

const createTemplateEnv = (searchPaths) => {
  const loader = new nunjucks.FileSystemLoader(searchPaths, { noCache: true });
  return new nunjucks.Environment(loader, { autoescape: false, throwOnUndefined: false });
};

const renderTemplateString = (env, content, filePath, context = {}) => {
  try {
    const template = new nunjucks.Template(content, env, filePath, true);
    return template.render(context);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Failed to render template ${filePath}: ${message}`);
  }
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

const extractTagContent = (text, tag) => {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const matches = [];
  let match = null;
  while ((match = pattern.exec(text)) !== null) {
    matches.push(match[1].trim());
  }
  if (!matches.length) {
    throw new Error(`Tag <${tag}> not found in response.`);
  }
  return matches.join('\n\n');
};

const runOnce = async (index, systemPrompt, userPrompt, metadataLabel, { xmlTag = null, requiredRegex = null, maxAttempts = 1 } = {}) => {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let lastError = null;
  const attempts = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const responseText = await LLMClient.chatCompletion({
        messages,
        metadataLabel,
        validateXML: false,
        requiredRegex,
        output: 'stderr',
      });

      if (typeof responseText !== 'string' || responseText.trim() === '') {
        throw new Error(`Empty response received for run ${index}.`);
      }

      const outputText = xmlTag ? extractTagContent(responseText, xmlTag) : responseText;

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

      return outputText;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        throw error;
      }
    }
  }

  throw lastError || new Error(`Run ${index} failed after ${attempts} attempts.`);
};

const main = async () => {
  const [, , systemPath, promptPath, repeatRaw, xmlTagRaw, regexRaw] = process.argv;
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

  const systemPromptFile = readTextFile(systemPath, 'System prompt');
  const userPromptFile = readTextFile(promptPath, 'Prompt');
  const templateEnv = createTemplateEnv([
    path.dirname(systemPromptFile.resolved),
    path.dirname(userPromptFile.resolved),
    process.cwd(),
  ]);
  const templateContext = { config };
  const systemPrompt = renderTemplateString(templateEnv, systemPromptFile.content, systemPromptFile.resolved, templateContext);
  const userPrompt = renderTemplateString(templateEnv, userPromptFile.content, userPromptFile.resolved, templateContext);

  const xmlTag = typeof xmlTagRaw === 'string' && xmlTagRaw.trim() ? xmlTagRaw.trim() : null;
  if (xmlTag && !/^[A-Za-z0-9:_-]+$/.test(xmlTag)) {
    throw new Error(`Invalid xmlTag "${xmlTag}". Use only letters, numbers, :, _, or -.`);
  }

  const regexInput = typeof regexRaw === 'string' && regexRaw.trim() ? regexRaw.trim() : null;
  const requiredRegex = regexInput
    ? regexInput
    : (xmlTag
      ? new RegExp(`<${xmlTag}[^>]*>\\s*\\S[\\s\\S]*?<\\/${xmlTag}>`, 'i')
      : /\S/);

  const retryAttempts = Number.isInteger(config?.ai?.retryAttempts)
    ? Math.max(1, config.ai.retryAttempts)
    : 1;

  const metadataLabel = 'run_prompts';
  const startTime = process.hrtime.bigint();

  const tasks = Array.from({ length: repeatCount }, (_, index) =>
    runOnce(index + 1, systemPrompt, userPrompt, metadataLabel, { xmlTag, requiredRegex, maxAttempts: retryAttempts })
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
