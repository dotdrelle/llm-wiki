#!/usr/bin/env node
/*
 * Evaluate workspace retrieval against facts/questions curated from each
 * workspace's own archived documents. The fixture is data, never product
 * vocabulary. This command is read-only and does not call a chat model.
 *
 * Usage:
 *   pnpm eval:retrieval eval-cases.json [--lexical-only] [--json]
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const fixturePath = args.find((value) => !value.startsWith('--'));
if (!fixturePath) {
  process.stderr.write('usage: eval:retrieval <cases.json> [--lexical-only] [--json]\n');
  process.exit(2);
}

const fixture = JSON.parse(await readFile(path.resolve(fixturePath), 'utf8'));
if (fixture?.schemaVersion !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  throw new Error('Evaluation fixture must use schemaVersion: 1 and contain a non-empty cases array.');
}

const { loadConfig } = await import('../src/config/loadConfig.ts');
const { RetrievalService } = await import('../src/services/retrievalService.ts');
const { WorkspaceService } = await import('../src/services/workspaceService.ts');
const lexicalOnly = args.includes('--lexical-only');
const limit = Number.isInteger(fixture.limit) && fixture.limit > 0 ? fixture.limit : 10;
const services = new Map();
const evaluated = [];

for (const [index, item] of fixture.cases.entries()) {
  if (!item || typeof item !== 'object' || typeof item.workspace !== 'string'
      || typeof item.query !== 'string' || !item.query.trim()
      || (item.language != null && (typeof item.language !== 'string' || !item.language.trim()))
      || (item.producerModel != null && (typeof item.producerModel !== 'string' || !item.producerModel.trim()))
      || (item.scenarioId != null && (typeof item.scenarioId !== 'string' || !item.scenarioId.trim()))
      || !Array.isArray(item.expected) || item.expected.length === 0
      || item.expected.some((target) => !target || typeof target.path !== 'string'
        || (target.quote != null && typeof target.quote !== 'string'))) {
    throw new Error(`Invalid evaluation case at cases[${index}]: expected workspace, query, and expected[{path, quote?}].`);
  }
  const root = path.resolve(item.workspace);
  let service = services.get(root);
  if (!service) {
    const savedWorkspace = process.env.WIKI_WORKSPACE;
    const savedWorkspacePath = process.env.WIKI_WORKSPACE_PATH;
    const savedConfigPath = process.env.WIKI_CONFIG_PATH;
    delete process.env.WIKI_WORKSPACE;
    delete process.env.WIKI_WORKSPACE_PATH;
    delete process.env.WIKI_CONFIG_PATH;
    let config;
    try {
      config = await loadConfig(root);
    } finally {
      if (savedWorkspace === undefined) delete process.env.WIKI_WORKSPACE;
      else process.env.WIKI_WORKSPACE = savedWorkspace;
      if (savedWorkspacePath === undefined) delete process.env.WIKI_WORKSPACE_PATH;
      else process.env.WIKI_WORKSPACE_PATH = savedWorkspacePath;
      if (savedConfigPath === undefined) delete process.env.WIKI_CONFIG_PATH;
      else process.env.WIKI_CONFIG_PATH = savedConfigPath;
    }
    if (lexicalOnly) config.retrieval.vector.enabled = false;
    service = new RetrievalService(new WorkspaceService(config), config);
    services.set(root, service);
  }
  const results = await service.search(item.query, { includeRaw: true, limit });
  const retrieval = service.getLastSearchDiagnostics();
  const expectedByPath = new Map(item.expected.map((target) => [target.path.replace(/^\.\//, ''), target]));
  const ranks = [];
  const quoteHits = [];
  results.forEach((result, resultIndex) => {
    const target = expectedByPath.get(result.page.relativePath);
    if (!target) return;
    ranks.push(resultIndex + 1);
    if (!target.quote || resultText(result).toLowerCase().includes(target.quote.toLowerCase())) {
      quoteHits.push(result.page.relativePath);
    }
  });
  evaluated.push({
    id: item.id ?? `case-${index + 1}`,
    workspace: root,
    language: item.language?.trim() ?? null,
    producerModel: item.producerModel?.trim() ?? null,
    scenarioId: item.scenarioId?.trim() ?? null,
    query: item.query,
    hit: ranks.length > 0,
    reciprocalRank: ranks.length ? 1 / Math.min(...ranks) : 0,
    expectedFound: ranks.length,
    expectedTotal: item.expected.length,
    quoteHits,
    retrieval,
    results: results.map((result, resultIndex) => ({
      rank: resultIndex + 1,
      path: result.page.relativePath,
      score: result.score,
      heading: result.chunk?.headingPath,
      excerpt: result.chunk?.content?.slice(0, 400),
    })),
  });
}

const groups = new Map();
for (const result of evaluated) {
  const group = groups.get(result.workspace) ?? [];
  group.push(result);
  groups.set(result.workspace, group);
}
const languageGroups = new Map();
for (const result of evaluated) {
  const language = result.language ?? '(unspecified)';
  const group = languageGroups.get(language) ?? [];
  group.push(result);
  languageGroups.set(language, group);
}
const modelGroups = new Map();
for (const result of evaluated) {
  const model = result.producerModel ?? '(unspecified)';
  const group = modelGroups.get(model) ?? [];
  group.push(result);
  modelGroups.set(model, group);
}
const scenarios = new Map();
evaluated.forEach((result, index) => {
  if (!result.producerModel) return;
  const expected = fixture.cases[index].expected
    .map((target) => ({
      path: target.path.replace(/^\.\//, ''),
      quote: target.quote ?? null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || String(a.quote).localeCompare(String(b.quote)));
  const signature = JSON.stringify({ language: result.language, query: result.query, expected });
  const scenarioKey = `${result.scenarioId ?? ''}\u0000${signature}`;
  const byModel = scenarios.get(scenarioKey) ?? new Map();
  const modelCases = byModel.get(result.producerModel) ?? [];
  modelCases.push(result);
  byModel.set(result.producerModel, modelCases);
  scenarios.set(scenarioKey, byModel);
});
const matchedScenarios = [...scenarios.entries()]
  .filter(([, byModel]) => byModel.size > 1)
  .map(([scenarioKey, byModel]) => {
    const [scenarioLabel, signature] = scenarioKey.split('\u0000');
    const models = [...byModel.entries()].map(([producerModel, cases]) => ({
      producerModel,
      ...summarize(cases),
      caseIds: cases.map((item) => item.id),
    }));
    return {
      scenario: scenarioLabel
        ? `id:${scenarioLabel}`
        : `auto:${createHash('sha256').update(signature).digest('hex').slice(0, 12)}`,
      query: byModel.values().next().value?.[0]?.query,
      language: byModel.values().next().value?.[0]?.language,
      models,
    };
  });
const report = {
  schemaVersion: 1,
  mode: lexicalOnly ? 'lexical' : 'configured',
  retrievalModes: [...new Set(evaluated.map((item) => item.retrieval.mode))].sort(),
  limit,
  summary: summarize(evaluated),
  workspaces: [...groups].map(([workspace, cases]) => ({ workspace, ...summarize(cases), cases })),
  languages: [...languageGroups].map(([language, cases]) => ({
    language, ...summarize(cases), caseIds: cases.map((item) => item.id),
  })),
  producerModels: [...modelGroups].map(([producerModel, cases]) => ({
    producerModel, ...summarize(cases), caseIds: cases.map((item) => item.id),
  })),
  matchedScenarios,
};
if (args.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`Retrieval evaluation (${report.mode}, top ${limit})\n`);
  process.stdout.write(`Effective search paths: ${report.retrievalModes.join(', ')}\n`);
  process.stdout.write(`Overall: ${report.summary.hitRate.toFixed(3)} hit rate; MRR ${report.summary.mrr.toFixed(3)}; ${report.summary.quoteHitRate.toFixed(3)} quote hit rate (${report.summary.cases} cases)\n`);
  for (const group of report.workspaces) {
    process.stdout.write(`\n${group.workspace}\n  hit ${group.hitRate.toFixed(3)} · MRR ${group.mrr.toFixed(3)} · quote ${group.quoteHitRate.toFixed(3)} (${group.cases.length} cases)\n`);
    for (const result of group.cases) {
      const fallback = result.retrieval.reason ? `; ${result.retrieval.reason}` : '';
      process.stdout.write(`  ${result.hit ? 'PASS' : 'MISS'} ${result.id}: ${result.results[0]?.path ?? '(no result)'} (${result.retrieval.mode}${fallback})\n`);
    }
  }
  if ([...languageGroups.keys()].some((language) => language !== '(unspecified)')) {
    process.stdout.write('\nBy query language\n');
    for (const group of report.languages) {
      process.stdout.write(`  ${group.language}: hit ${group.hitRate.toFixed(3)} · MRR ${group.mrr.toFixed(3)} · quote ${group.quoteHitRate.toFixed(3)} (${group.cases} cases)\n`);
    }
  }
  if ([...modelGroups.keys()].some((model) => model !== '(unspecified)')) {
    process.stdout.write('\nBy producer model\n');
    for (const group of report.producerModels) {
      process.stdout.write(`  ${group.producerModel}: hit ${group.hitRate.toFixed(3)} · MRR ${group.mrr.toFixed(3)} · quote ${group.quoteHitRate.toFixed(3)} (${group.cases} cases)\n`);
    }
  }
  if (report.matchedScenarios.length) {
    process.stdout.write('\nPaired model scenarios (identical query and expected evidence)\n');
    for (const scenario of report.matchedScenarios) {
      process.stdout.write(`  ${scenario.scenario}: ${scenario.query}\n`);
      for (const model of scenario.models) {
        process.stdout.write(`    ${model.producerModel}: hit ${model.hitRate.toFixed(3)} · MRR ${model.mrr.toFixed(3)} · quote ${model.quoteHitRate.toFixed(3)} (${model.cases} cases)\n`);
      }
    }
  }
}
if (!args.includes('--allow-misses') && evaluated.some((item) => !item.hit || item.quoteHits.length === 0)) {
  process.exitCode = 1;
}

function summarize(cases) {
  const count = cases.length;
  return {
    cases: count,
    hitRate: count ? cases.filter((item) => item.hit).length / count : 0,
    mrr: count ? cases.reduce((sum, item) => sum + item.reciprocalRank, 0) / count : 0,
    quoteHitRate: count ? cases.filter((item) => item.quoteHits.length > 0).length / count : 0,
  };
}

function resultText(result) {
  return `${result.page.title ?? ''}\n${result.chunk?.content ?? result.page.content ?? ''}`;
}
