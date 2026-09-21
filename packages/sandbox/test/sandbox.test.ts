/**
 * Deterministic sandbox contract tests (Work Order P8): the bounded
 * environment and every typed boundary violation — filesystem
 * out-of-scope, denied egress, budget overruns, unavailable credentials,
 * ended sandboxes — plus the secrets-never-echoed discipline.
 */

import { describe, expect, it } from 'vitest';
import { createLocalSandbox } from '../src/local-sandbox.js';
import { renderSandboxDenial } from '../src/denials.js';
import type { SandboxPolicy } from '../src/policy.js';
import { assertValidSandboxPolicy } from '../src/policy.js';
import { SANDBOX_BUDGET_COUNTERS } from '../src/policy.js';

const BASE_POLICY: SandboxPolicy = {
  filesystem: { mode: 'workspace', root: '/workspace/reference' },
  network: { egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] },
  secrets: ['github-token'],
  budgets: { fileWrites: 3, fileBytes: 100, shellCommands: 2, networkCalls: 2, secretReveals: 1 },
  resourceEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 512 },
};

const SECRET_VALUE = 'super-secret-token-value-never-to-echo';

function sandboxWith(overrides: Partial<SandboxPolicy> = {}) {
  const policy: SandboxPolicy = { ...BASE_POLICY, ...overrides };
  return { policy, sandbox: createLocalSandbox({ policy, secrets: { 'github-token': SECRET_VALUE } }) };
}

describe('sandbox: the bounded-environment contract', () => {
  it('describes itself through the P5 bounded-environment vocabulary (NAMES only)', () => {
    const { sandbox } = sandboxWith();
    const description = sandbox.describe();
    expect(description.filesystem).toEqual({ mode: 'workspace', root: '/workspace/reference' });
    expect(description.network).toEqual({ egress: 'allowlist', allowedHosts: ['api.github.com', 'registry.npmjs.org'] });
    expect(description.isolation).toBe('process');
    expect(description.limits).toEqual({ maxDurationMs: 3_600_000, maxMemoryMb: 512 });
    expect(description.environmentVariables).toEqual(['github-token']);
    // The description never carries the secret VALUE.
    expect(JSON.stringify(description)).not.toContain(SECRET_VALUE);
  });

  it('writes and reads workspace files within the scope', () => {
    const { sandbox } = sandboxWith();
    const write = sandbox.filesystem.write('src/main.ts', 'export {};\n');
    expect(write.status).toBe('OK');
    expect(write.status === 'OK' && write.value.bytes).toBe(11);
    const read = sandbox.filesystem.read('src/main.ts');
    expect(read.status === 'OK' && read.value.content).toBe('export {};\n');
    const list = sandbox.filesystem.list();
    expect(list.status === 'OK' && list.value.paths).toEqual(['src/main.ts']);
  });
});

describe('sandbox: filesystem boundary violations are typed denials', () => {
  it('denies absolute paths and traversal escapes with SANDBOX_FILESYSTEM_OUT_OF_SCOPE', () => {
    const { sandbox } = sandboxWith();
    sandbox.filesystem.write('notes.txt', 'x');
    for (const escape of ['/etc/passwd', '../../etc/passwd', 'a/../..', '.', 'src/../../escape']) {
      const denied = sandbox.filesystem.read(escape);
      expect(denied.status).toBe('DENIED');
      if (denied.status === 'DENIED') {
        expect(denied.denial.code).toBe('SANDBOX_FILESYSTEM_OUT_OF_SCOPE');
      }
    }
  });

  it('denies every filesystem access when the scope is "none" (the honest declaration)', () => {
    const { sandbox } = sandboxWith({
      filesystem: { mode: 'none', root: null },
      budgets: { fileWrites: null, fileBytes: null, shellCommands: null, networkCalls: null, secretReveals: null },
    });
    const denied = sandbox.filesystem.write('any.txt', 'x');
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_FILESYSTEM_OUT_OF_SCOPE');
      expect(denied.denial.reason).toContain('none');
    }
  });

  it('denies reads of absent files truthfully', () => {
    const { sandbox } = sandboxWith();
    const denied = sandbox.filesystem.read('missing.txt');
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_FILESYSTEM_OUT_OF_SCOPE');
    }
  });
});

