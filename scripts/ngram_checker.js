#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Utils = require('../Utils.js');

const COMMON_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'done', 'for', 'from', 'had',
  'has', 'have', 'having', 'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'me', 'my', 'mine', 'no', 'not',
  'of', 'off', 'on', 'or', 'our', 'ours', 'out', 'she', 'should', 'so', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'then', 'these', 'they', 'this',
  'those', 'to', 'too', 'under', 'up', 'us', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
  'with', 'without', 'would', 'you', 'your', 'yours',
  "aren't", "can't", "couldn't", "didn't", "doesn't", "don't", "hadn't",
  "hasn't", "haven't", "he'd", "he'll", "he's", "i'd", "i'll", "i'm", "i've",
  "isn't", "it'd", "it'll", "it's", "let's", "mustn't", "shan't", "she'd",
  "she'll", "she's", "shouldn't", "that'd", "that'll", "that's", "there's",
  "they'd", "they'll", "they're", "they've", "we'd", "we'll", "we're", "we've",
  "weren't", "what's", "when's", "where's", "who's", "why's", "won't",
  "wouldn't", "you'd", "you'll", "you're", "you've"
]);

function normalizeTokens(text) {
  if (typeof text !== 'string') {
    throw new TypeError('normalizeTokens requires a string input.');
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/gi, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t && /[a-z0-9]/i.test(t))
    .filter(t => !COMMON_WORDS.has(t));
}

function readTextArg(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Text input is required and must be non-empty.');
  }
  return raw.trim();
}

function readFileArg(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('File path must be a non-empty string.');
  }
  const resolved = path.resolve(process.cwd(), rawPath.trim());
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const contents = fs.readFileSync(resolved, 'utf8');
  if (typeof contents !== 'string' || !contents.trim()) {
    throw new Error(`File is empty: ${resolved}`);
  }
  return contents.trim();
}

function parseArgs(argv) {
  const args = {
    textA: null,
    textB: null,
    fileA: null,
    fileB: null,
    minK: 3,
    showTokens: false,
    demo: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--a':
        args.textA = argv[i + 1];
        i += 1;
        break;
      case '--b':
        args.textB = argv[i + 1];
        i += 1;
        break;
      case '--file-a':
        args.fileA = argv[i + 1];
        i += 1;
        break;
      case '--file-b':
        args.fileB = argv[i + 1];
        i += 1;
        break;
      case '--min-k':
        args.minK = Number(argv[i + 1]);
        i += 1;
        break;
      case '--show-tokens':
        args.showTokens = true;
        break;
      case '--demo':
        args.demo = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.minK) || args.minK < 1) {
    throw new Error('minK must be a positive integer.');
  }

  return args;
}

function resolveInputs(args) {
  if (args.demo) {
    return {
      a: "She doesn't bounce—can't, with the new weight inside her—but her fingers press firm against his forearm, anchoring him.",
      b: "She doesn't bounce—can't, with the new weight settled inside her—but her grin stretches wide as she gestures at her own sternum."
    };
  }

  if ((args.textA && args.fileA) || (args.textB && args.fileB)) {
    throw new Error('Provide either --a or --file-a (and --b or --file-b), not both.');
  }

  let a = null;
  let b = null;

  if (args.fileA) {
    a = readFileArg(args.fileA);
  } else if (args.textA) {
    a = readTextArg(args.textA);
  }

  if (args.fileB) {
    b = readFileArg(args.fileB);
  } else if (args.textB) {
    b = readTextArg(args.textB);
  }

  if (!a || !b) {
    throw new Error('Both inputs are required. Use --a/--b or --file-a/--file-b.');
  }

  return { a, b };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { a, b } = resolveInputs(args);

  const overlaps = Utils.findKgramOverlaps(a, b, { minK: args.minK });
  const result = {
    minK: args.minK,
    overlapCount: Array.isArray(overlaps) ? overlaps.length : 0,
    overlaps: overlaps || []
  };

  console.log(JSON.stringify(result, null, 2));

  if (args.showTokens) {
    const tokensA = normalizeTokens(a);
    const tokensB = normalizeTokens(b);
    console.log('\nNormalized tokens A:', tokensA.join(' | '));
    console.log('Normalized tokens B:', tokensB.join(' | '));
  }
}

main();
