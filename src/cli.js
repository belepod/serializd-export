#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { FIELDS, ALL_FLAGS, FIELDS_BY_FLAG } from './fields.js';
import { runExport, SUPPORTED_FORMATS } from './exporter.js';

dotenv.config();

const VERSION = '1.0.0';
const PROGRAM = 'serializd-export';

// Build the parseArgs options object from the field registry.
const options = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  username: { type: 'string', short: 'u' },
  email: { type: 'string' },
  password: { type: 'string' },
  format: { type: 'string', short: 'f', multiple: true },
  output: { type: 'string', short: 'o' },
  fields: { type: 'string' },
  all: { type: 'boolean' },
  preset: { type: 'string' },
  'no-shows': { type: 'boolean' },
  'no-diary': { type: 'boolean' },
  concurrency: { type: 'string' },
  quiet: { type: 'boolean', short: 'q' },
};
for (const f of FIELDS) {
  options[f.flag] = { type: 'boolean' };
}

const PRESETS = {
  minimal: ['name'],
  standard: ['name', 'url', 'date-added', 'rating', 'genres', 'status'],
  full: ALL_FLAGS,
};

function printHelp() {
  const fieldLines = FIELDS.map((f) => {
    const where = [];
    if (f.shows) where.push('shows');
    if (f.diary) where.push('diary');
    const enrich = f.needsEnrich ? ' [needs enrichment]' : '';
    return `      --${f.flag.padEnd(24)} ${where.join(', ').padEnd(13)}${enrich}`;
  }).join('\n');

  console.log(`${PROGRAM} v${VERSION}
Export your serializd.com watch history.

Usage:
  ${PROGRAM} [options]

Authentication (env or flags):
      --email <addr>            (env SERIALIZD_EMAIL)
      --password <pw>           (env SERIALIZD_PASSWORD)
  -u, --username <name>         (env SERIALIZD_USERNAME)

What to export:
      Pass any combination of field flags below.
      No field flags  =  only the show name.
      --all           =  every available field.
      --preset minimal|standard|full
      --fields a,b,c  =  comma-separated alternative

Output:
  -f, --format <fmt>            json, csv, md, txt — repeatable or comma-separated
                                (default: json,csv)
  -o, --output <dir>            Output directory (default: ./output)
      --no-shows                Skip the shows export
      --no-diary                Skip the diary export
      --concurrency <n>         Enrichment parallelism (default: 5)
  -q, --quiet                   Suppress progress logs

Misc:
  -h, --help                    Show this help
  -v, --version                 Show version

Available fields:
${fieldLines}

Presets:
      minimal     ${PRESETS.minimal.join(', ')}
      standard    ${PRESETS.standard.join(', ')}
      full        every field

Examples:
  ${PROGRAM}
  ${PROGRAM} --rating --genres --status
  ${PROGRAM} --all --format json,csv,md
  ${PROGRAM} --preset standard --format csv
  ${PROGRAM} --fields name,url,rating --no-diary
`);
}

function splitMulti(values) {
  // --format json --format csv  AND  --format json,csv  both work.
  const out = [];
  for (const v of values ?? []) {
    for (const part of String(v).split(',')) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function exitErr(msg, code = 2) {
  console.error(`${PROGRAM}: ${msg}`);
  console.error(`Run with --help for usage.`);
  process.exit(code);
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({ options, allowPositionals: false, strict: true });
  } catch (e) {
    exitErr(e.message);
  }
  const { values } = parsed;

  if (values.help) { printHelp(); return; }
  if (values.version) { console.log(VERSION); return; }

  const email = values.email ?? process.env.SERIALIZD_EMAIL;
  const password = values.password ?? process.env.SERIALIZD_PASSWORD;
  const username = values.username ?? process.env.SERIALIZD_USERNAME;
  if (!email || !password || !username) {
    exitErr('Missing credentials. Provide --email/--password/--username or set SERIALIZD_EMAIL / SERIALIZD_PASSWORD / SERIALIZD_USERNAME (.env supported).');
  }

  // Resolve fields: collect every truthy boolean field flag, plus --fields, plus --preset, plus --all.
  const flagSet = new Set();
  for (const f of FIELDS) {
    if (values[f.flag]) flagSet.add(f.flag);
  }
  if (values.fields) {
    for (const raw of String(values.fields).split(',')) {
      const t = raw.trim();
      if (!t) continue;
      if (!FIELDS_BY_FLAG.has(t)) exitErr(`Unknown field: "${t}". See --help for the list.`);
      flagSet.add(t);
    }
  }
  if (values.preset) {
    const p = String(values.preset).trim().toLowerCase();
    if (!PRESETS[p]) exitErr(`Unknown preset "${p}". Choices: ${Object.keys(PRESETS).join(', ')}.`);
    for (const f of PRESETS[p]) flagSet.add(f);
  }
  if (values.all) for (const f of ALL_FLAGS) flagSet.add(f);
  if (flagSet.size === 0) flagSet.add('name'); // no flags = name only

  // Formats: default json + csv. Can be comma-sep or repeated.
  let formats = splitMulti(values.format);
  if (formats.length === 0) formats = ['json', 'csv'];
  formats = [...new Set(formats.map((f) => f.toLowerCase()))];
  for (const f of formats) {
    if (!SUPPORTED_FORMATS.includes(f)) {
      exitErr(`Unknown format "${f}". Choices: ${SUPPORTED_FORMATS.join(', ')}.`);
    }
  }

  const outputDir = path.resolve(values.output ?? process.env.SERIALIZD_OUTPUT_DIR ?? 'output');
  const concurrency = Math.max(1, Math.min(20, parseInt(values.concurrency ?? '5', 10) || 5));
  const includeShows = !values['no-shows'];
  const includeDiary = !values['no-diary'];
  if (!includeShows && !includeDiary) {
    exitErr('Cannot pass both --no-shows and --no-diary.');
  }
  const logger = values.quiet ? () => {} : (msg) => console.log(msg);

  return runExport({
    email,
    password,
    username,
    fields: [...flagSet],
    formats,
    outputDir,
    includeShows,
    includeDiary,
    concurrency,
    logger,
  }).then(() => {
    logger('\nDone.');
  }).catch((e) => {
    console.error(`\n${PROGRAM}: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  });
}

main();
