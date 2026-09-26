#!/usr/bin/env node
/**
 * THE P18-B DEPLOY SCRIPT (Work Order P18-B — the §4 deployment record):
 * deploys THIS LANE'S BRANCH HEAD to the sos-2-0 Vercel project through
 * the REAL API (gitSource bound to the exact 40-hex head sha — the P17-A
 * deployment journey protocol), polls to terminal readiness, and records
 * the deployment evidence (the P3 registrar shape).
 *
 * THE BUILD COMMAND (the honest integration disclosure): the frozen
 * project build command is
 *   'pnpm --filter @sos-2/web^... run build && pnpm run build'
 * (packages/deployment-providers VERCEL_CONNECTIVITY_BUILD_COMMAND — the
 * P17-A contract). The @sos-2/web dependency closure does NOT include
 * @sos-2/action-gateway / @sos-2/deployment-providers / @sos-2/real-bodies
 * (the packages the live action endpoint consumes through
 * apps/web/live-mission), and apps/web/package.json is OUTSIDE this
 * lane's owned surface. This deployment therefore uses the PER-DEPLOYMENT
 * projectSettings.buildCommand OVERRIDE — an EXTENSION of the frozen
 * pattern that additionally builds this lane's module closure:
 *   'pnpm --filter @sos-2/web^... run build && pnpm --filter
 *    @sos-2/web-live-mission^... run build && pnpm run build'
 * The PROJECT's build command is NOT modified (verified after the run);
 * folding the dependency into @sos-2/web's closure is the architect's
 * one-line integration decision (the proposed ACR in the lane README).
 *
 * Credentials: env-only (VERCEL_TOKEN, VERCEL_PROJECT_ID; the org id
 * discovered through the authenticated /v2/user probe when absent —
 * recorded). Evidence carries env NAMES only; transcripts carry method +
 * path + status — never bodies, never credentials.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const EVIDENCE_DIR = join(HERE, '..', '..', '..', '..', 'docs', 'evidence', 'production-connectivity', 'live-ux', 'actions-mission');

const VERCEL_TOKEN = process.env['VERCEL_TOKEN'] ?? '';
const VERCEL_PROJECT_ID = process.env['VERCEL_PROJECT_ID'] ?? '';
const DECLARED_ORG_ID = process.env['VERCEL_ORG_ID'] ?? '';

const LANE_BUILD_COMMAND =
  'pnpm --filter @sos-2/web^... run build && pnpm --filter @sos-2/web-live-mission^... run build && pnpm run build';

const API = 'https://api.vercel.com';
const transcript = [];

async function vercel(step, path, init) {
  const started = Date.now();
  const url = `${API}${path}`;
  const response = await fetch(url, init);
  const text = await response.text();
  transcript.push({ step, method: init?.method ?? 'GET', path, status: response.status, ms: Date.now() - started });
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

function authed(init = {}) {
  return { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${VERCEL_TOKEN}` } };
}

function requireEnv() {
  const missing = [];
  if (VERCEL_TOKEN.length === 0) missing.push('VERCEL_TOKEN');
  if (VERCEL_PROJECT_ID.length === 0) missing.push('VERCEL_PROJECT_ID');
  if (missing.length > 0) {
    console.error(`missing required env: ${missing.join(', ')} (names only — never values)`);
    process.exit(1);
  }
}

async function main() {
  requireEnv();
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  // 1. The org/team discovery (the authenticated /v2/user probe — P18-A precedent).
  const user = await vercel('user probe', '/v2/user', authed());
  if (user.status !== 200) throw new Error(`the /v2/user probe failed: ${String(user.status)} — ${user.text.slice(0, 200)}`);
  const userInfo = user.body?.user ?? {};
  const orgId = DECLARED_ORG_ID.length > 0 ? DECLARED_ORG_ID : userInfo.defaultTeamId ?? null;
  console.log(`org/team id: ${orgId ?? 'personal (no default team)'} (VERCEL_ORG_ID ${DECLARED_ORG_ID.length > 0 ? 'declared' : 'discovered via /v2/user'})`);
  const teamQuery = orgId !== null ? `&teamId=${orgId}` : '';

  // 2. The project read (name + the git repository link incl. repoId).
  const project = await vercel('project read', `/v9/projects/${VERCEL_PROJECT_ID}?${teamQuery.replace('&', '')}`, authed());
  if (project.status !== 200) throw new Error(`the project read failed: ${String(project.status)} — ${project.text.slice(0, 200)}`);
  const projectName = project.body?.name ?? '';
  const repoId = project.body?.link?.repoId ?? null;
  const gitOrg = project.body?.link?.org ?? '';
  const gitRepo = project.body?.link?.repo ?? '';
  if (typeof repoId !== 'number') throw new Error(`the project link carries no github repoId — cannot create a git-bound deployment`);

  // 3. THIS LANE'S BRANCH HEAD (the exact 40-hex sha the deployment binds to).
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) throw new Error(`git rev-parse HEAD failed: ${head.stderr}`);
  const headSha = head.stdout.trim();
  const shortHead = headSha.slice(0, 10);
  console.log(`deploying branch head ${shortHead} (repo ${gitOrg}/${gitRepo}, repoId ${String(repoId)}) to project ${projectName}`);

  // 4. The PREVIOUS production deployment (the rollback pointer — the P3 registrar shape).
  const previous = await vercel('previous production read', `/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=20&target=production${teamQuery}`, authed());
  const previousDeployments = previous.status === 200 ? previous.body?.deployments ?? [] : [];
  const previousProduction = previousDeployments[0] ?? null;
  console.log(`rollback pointer (previous production): ${previousProduction?.uid ?? 'none'} at ${previousProduction?.meta?.githubCommitSha?.slice(0, 10) ?? 'n/a'}`);

  // 5. Create the deployment (gitSource bound to the EXACT head sha; the per-deployment build command override).
  const created = await vercel('create deployment', `/v13/deployments?skipAutoDetectionConfirmation=1${teamQuery}`, authed({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      gitSource: { type: 'github', repoId, ref: headSha },
      target: 'production',
      projectSettings: { buildCommand: LANE_BUILD_COMMAND },
    }),
  }));
  if (created.status !== 200 && created.status !== 201) throw new Error(`the deployment creation failed: ${String(created.status)} — ${created.text.slice(0, 400)}`);
  const deploymentId = created.body?.uid ?? created.body?.id ?? '';
  let readyState = created.body?.readyState ?? '';
  console.log(`deployment created: ${deploymentId} (initial readyState ${readyState})`);

  // 6. Poll to terminal readiness (the honest states — READY/ERROR/CANCELED, never fabricated).
  const pollStarted = Date.now();
  const maxWaitMs = 15 * 60 * 1000;
  while (readyState !== 'READY' && readyState !== 'ERROR' && readyState !== 'CANCELED' && Date.now() - pollStarted < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const polled = await vercel('poll deployment', `/v13/deployments/${deploymentId}${teamQuery.replace('&', '&')}`, authed());
    if (polled.status === 200) {
      readyState = polled.body?.readyState ?? readyState;
      process.stdout.write(`  readyState: ${readyState} (${String(Math.round((Date.now() - pollStarted) / 1000))}s)\n`);
    }
  }
  const waitedMs = Date.now() - pollStarted;
  const finalRead = await vercel('final deployment read', `/v13/deployments/${deploymentId}${teamQuery.replace('&', '&')}`, authed());
  const finalBody = finalRead.status === 200 ? finalRead.body : {};
  const deploymentUrl = finalBody?.url ?? '';
  const observedSha = finalBody?.gitSource?.sha ?? finalBody?.meta?.githubCommitSha ?? null;

  // 7. The project's frozen build command is UNTOUCHED (verify honestly).
  const projectAfter = await vercel('project re-read', `/v9/projects/${VERCEL_PROJECT_ID}${teamQuery.replace('&', '?')}`, authed());
  const projectBuildCommand = projectAfter.status === 200 ? projectAfter.body?.buildCommand ?? null : null;

  const record = {
    schema: 'sos-2/p18b/vercel-deployment',
    work_order: 'P18-B',
    produced_at: new Date().toISOString(),
    evidence_kind: 'deployment-record',
    provider: 'vercel',
    provider_states: [
      {
        state: readyState === 'READY' ? 'CONNECTED' : 'UNAVAILABLE',
        provider_id: 'vercel',
        probed_at: new Date().toISOString(),
        credential_env: 'VERCEL_TOKEN',
        api_revision: 'vercel.v13',
        last_error: readyState === 'READY' ? null : `terminal readyState: ${readyState}`,
        probes: transcript.filter((entry) => entry.step === 'create deployment' || entry.step === 'final deployment read').map((entry) => ({ endpoint: `${entry.method} ${entry.path}`, status: entry.status })),
      },
    ],
    project: {
      name: projectName,
      git_repository: `${gitOrg}/${gitRepo}`,
      root_directory: projectAfter.body?.rootDirectory ?? 'apps/web',
      framework: projectAfter.body?.framework ?? 'nextjs',
    },
    build_command: {
      project_setting_unchanged: projectBuildCommand,
      project_setting_matches_frozen_contract: projectBuildCommand === 'pnpm --filter @sos-2/web^... run build && pnpm run build',
      per_deployment_override: LANE_BUILD_COMMAND,
      note: 'the per-deployment override extends the frozen closure pattern with this lane module closure (@sos-2/web-live-mission^...); the PROJECT setting is untouched (verified post-run) — folding the dependency into @sos-2/web is the architect one-liner (see the lane README ACR)',
    },
    deployment: {
      deployment_revision_id: deploymentId,
      url: deploymentUrl,
      ready_state: readyState,
      source_revision_sha: headSha,
      observed_commit_sha: observedSha,
      binding_verified: observedSha === headSha,
      waited_ms: waitedMs,
      target: 'production',
    },
    deployment_record: {
      record_id: `sos://Deployment/vercel-${deploymentId.replace('dpl_', '')}`,
      deployment_id: `vercel-production-${shortHead}`,
      environment: 'production',
      artifact_revision: { kind: 'git-sha', value: headSha },
      target_runtime: {
        runtime_id: `vercel:${VERCEL_PROJECT_ID}`,
        runtime_kind: 'vercel-serverless',
        runtime_version: '24.x',
      },
      configuration: {
        vercel_deployment_id: deploymentId,
        deployment_url: deploymentUrl,
        team_id: orgId,
        project_id: VERCEL_PROJECT_ID,
        project_name: projectName,
        target: 'production',
        git_repo_id: repoId,
        ready_state: readyState,
        commit_sha_bound: headSha,
        binding_verified: observedSha === headSha,
      },
      rollback: previousProduction !== null
        ? {
            mechanism: { kind: 'ROLLBACK_DEPLOYMENT', to_deployment_id: previousProduction.uid ?? null },
            trigger: { kind: 'MANUAL', authority_ref: null },
            note: `the previous production deployment ${previousProduction.uid} at ${previousProduction.meta?.githubCommitSha ?? 'unknown sha'} is the known-good rollback pointer (the P3 registrar shape)`,
          }
        : { mechanism: null, note: 'no previous production deployment observed' },
    },
    transcripts: transcript,
    credential_envs: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID'],
  };

  writeFileSync(join(EVIDENCE_DIR, 'vercel-deployment.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(EVIDENCE_DIR, 'vercel-org.json'), `${JSON.stringify({ schema: 'sos-2/p18b/vercel-org', discovered_at: new Date().toISOString(), org_id: orgId, via: DECLARED_ORG_ID.length > 0 ? 'declared env VERCEL_ORG_ID' : 'GET /v2/user defaultTeamId', username: userInfo.username ?? null }, null, 2)}\n`);
  console.log(`evidence written to ${EVIDENCE_DIR}`);
  console.log(`deployment: ${readyState} url=${deploymentUrl} sha=${headSha}`);
  if (readyState !== 'READY') {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
