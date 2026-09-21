/**
 * THE NATIVE-API ADAPTER SHAPE (Work Order P8) — §4 tier 1, the highest
 * control surface: a native API/SDK-style provider.
 *
 * The transport is the SDK-shaped typed surface: one typed method per §9
 * operation, grouped exactly like the HarnessContract namespaces. A real
 * provider SDK (or app-server client) implements this surface; the
 * adapter delegates 1:1 — the native SDK shape IS the contract surface,
 * so no marshaling occurs and the typed end-to-end discipline holds by
 * construction.
 */

import { InvalidHarnessAdapterSpecError } from '../errors.js';
import { assertValidHarnessAdapterSpec } from '../adapter.js';
import type { HarnessAdapterDescriptor, HarnessAdapterSpec, HarnessProviderAdapter } from '../adapter.js';
import type {
  ArtifactsCaptureRequest,
  ArtifactsCaptureResult,
  BrowserInteractRequest,
  BrowserInteractResult,
  BrowserOpenRequest,
  BrowserOpenResult,
  CancelTaskRequest,
  CancelTaskResult,
  CreateTaskRequest,
  CreateTaskResult,
  EventsSubscribeRequest,
  EventsSubscribeResult,
  GitCommitRequest,
  GitCommitResult,
  GitCreateBranchRequest,
  GitCreateBranchResult,
  GitCreatePullRequestRequest,
  GitCreatePullRequestResult,
  GitDiffRequest,
  GitDiffResult,
  GitPushRequest,
  GitPushResult,
  GitStatusRequest,
  GitStatusResult,
  HarnessCapabilities,
  HarnessContract,
  HarnessIdentity,
  HarnessResult,
  ObservationsEmitRequest,
  ObservationsEmitResult,
  PauseTaskRequest,
  PauseTaskResult,
  ResumeTaskRequest,
  ResumeTaskResult,
  ShellExecRequest,
  ShellExecResult,
  WorkspaceReadRequest,
  WorkspaceReadResult,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '@sos-2/harness';
import { isOperationAdvertised } from '@sos-2/harness';

/**
 * THE NATIVE API TRANSPORT — the SDK-shaped typed provider surface (one
 * typed method per §9 operation). Real provider SDKs implement this;
 * tests inject fakes; the in-process bridge serves any HarnessContract.
 */
export interface NativeApiTransport {
  createTask(request: CreateTaskRequest): HarnessResult<CreateTaskResult>;
  resumeTask(request: ResumeTaskRequest): HarnessResult<ResumeTaskResult>;
  pauseTask(request: PauseTaskRequest): HarnessResult<PauseTaskResult>;
  cancelTask(request: CancelTaskRequest): HarnessResult<CancelTaskResult>;
  readonly workspace: {
    read(request: WorkspaceReadRequest): HarnessResult<WorkspaceReadResult>;
    write(request: WorkspaceWriteRequest): HarnessResult<WorkspaceWriteResult>;
  };
  readonly shell: { exec(request: ShellExecRequest): HarnessResult<ShellExecResult> };
  readonly browser: {
    open(request: BrowserOpenRequest): HarnessResult<BrowserOpenResult>;
    interact(request: BrowserInteractRequest): HarnessResult<BrowserInteractResult>;
  };
  readonly git: {
    status(request: GitStatusRequest): HarnessResult<GitStatusResult>;
    diff(request: GitDiffRequest): HarnessResult<GitDiffResult>;
    commit(request: GitCommitRequest): HarnessResult<GitCommitResult>;
    push(request: GitPushRequest): HarnessResult<GitPushResult>;
    createBranch(request: GitCreateBranchRequest): HarnessResult<GitCreateBranchResult>;
    createPullRequest(request: GitCreatePullRequestRequest): HarnessResult<GitCreatePullRequestResult>;
  };
  readonly artifacts: { capture(request: ArtifactsCaptureRequest): HarnessResult<ArtifactsCaptureResult> };
  readonly observations: { emit(request: ObservationsEmitRequest): HarnessResult<ObservationsEmitResult> };
  readonly events: { subscribe(request: EventsSubscribeRequest): HarnessResult<EventsSubscribeResult> };
}

function advertisedGate<T>(operation: import('@sos-2/harness').HarnessOperationName, capabilities: HarnessCapabilities, reason: string): HarnessResult<T> | null {
  if (!isOperationAdvertised(capabilities, operation)) {
    return {
      status: 'UNSUPPORTED',
      availability: 'UNSUPPORTED',
      operation,
      reason,
      value: null,
    };
  }
  return null;
}

/**
 * The native-api harness provider adapter (§4 tier 1): delegates the §9
 * contract onto the SDK-shaped transport, gated by the binding
 * advertisement (unsupported operations answer typed UNSUPPORTED).
 */
export class NativeApiHarnessAdapter implements HarnessProviderAdapter {
  private readonly spec: HarnessAdapterSpec;
  private readonly transport: NativeApiTransport;

  constructor(transport: NativeApiTransport, spec: HarnessAdapterSpec) {
    if (typeof transport !== 'object' || transport === null || typeof transport.createTask !== 'function') {
      throw new InvalidHarnessAdapterSpecError('native-api-adapter', 'the native-api adapter requires an SDK-shaped NativeApiTransport');
    }
    assertValidHarnessAdapterSpec(spec);
    this.transport = transport;
    this.spec = spec;
  }

  descriptor(): HarnessAdapterDescriptor {
    return {
      adapter_id: this.spec.adapterId,
      tier: 'native-api',
      provider: { ...this.spec.provider },
      placement: this.spec.placement,
      connection: { ...this.spec.connection },
      note: this.spec.note ?? `native API/SDK-shaped provider adapter (§4 tier 1 — the highest control surface) over an injectable transport`,
    };
  }

  tier(): 'native-api' {
    return 'native-api';
  }

  capabilities(): HarnessCapabilities {
    return this.spec.capabilities;
  }

  identity(): HarnessIdentity {
    return {
      harness_id: `adapter:${this.spec.adapterId}`,
      provider: { ...this.spec.provider },
      placement: this.spec.placement,
    };
  }

  harness(): HarnessContract {
    const capabilities = this.spec.capabilities;
    const transport = this.transport;
    return {
      identity: () => this.identity(),
      capabilities: () => capabilities,
      createTask: (request) =>
        advertisedGate('createTask', capabilities, 'the provider session advertisement does not carry createTask') ??
        transport.createTask(request),
      resumeTask: (request) =>
        advertisedGate('resumeTask', capabilities, 'the provider session advertisement does not carry resumeTask') ??
        transport.resumeTask(request),
      pauseTask: (request) =>
        advertisedGate('pauseTask', capabilities, 'the provider session advertisement does not carry pauseTask') ??
        transport.pauseTask(request),
      cancelTask: (request) =>
        advertisedGate('cancelTask', capabilities, 'the provider session advertisement does not carry cancelTask') ??
        transport.cancelTask(request),
      workspace: {
        read: (request) =>
          advertisedGate('workspace.read', capabilities, 'the provider session advertisement does not carry workspace.read') ??
          transport.workspace.read(request),
        write: (request) =>
          advertisedGate('workspace.write', capabilities, 'the provider session advertisement does not carry workspace.write') ??
          transport.workspace.write(request),
      },
      shell: {
        exec: (request) =>
          advertisedGate('shell.exec', capabilities, 'the provider session advertisement does not carry shell.exec') ??
          transport.shell.exec(request),
      },
      browser: {
        open: (request) =>
          advertisedGate('browser.open', capabilities, 'the provider session advertisement does not carry browser.open') ??
          transport.browser.open(request),
        interact: (request) =>
          advertisedGate('browser.interact', capabilities, 'the provider session advertisement does not carry browser.interact') ??
          transport.browser.interact(request),
      },
      git: {
        status: (request) =>
          advertisedGate('git.status', capabilities, 'the provider session advertisement does not carry git.status') ??
          transport.git.status(request),
        diff: (request) =>
          advertisedGate('git.diff', capabilities, 'the provider session advertisement does not carry git.diff') ??
          transport.git.diff(request),
        commit: (request) =>
          advertisedGate('git.commit', capabilities, 'the provider session advertisement does not carry git.commit') ??
          transport.git.commit(request),
        push: (request) =>
          advertisedGate('git.push', capabilities, 'the provider session advertisement does not carry git.push') ??
          transport.git.push(request),
        createBranch: (request) =>
          advertisedGate('git.createBranch', capabilities, 'the provider session advertisement does not carry git.createBranch') ??
          transport.git.createBranch(request),
        createPullRequest: (request) =>
          advertisedGate('git.createPullRequest', capabilities, 'the provider session advertisement does not carry git.createPullRequest') ??
          transport.git.createPullRequest(request),
      },
      artifacts: {
        capture: (request) =>
          advertisedGate('artifacts.capture', capabilities, 'the provider session advertisement does not carry artifacts.capture') ??
          transport.artifacts.capture(request),
      },
      observations: {
        emit: (request) =>
          advertisedGate('observations.emit', capabilities, 'the provider session advertisement does not carry observations.emit') ??
          transport.observations.emit(request),
      },
      events: {
        subscribe: (request) =>
          advertisedGate('events.subscribe', capabilities, 'the provider session advertisement does not carry events.subscribe') ??
          transport.events.subscribe(request),
      },
    };
  }
}
