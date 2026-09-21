/**
 * A compact fake body for execution-fabric unit tests (Work Order P5).
 *
 * The FULL reference body driving the acceptance journeys lives in
 * tests/harness-contracts; this stub implements the HarnessContract
 * surface minimally: an in-memory workspace, a shell echo, a run-flag
 * probe proving whether operations actually dispatched, and typed
 * UNSUPPORTED answers for unadvertised operations.
 */

import type {
  BrowserAction,
  HarnessCapabilities,
  HarnessContract,
  HarnessIdentity,
  HarnessResult,
} from '@sos-2/harness';
import { harnessFailed, harnessOk, harnessUnsupported } from '@sos-2/harness';

export interface FakeBodyOptions {
  readonly bodyId: string;
  readonly providerName?: string;
  readonly placement?: 'cloud' | 'remote' | 'user-device';
  readonly withBrowser?: boolean;
  /** When set, shell.exec runs and FAILS with this error (truthful failure). */
  readonly shellFailure?: string | null;
}

export class FakeBody implements HarnessContract {
  readonly identityValue: HarnessIdentity;
  readonly capabilitiesValue: HarnessCapabilities;
  /** Run-flag probe: how many times shell.exec actually dispatched. */
  shellDispatches = 0;
  /** Everything the body emitted (observations), in order. */
  readonly emittedObservations: { kind: string; payload: unknown }[] = [];
  private readonly files = new Map<string, string>();

  constructor(options: FakeBodyOptions) {
    this.identityValue = {
      harness_id: `harness:${options.bodyId}`,
      provider: { name: options.providerName ?? 'fake-body-vendor', version: '1.0.0' },
      placement: options.placement ?? 'cloud',
    };
    this.capabilitiesValue = {
      capabilities: options.withBrowser
        ? ['terminal', 'filesystem', 'repository-operations', 'browser-ui']
        : ['terminal', 'filesystem', 'repository-operations'],
      isolationLevel: 'container',
      networkPolicy: { egress: 'allowlist', allowedHosts: ['api.github.com'] },
      filesystemScope: { mode: 'workspace', root: `/workspace/${options.bodyId}` },
      browser: options.withBrowser ? ['open', 'interact'] : [],
      shell: ['exec'],
      git: ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'],
      runtimeIntegrations: [],
      taskLifecycle: { create: true, resume: true, pause: true, cancel: true, checkpoints: true },
      evidenceCapture: { artifacts: true, observations: true, events: true },
      costEnvelope: { maxDurationMs: 3_600_000, maxMemoryMb: 512, maxCostUsdPerTask: 0.25 },
    };
  }

  identity(): HarnessIdentity {
    return this.identityValue;
  }

  capabilities(): HarnessCapabilities {
    return this.capabilitiesValue;
  }

  createTask(request: { task_ref: string; input: unknown }): HarnessResult<{ accepted: true; workspace_root: string | null }> {
    return harnessOk({ accepted: true, workspace_root: `/workspace/${this.identityValue.harness_id}/${request.task_ref}` });
  }

  resumeTask(request: { task_ref: string }): HarnessResult<{ state: 'resumed'; recovered: unknown }> {
    return harnessOk({ state: 'resumed', recovered: { task_ref: request.task_ref } });
  }

  pauseTask(): HarnessResult<{ state: 'paused' }> {
    return harnessOk({ state: 'paused' });
  }

  cancelTask(): HarnessResult<{ state: 'cancelled' }> {
    return harnessOk({ state: 'cancelled' });
  }

  readonly workspace = {
    read: (request: { task_ref: string; path: string }): HarnessResult<{ content: string }> => {
      const content = this.files.get(request.path);
      if (content === undefined) {
        return harnessFailed(`no such file: ${request.path}`);
      }
      return harnessOk({ content });
    },
    write: (request: { task_ref: string; path: string; content: string }): HarnessResult<{ bytes: number }> => {
      this.files.set(request.path, request.content);
      return harnessOk({ bytes: request.content.length });
    },
  };

  readonly shell = {
    exec: (request: { task_ref: string; command: string; args: readonly string[]; cwd: string | null }): HarnessResult<{ exit_code: number; stdout: string; stderr: string }> => {
      this.shellDispatches += 1;
      return harnessOk({ exit_code: 0, stdout: `${request.command} ${request.args.join(' ')}`.trim(), stderr: '' });
    },
  };

  readonly browser = {
    open: (request: { task_ref: string; url: string }): HarnessResult<{ page_id: string; url: string; title: string | null }> => {
      if (this.capabilitiesValue.browser.length === 0) {
        return harnessUnsupported('browser.open', 'the advertisement carries no browser capability (explicit)');
      }
      return harnessOk({ page_id: 'page-1', url: request.url, title: 'Fake Page' });
    },
    interact: (request: { task_ref: string; page_id: string; action: BrowserAction; target: string; value: string | null }): HarnessResult<{ result: unknown }> => {
      if (this.capabilitiesValue.browser.length === 0) {
        return harnessUnsupported('browser.interact', 'the advertisement carries no browser capability (explicit)');
      }
      return harnessOk({ result: request.action === 'read' ? `content of ${request.target}` : null });
    },
  };

  readonly git = {
    status: (): HarnessResult<{ branch: string | null; clean: boolean; changed: readonly string[] }> =>
      harnessOk({ branch: 'main', clean: true, changed: [] }),
    diff: (): HarnessResult<{ diff: string }> => harnessOk({ diff: '' }),
    commit: (request: { task_ref: string; message: string }): HarnessResult<{ commit_ref: string; files: number }> =>
      harnessOk({ commit_ref: `commit-${request.message.length}`, files: 1 }),
    push: (request: { task_ref: string; remote: string; ref: string }): HarnessResult<{ pushed_ref: string }> =>
      harnessOk({ pushed_ref: `${request.remote}/${request.ref}` }),
    createBranch: (request: { task_ref: string; name: string }): HarnessResult<{ branch: string }> => harnessOk({ branch: request.name }),
    createPullRequest: (request: { task_ref: string; title: string }): HarnessResult<{ pull_request_ref: string; url: string | null }> =>
      harnessOk({ pull_request_ref: `pr-${request.title.length}`, url: 'https://example.invalid/pr/1' }),
  };

  readonly artifacts = {
    capture: (request: { task_ref: string; name: string; content: string }): HarnessResult<{ artifact_id: string; size_bytes: number; description: string | null }> =>
      harnessOk({ artifact_id: `${request.task_ref}:${request.name}`, size_bytes: request.content.length, description: `captured ${request.name}` }),
  };

  readonly observations = {
    emit: (request: { task_ref: string; observation_kind: string; payload: unknown }): HarnessResult<{ accepted: true }> => {
      this.emittedObservations.push({ kind: request.observation_kind, payload: request.payload });
      return harnessOk({ accepted: true });
    },
  };

  readonly events = {
    subscribe: (): HarnessResult<{ events: readonly { event_id: string; kind: string; payload: unknown }[]; next_cursor: string | null }> =>
      harnessOk({ events: [], next_cursor: null }),
  };
}
