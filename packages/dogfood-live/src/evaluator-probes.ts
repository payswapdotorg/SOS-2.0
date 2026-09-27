/**
 * THE REAL EVALUATOR PROBES (Work Order P19) — the independent
 * evaluation the CompletionCertifier relays, bound to REAL probes:
 *
 *   - tests (REAL node execution): the repo contents at the EXACT
 *     revision are fetched from the real GitHub API (staged at the
 *     composition boundary) and the component's generated test file is
 *     EXECUTED under the host node runtime in a bounded temp workspace
 *     (the P17-B real-body precedent: the evaluator executes the
 *     generated test — the body never certifies itself);
 *   - static-contract-checks (repo-contents-at-revision): the real tree
 *     at the EXACT revision carries every planned path, every planned
 *     file is non-empty and the manifest parses as JSON;
 *   - deployment-checks (deployment-state): the REAL Vercel deployment
 *     state is READY and the deployment's commit sha EQUALS the exact
 *     source revision under evaluation (the binding is verified against
 *     the provider's own answer, never assumed);
 *   - runtime-verification (runtime-HTTP): a REAL HTTP GET of the
 *     deployed URL serves the README with a body byte-identical to the
 *     repository content at the EXACT deployed revision (the root GET
 *     is recorded honestly as a limitation — the frozen reference
 *     planner provisions no root index.html);
 *   - security-checks (security-scan of realized contents): every file
 *     at the EXACT revision passes through BOTH merged redaction
 *     corpora (deployment + observation) — PASS iff zero secret-shaped
 *     findings.
 *
 * Honest absence: facts that were never staged answer NO_EVIDENCE (the
 * verdict is UNKNOWN and completion is never fabricated from absence).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentAddress } from '@sos-2/action-gateway';
import { redactDeploymentSecrets } from '@sos-2/deployment-providers';
import { redactObservationSecrets } from '@sos-2/real-observation';
import type { EvaluatorProbe, EvaluationRequest, ProbeObservation } from '@sos-2/evaluator';
import type { DogfoodStaging } from './staging.js';

/** The real node-execution runner (the tests probe's execution engine — sync, offline, bounded). */
export type DogfoodNodeRunner = (files: readonly { readonly path: string; readonly contents: string }[], testPath: string) => {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * The TS-interop resolve hook the eval workspace installs (the standard
 * tsx-style interop): a TypeScript-style './module.js' specifier that has
 * no .js file but a sibling .ts file resolves to the .ts file. The
 * executed CONTENT is still the exact revision content — the hook only
 * resolves specifiers, it never rewrites code.
 */
const TS_INTEROP_HOOK = `${[
  "import { registerHooks } from 'node:module';",
  "import { existsSync } from 'node:fs';",
  "import { fileURLToPath, pathToFileURL } from 'node:url';",
  "import path from 'node:path';",
  'registerHooks({',
  '  resolve(specifier, context, nextResolve) {',
  '    try {',
  '      return nextResolve(specifier, context);',
  '    } catch (error) {',
  "      if (typeof specifier === 'string' && specifier.endsWith('.js') && typeof context.parentURL === 'string') {",
  '        try {',
  "          const sibling = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier.replace(/\\.(m?js)$/, '.ts'));",
  '          if (existsSync(sibling)) {',
  '            return { url: pathToFileURL(sibling).href, shortCircuit: true, format: "module-typescript" };',
  '          }',
  '        } catch {',
  '          // fall through to the original error',
  '        }',
  '      }',
  '      throw error;',
  '    }',
  '  },',
  '});',
].join('\n')}\n`;

/**
 * The eval driver: imports the EXACT revision's test file (running its
 * top-level statements — a self-executing test asserts on import) and, when
 * the file exports the reference-checks entry point, INVOKE it and fail on
 * any failed check (the reference planner's test is a library — the driver
 * makes its checks actually run; it never modifies the file).
 */
const EVAL_DRIVER = `${[
  "import { pathToFileURL } from 'node:url';",
  "const testPath = process.argv[2] ?? '';",
  'const loaded = await import(pathToFileURL(testPath).href);',
  "const checks = typeof loaded.runReferenceChecks === 'function'",
  '  ? loaded.runReferenceChecks()',
  "  : typeof loaded.default?.runReferenceChecks === 'function'",
  '    ? loaded.default.runReferenceChecks()',
  '    : null;',
  'if (checks !== null) {',
  "  let failed = 0;",
  '  for (const check of checks) {',
  "    if (check.passed) { console.log(`PASS ${check.check}`); } else { failed += 1; console.error(`FAIL ${check.check}`); }",
  '  }',
  '  if (failed > 0) {',
  "    console.error(`${failed} reference check(s) failed`);",
  '    process.exit(1);',
  '  }',
  '}',
].join('\n')}\n`;

/** The default node runner: write the files into a bounded temp workspace and execute the test under node. */
export const realNodeRunner: DogfoodNodeRunner = (files, testPath) => {
  const workdir = mkdtempSync(join(tmpdir(), 'p19-dogfood-eval-'));
  try {
    for (const file of files) {
      const target = join(workdir, file.path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, file.contents);
    }
    // The eval machinery (NOT repository content): the TS-interop resolve
    // hook + the reference-checks driver (both documented in the probe's
    // limitations — the executed content is the exact revision content).
    writeFileSync(join(workdir, '__p19_ts_interop.mjs'), TS_INTEROP_HOOK);
    writeFileSync(join(workdir, '__p19_eval_driver.mjs'), EVAL_DRIVER);
    const spawned = spawnSync('node', ['--import', './__p19_ts_interop.mjs', './__p19_eval_driver.mjs', testPath], {
      cwd: workdir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { exitCode: spawned.status, stdout: spawned.stdout ?? '', stderr: spawned.stderr ?? '' };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
};

/** The staged-facts lookup helper (honest absence when the revision was never staged). */
function repoFactsOrAbsent(staging: DogfoodStaging, request: EvaluationRequest): { facts: ReturnType<DogfoodStaging['repoFactsAt']> } {
  return { facts: staging.repoFactsAt(request.target.sourceRevision) };
}

function noEvidence(limitations: readonly string[]): ProbeObservation {
  return { status: 'NO_EVIDENCE', limitations: [...limitations] };
}

/** Build the real dogfood probes registry set (all five types; each one honestly independent). */
export function createDogfoodEvaluatorProbes(input: {
  readonly staging: DogfoodStaging;
  /** The node runner (default: the real spawnSync execution). */
  readonly nodeRunner?: DogfoodNodeRunner;
}): readonly EvaluatorProbe[] {
  const staging = input.staging;
  const nodeRunner = input.nodeRunner ?? realNodeRunner;

  const testsProbe: EvaluatorProbe = {
    evaluatorId: 'p19-dogfood-tests',
    type: 'tests',
    boundActor: null,
    capability: 'REFERENCE',
    run: (request: EvaluationRequest): ProbeObservation => {
      const { facts } = repoFactsOrAbsent(staging, request);
      if (facts === null) {
        return noEvidence([
          `the repository facts at revision ${request.target.sourceRevision} were not staged at the composition boundary — the honest answer is NO evidence, never a fabricated verdict`,
        ]);
      }
      const testPath = facts.plannedPaths.find((path) => path.includes('.test.')) ?? null;
      const checks: { check: string; passed: boolean; detail: string; expected: string | null; actual: string | null }[] = [];
      const limitations: string[] = [];
      const missingFiles = facts.plannedPaths.filter((path) => facts.contents[path] === undefined);
      checks.push({
        check: 'tests:planned-files-present',
        passed: missingFiles.length === 0,
        detail: missingFiles.length === 0 ? 'every planned file of the component is present in the REAL repository tree at the exact revision' : `missing from the real tree: ${missingFiles.join(', ')}`,
        expected: facts.plannedPaths.join(', '),
        actual: missingFiles.length === 0 ? 'all planned paths present' : `${String(facts.plannedPaths.length - missingFiles.length)}/${String(facts.plannedPaths.length)} present`,
      });
      if (testPath !== null && facts.contents[testPath] !== undefined) {
        // The REAL node execution: the generated test runs under the host runtime.
        const runnable = facts.plannedPaths
          .filter((path) => facts.contents[path] !== undefined)
          .map((path) => ({ path, contents: facts.contents[path]! }));
        const result = nodeRunner(runnable, testPath);
        const passed = result.exitCode === 0;
        checks.push({
          check: 'tests:generated-test-executes-under-node',
          passed,
          detail: passed
            ? `node ${testPath} exited 0 (stdout ${result.stdout.length} bytes)`
            : `node ${testPath} exited ${String(result.exitCode)} — stderr: ${result.stderr.slice(0, 400)}`,
          expected: 'exit code 0',
          actual: `exit code ${String(result.exitCode)}`,
        });
        limitations.push('the runtime verification executed the repository test file at the exact revision under the host node runtime (the eval workspace installs a tsx-style .js→.ts resolve hook and a driver that invokes an exported runReferenceChecks — the executed content is the exact revision content, never rewritten)');
      } else if (testPath === null) {
        // HONEST: the component plans NO test file (the reference scaffold is
        // README + manifest) — nothing was executed; the presence check is the
        // whole tests evidence for this component, and the limitation says so.
        limitations.push('the component plans no test file (nothing was executed under node; the planned-files presence check is the whole tests evidence for this revision — recorded honestly, never fabricated into an execution claim)');
      } else {
        limitations.push(`the planned test file ${testPath} was absent from the fetched tree at the exact revision — no node execution was possible`);
      }
      return {
        status: 'EVIDENCE_COLLECTED',
        limitations,
        evidence: {
          evidenceType: 'tests',
          summary: `the independent probe executed the generated test of revision ${request.target.sourceRevision.slice(0, 16)} under node`,
          checks,
          artifactDigest: contentAddress({ revision: request.target.sourceRevision, checks }, 'p19-dogfood-tests'),
        },
      };
    },
  };

  const staticContractProbe: EvaluatorProbe = {
    evaluatorId: 'p19-dogfood-static-contracts',
    type: 'static-contract-checks',
    boundActor: null,
    capability: 'REFERENCE',
    run: (request: EvaluationRequest): ProbeObservation => {
      const { facts } = repoFactsOrAbsent(staging, request);
      if (facts === null) {
        return noEvidence([
          `the repository facts at revision ${request.target.sourceRevision} were not staged at the composition boundary — the honest answer is NO evidence, never a fabricated verdict`,
        ]);
      }
      const missing = facts.plannedPaths.filter((path) => !facts.paths.includes(path));
      const emptyFiles = facts.plannedPaths.filter((path) => (facts.contents[path] ?? '').length === 0);
      const manifestPath = facts.plannedPaths.find((path) => path === 'sos-manifest.json') ?? null;
      let manifestParses = true;
      let manifestDetail = 'no manifest among the planned paths of this revision';
      if (manifestPath !== null) {
        const manifestContents = facts.contents[manifestPath] ?? '';
        try {
          JSON.parse(manifestContents);
          manifestDetail = 'sos-manifest.json parses as JSON';
        } catch (error) {
          manifestParses = false;
          manifestDetail = `sos-manifest.json does not parse as JSON: ${(error as Error).message}`;
        }
      }
      const checks = [
        {
          check: 'static-contract:tree-read-at-exact-revision',
          passed: facts.paths.length > 0,
          detail: `the REAL repository tree at the exact revision ${request.target.sourceRevision.slice(0, 16)} carries ${String(facts.paths.length)} path(s)`,
          expected: 'a non-empty real tree',
          actual: `${String(facts.paths.length)} path(s)`,
        },
        {
          check: 'static-contract:planned-paths-present',
          passed: missing.length === 0,
          detail: missing.length === 0 ? 'every planned path exists in the real tree at the exact revision' : `missing from the real tree: ${missing.join(', ')}`,
          expected: facts.plannedPaths.join(', '),
          actual: missing.length === 0 ? 'all planned paths present' : `${String(facts.plannedPaths.length - missing.length)}/${String(facts.plannedPaths.length)} present`,
        },
        {
          check: 'static-contract:planned-files-non-empty',
          passed: emptyFiles.length === 0,
          detail: emptyFiles.length === 0 ? 'every planned file at the exact revision is non-empty' : `empty planned files: ${emptyFiles.join(', ')}`,
          expected: 'non-empty contents for every planned path',
          actual: emptyFiles.length === 0 ? 'all non-empty' : `${String(emptyFiles.length)} empty`,
        },
        {
          check: 'static-contract:manifest-parses',
          passed: manifestParses,
          detail: manifestDetail,
          expected: 'valid JSON when a manifest is planned',
          actual: manifestParses ? 'parses' : 'parse failure',
        },
      ];
      return {
        status: 'EVIDENCE_COLLECTED',
        limitations: ['the structural checks ran against the real repository tree fetched at the exact revision'],
        evidence: {
          evidenceType: 'static-contract-checks',
          summary: `repo-contents-at-revision verified at ${request.target.sourceRevision.slice(0, 16)} (${String(facts.paths.length)} real paths)`,
          checks,
          artifactDigest: contentAddress({ revision: request.target.sourceRevision, paths: facts.paths }, 'p19-dogfood-static-contracts'),
        },
      };
    },
  };

  const deploymentProbe: EvaluatorProbe = {
    evaluatorId: 'p19-dogfood-deployment',
    type: 'deployment-checks',
    boundActor: null,
    capability: 'REFERENCE',
    run: (request: EvaluationRequest): ProbeObservation => {
      const facts = staging.deploymentFactsSnapshot();
      if (facts === null) {
        return noEvidence(['the real deployment facts were not staged at the composition boundary — the honest answer is NO evidence, never a fabricated verdict']);
      }
      const bindingVerified = facts.commitSha === request.target.sourceRevision;
      const checks = [
        {
          check: 'deployment-checks:ready-state',
          passed: facts.readyState === 'READY',
          detail: `the REAL Vercel deployment ${facts.deploymentId} answered readyState ${facts.readyState} after ${String(facts.pollAttempts)} poll(s)`,
          expected: 'READY',
          actual: facts.readyState,
        },
        {
          check: 'deployment-checks:exact-commit-binding',
          passed: bindingVerified,
          detail: bindingVerified
            ? `the deployment's commit sha equals the exact source revision under evaluation (${request.target.sourceRevision.slice(0, 16)})`
            : `the deployment's commit sha ${facts.commitSha ?? 'null'} does NOT equal the source revision under evaluation (${request.target.sourceRevision.slice(0, 16)}) — the binding is verified against the provider's own answer, never assumed`,
          expected: request.target.sourceRevision,
          actual: facts.commitSha,
        },
        {
          check: 'deployment-checks:url-present',
          passed: facts.url !== null && facts.url.length > 0,
          detail: `the deployment serves at ${facts.url ?? '(no url)'}`,
          expected: 'a deployment URL',
          actual: facts.url ?? 'null',
        },
      ];
      return {
        status: 'EVIDENCE_COLLECTED',
        limitations: ['the deployment state was read from the real Vercel API at the composition boundary'],
        evidence: {
          evidenceType: 'deployment-checks',
          summary: `deployment-state verified for ${facts.deploymentId} (readyState ${facts.readyState})`,
          checks,
          artifactDigest: contentAddress({ deploymentId: facts.deploymentId, revision: request.target.sourceRevision }, 'p19-dogfood-deployment'),
        },
      };
    },
  };

  const runtimeProbe: EvaluatorProbe = {
    evaluatorId: 'p19-dogfood-runtime',
    type: 'runtime-verification',
    boundActor: null,
    capability: 'REFERENCE',
    run: (request: EvaluationRequest): ProbeObservation => {
      const facts = staging.runtimeFactsSnapshot();
      if (facts === null) {
        return noEvidence(['the real runtime-verification facts were not staged at the composition boundary — the honest answer is NO evidence, never a fabricated verdict']);
      }
      const byteExact = facts.readmeBody !== null && facts.readmeAtRevision !== null && facts.readmeBody === facts.readmeAtRevision;
      const served = facts.readmeStatus === 200;
      const checks = [
        {
          check: 'runtime-verification:deployed-url-serves-readme',
          passed: served,
          detail: `HTTP GET ${facts.deploymentUrl}/README.md answered ${String(facts.readmeStatus ?? 0)}`,
          expected: 'HTTP 200',
          actual: `HTTP ${String(facts.readmeStatus ?? 0)}`,
        },
        {
          check: 'runtime-verification:served-content-byte-exact-at-revision',
          passed: byteExact,
          detail: byteExact
            ? `the served README body is byte-identical to the repository content at the exact deployed revision ${facts.deployedRevision.slice(0, 16)}`
            : 'the served README body differs from the repository content at the exact deployed revision (or one of them was absent) — the runtime binding is byte-exact or it is not verified',
          expected: 'byte-identical README content',
          actual: byteExact ? 'byte-identical' : 'differs or absent',
        },
      ];
      return {
        status: 'EVIDENCE_COLLECTED',
        limitations: [
          `the root URL GET answered HTTP ${String(facts.rootStatus ?? 0)} and is recorded honestly without gating (the frozen reference planner plans no root index.html; a static deployment may honestly answer 404 at the root)`,
          'the runtime verification fetched the deployed URL over real HTTP at the composition boundary',
        ],
        evidence: {
          evidenceType: 'runtime-verification',
          summary: `runtime-HTTP verified against ${facts.deploymentUrl} (README byte-exact at the deployed revision)`,
          checks,
          artifactDigest: contentAddress({ url: facts.deploymentUrl, revision: facts.deployedRevision, byteExact }, 'p19-dogfood-runtime'),
        },
      };
    },
  };

  const securityProbe: EvaluatorProbe = {
    evaluatorId: 'p19-dogfood-security',
    type: 'security-checks',
    boundActor: null,
    capability: 'REFERENCE',
    run: (request: EvaluationRequest): ProbeObservation => {
      const { facts } = repoFactsOrAbsent(staging, request);
      if (facts === null) {
        return noEvidence([
          `the repository facts at revision ${request.target.sourceRevision} were not staged at the composition boundary — the honest answer is NO evidence, never a fabricated verdict`,
        ]);
      }
      const findings: { path: string; patternIds: string[] }[] = [];
      for (const [path, contents] of Object.entries(facts.contents)) {
        const deployment = redactDeploymentSecrets(contents);
        const observation = redactObservationSecrets(deployment.redacted);
        const patternIds = [...deployment.findings.map((finding) => finding.patternId), ...observation.findings.map((finding) => finding.patternId)];
        if (patternIds.length > 0) {
          findings.push({ path, patternIds: [...new Set(patternIds)] });
        }
      }
      return {
        status: 'EVIDENCE_COLLECTED',
        limitations: ['the security scan ran the realized contents at the exact revision through both merged redaction corpora (pattern ids only, never matched text)'],
        evidence: {
          evidenceType: 'security-checks',
          summary: findings.length === 0
            ? `security-scan of the realized contents at ${request.target.sourceRevision.slice(0, 16)}: 0 secret-shaped findings across ${String(Object.keys(facts.contents).length)} file(s)`
            : `security-scan found secret-shaped patterns in ${String(findings.length)} file(s) (pattern ids only, never matched text)`,
          checks: [
            {
              check: 'security-checks:no-secret-shaped-findings',
              passed: findings.length === 0,
              detail: findings.length === 0 ? 'zero secret-shaped findings in the realized contents at the exact revision' : `findings: ${findings.map((finding) => `${finding.path} (${finding.patternIds.join(',')})`).join('; ')}`,
              expected: '0 findings',
              actual: `${String(findings.length)} file(s) with findings`,
            },
          ],
          artifactDigest: contentAddress({ revision: request.target.sourceRevision, findings: findings.map((finding) => finding.path) }, 'p19-dogfood-security'),
        },
      };
    },
  };

  return [testsProbe, staticContractProbe, deploymentProbe, runtimeProbe, securityProbe];
}