describe('sandbox: network boundary violations are typed denials', () => {
  it('denies a network call to a host outside the allowlist', () => {
    const { sandbox } = sandboxWith();
    const denied = sandbox.network.netCall('evil.example.net', '/exfiltrate', null);
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_NETWORK_EGRESS_DENIED');
      expect(denied.denial.subject).toBe('evil.example.net');
      expect(denied.denial.reason).toContain('allowlist');
    }
  });

  it('authorizes an allowed host as a typed exchange record (never real egress)', () => {
    const { sandbox } = sandboxWith();
    const ok = sandbox.network.netCall('api.github.com', '/repos/acme/legacy-checkout', 'github-token');
    expect(ok.status).toBe('OK');
    if (ok.status === 'OK') {
      expect(ok.value.host).toBe('api.github.com');
      expect(ok.value.credential).toBe('github-token'); // NAME only
      expect(ok.value.delivered).toBe(false);
      expect(ok.value.exchange_id).toBe('netex-0001');
    }
  });

  it('denies all egress when the policy is "none"', () => {
    const { sandbox } = sandboxWith({
      network: { egress: 'none' },
      budgets: { fileWrites: null, fileBytes: null, shellCommands: null, networkCalls: null, secretReveals: null },
    });
    const denied = sandbox.network.netCall('api.github.com', '/', null);
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_NETWORK_EGRESS_DENIED');
    }
  });
});

describe('sandbox: budget overruns are typed denials', () => {
  it('denies a write past the fileWrites budget', () => {
    const { sandbox } = sandboxWith();
    expect(sandbox.filesystem.write('a.txt', 'x').status).toBe('OK');
    expect(sandbox.filesystem.write('b.txt', 'x').status).toBe('OK');
    expect(sandbox.filesystem.write('c.txt', 'x').status).toBe('OK');
    const denied = sandbox.filesystem.write('d.txt', 'x');
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_BUDGET_EXCEEDED');
      expect(denied.denial.subject).toBe('fileWrites');
    }
  });

  it('denies past the fileBytes budget', () => {
    const { sandbox } = sandboxWith();
    expect(sandbox.filesystem.write('a.txt', 'x'.repeat(60)).status).toBe('OK');
    const denied = sandbox.filesystem.write('b.txt', 'x'.repeat(60));
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_BUDGET_EXCEEDED');
      expect(denied.denial.subject).toBe('fileBytes');
    }
  });

  it('denies shell command and network consumption past their budgets', () => {
    const { sandbox } = sandboxWith();
    expect(sandbox.budget.consume('shellCommands', 1).status).toBe('OK');
    expect(sandbox.budget.consume('shellCommands', 1).status).toBe('OK');
    const denied = sandbox.budget.consume('shellCommands', 1);
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_BUDGET_EXCEEDED');
    }
    expect(sandbox.network.netCall('api.github.com', '/', null).status).toBe('OK');
    expect(sandbox.network.netCall('registry.npmjs.org', '/', null).status).toBe('OK');
    const deniedCall = sandbox.network.netCall('api.github.com', '/', null);
    expect(deniedCall.status === 'DENIED' && deniedCall.denial.code).toBe('SANDBOX_BUDGET_EXCEEDED');
  });

  it('denies a second credential resolution past the secretReveals budget', () => {
    const { sandbox } = sandboxWith();
    expect(sandbox.network.netCall('api.github.com', '/a', 'github-token').status).toBe('OK');
    const denied = sandbox.network.netCall('api.github.com', '/b', 'github-token');
    expect(denied.status === 'DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_BUDGET_EXCEEDED');
      expect(denied.denial.subject).toBe('secretReveals');
    }
  });

  it('reports every counter deterministically', () => {
    const { sandbox } = sandboxWith();
    sandbox.filesystem.write('a.txt', 'xxxx');
    const report = sandbox.budget.report();
    expect(report.counters.map((counter) => counter.counter)).toEqual([...SANDBOX_BUDGET_COUNTERS]);
    const fileWrites = report.counters.find((counter) => counter.counter === 'fileWrites');
    expect(fileWrites).toMatchObject({ limit: 3, used: 1, remaining: 2 });
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
  });
});

