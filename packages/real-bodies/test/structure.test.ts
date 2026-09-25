/**
 * The package-local structural suite of @sos-2/real-bodies (Work Order
 * P17-B): pins the lane's structural disciplines deterministically,
 * offline (the functional contract suites live in tests/real-bodies).
 *
 *   - ZERO external dependencies: workspace:* + the existing toolchain
 *     only.
 *   - No ambient environment access and no hidden clocks in src.
 *   - fetch appears ONLY in the documented network boundary
 *     (openrouter-client.ts) — the one place network happens.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const srcRoot = resolve(packageRoot, 'src');

function srcFiles(): string[] {
  return readdirSync(srcRoot).filter((file) => file.endsWith('.ts'));
}

describe('@sos-2/real-bodies structural discipline', () => {
  it('declares ZERO external runtime dependencies (workspace:* only)', () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      expect(spec).toBe('workspace:*');
      expect(name.startsWith('@sos-2/')).toBe(true);
    }
    const allowedToolchain = ['@types/node', 'typescript', 'vitest'];
    for (const name of Object.keys(manifest.devDependencies ?? {})) {
      expect(allowedToolchain.includes(name)).toBe(true);
    }
  });

  it('never reads the ambient environment and never hides a clock in src', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      expect(text.includes('process.env'), `${file} reads ambient state`).toBe(false);
      expect(text.includes('Date.now'), `${file} uses Date.now`).toBe(false);
      expect(text.includes('Math.random'), `${file} uses Math.random`).toBe(false);
    }
  });

  it('touches the network only in the documented boundary (openrouter-client.ts)', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(resolve(srcRoot, file), 'utf8');
      if (file === 'openrouter-client.ts') {
        expect(text.includes('fetchImpl')).toBe(true);
        continue;
      }
      expect(text.includes('fetch('), `${file} calls fetch outside the documented network boundary`).toBe(false);
      expect(text.includes('fetchImpl'), `${file} touches the fetch seam outside the documented boundary`).toBe(false);
    }
  });

  it('exports the hosted coding-harness body, the model seam and the provider bridge', async () => {
    const index = await import('../src/index.js');
    expect(typeof index.createHostedCodingBody).toBe('function');
    expect(typeof index.HostedCodingBody).toBe('function');
    expect(typeof index.OpenRouterModelClient).toBe('function');
    expect(typeof index.ScriptedHostedModelPort).toBe('function');
    expect(typeof index.parseWorkProgramOutput).toBe('function');
    expect(typeof index.RealGitHubRepositoryOperations).toBe('function');
    expect(index.HOSTED_CODING_BODY_DEFAULT_MODEL).toBe('qwen/qwen3-coder-flash');
    expect(index.OPENROUTER_ENVIRONMENT_VARIABLES.apiKey).toBe('OPENROUTER_API_KEY');
  });
});