describe('sandbox: secrets isolation (values live only inside the closure)', () => {
  it('names() answers NAMES only and never echoes values', () => {
    const { sandbox } = sandboxWith();
    expect(sandbox.secrets.names()).toEqual(['github-token']);
  });

  it('denies undeclared and uninjected credentials truthfully (never fabricated)', () => {
    const policy: SandboxPolicy = BASE_POLICY;
    const sandbox = createLocalSandbox({ policy }); // no values injected
    const denied = sandbox.network.netCall('api.github.com', '/', 'github-token');
    expect(denied.status).toBe('DENIED');
    if (denied.status === 'DENIED') {
      expect(denied.denial.code).toBe('SANDBOX_SECRET_UNAVAILABLE');
    }
    const undeclared = sandboxWith().sandbox.network.netCall('api.github.com', '/', 'unrelated-token');
    expect(undeclared.status === 'DENIED' && undeclared.denial.code).toBe('SANDBOX_SECRET_UNAVAILABLE');
  });

  it('never surfaces the secret value in any serialized output', () => {
    const { sandbox } = sandboxWith();
    // Exercise every surface that produces output.
    sandbox.filesystem.write('a.txt', 'content');
    sandbox.network.netCall('api.github.com', '/x', 'github-token');
    const denial = sandbox.filesystem.read('../escape');
    const outputs = [
      JSON.stringify(sandbox.describe()),
      JSON.stringify(sandbox.policy()),
      JSON.stringify(sandbox.budget.report()),
      JSON.stringify(sandbox.secrets.names()),
      JSON.stringify(denial),
      renderSandboxDenial(denial.status === 'DENIED' ? denial.denial : { code: 'SANDBOX_ENDED', subject: 'x', reason: 'x' }),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(SECRET_VALUE);
    }
    expect(sandbox.secrets.resolutions()).toBe(1);
  });

  it('rejects an undeclared injected credential value loudly at construction', () => {
    expect(() =>
      createLocalSandbox({ policy: BASE_POLICY, secrets: { 'never-declared': 'value' } as Record<string, string> }),
    ).toThrowError(/undeclared name/);
  });
});

describe('sandbox: disposal is fail-closed', () => {
  it('refuses every operation after end() with SANDBOX_ENDED', () => {
    const { sandbox } = sandboxWith();
    sandbox.end('task session complete');
    expect(sandbox.ended()).toBe(true);
    expect(sandbox.endReason()).toBe('task session complete');
    const denied = sandbox.filesystem.write('a.txt', 'x');
    expect(denied.status === 'DENIED' && denied.denial.code).toBe('SANDBOX_ENDED');
    const deniedCall = sandbox.network.netCall('api.github.com', '/', null);
    expect(deniedCall.status === 'DENIED' && deniedCall.denial.code).toBe('SANDBOX_ENDED');
    const deniedConsume = sandbox.budget.consume('fileWrites', 1);
    expect(deniedConsume.status === 'DENIED' && deniedConsume.denial.code).toBe('SANDBOX_ENDED');
  });
});

describe('sandbox: honest reference limits (typed INVALID at construction)', () => {
  it('rejects filesystem mode "host" for the in-process reference environment', () => {
    expect(() =>
      createLocalSandbox({
        policy: { ...BASE_POLICY, filesystem: { mode: 'host', root: '/' } },
      }),
    ).toThrowError(/host/);
  });

  it('rejects egress "open" for the in-process reference environment', () => {
    expect(() =>
      createLocalSandbox({
        policy: { ...BASE_POLICY, network: { egress: 'open' } },
      }),
    ).toThrowError(/open/);
  });
});

describe('sandbox: policy validation is loud', () => {
  it('validates the exact field set and budgets', () => {
    expect(() => assertValidSandboxPolicy({})).toThrowError();
    expect(() =>
      assertValidSandboxPolicy({
        ...BASE_POLICY,
        budgets: { fileWrites: 0, fileBytes: null, shellCommands: null, networkCalls: null, secretReveals: null },
      }),
    ).toThrowError(/budgets/);
    expect(() =>
      assertValidSandboxPolicy({
        ...BASE_POLICY,
        secrets: ['name=value'],
      }),
    ).toThrowError(/NAMES/);
    expect(() =>
      assertValidSandboxPolicy({
        ...BASE_POLICY,
        resourceEnvelope: { maxDurationMs: 25 * 60 * 60_000, maxMemoryMb: null },
      }),
    ).toThrowError(/resourceEnvelope/);
    expect(() => assertValidSandboxPolicy(BASE_POLICY)).not.toThrow();
  });
});
