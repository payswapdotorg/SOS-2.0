/**
 * THE LOCAL-BRIDGE ADAPTER SHAPE (Work Order P8) — §4 tier 3: the local
 * companion / service bridge.
 *
 * Every §9 operation is a BRIDGE COMMAND (dispatched with a JSON body).
 * The adapter marshals typed requests onto command dispatches and
 * validates every reply body against the operation's exact typed shape
 * (a malformed reply is a truthful FAILED result — never a silent
 * success). Real companion processes implement the transport; tests
 * inject fakes; the in-process bridge serves any HarnessContract
 * through the same bridge shape.
 */

import { InvalidHarnessAdapterSpecError } from '../errors.js';
import { assertValidHarnessAdapterSpec } from '../adapter.js';
import type { HarnessAdapterDescriptor, HarnessAdapterSpec, HarnessProviderAdapter } from '../adapter.js';
import { harnessReplyValueViolation } from '../transport.js';
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
  HarnessOperationName,
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
import { HARNESS_OPERATIONS, harnessFailed, harnessOk, harnessUnsupported, isOperationAdvertised } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';

/** One bridge command. */
export interface BridgeCommand {
  /** The command name (the §9 operation rendered in bridge form). */
  readonly command: string;
  /** The typed §9 request as the command body. */
  readonly body: JsonValue;
}

/** The typed reply of one bridge command. */
export type BridgeReply =
  | { readonly status: 'OK'; readonly body: JsonValue | null }
  | { readonly status: 'ERROR'; readonly message: string }
  | { readonly status: 'UNKNOWN_COMMAND'; readonly message: string };

/**
 * THE LOCAL BRIDGE TRANSPORT — the companion/service-bridge-shaped
 * provider surface. Real companion processes implement this; tests
 * inject fakes.
 */
export interface LocalBridgeTransport {
  dispatch(command: BridgeCommand): BridgeReply;
}

/** Render a §9 operation as a bridge command name. */
export function bridgeCommandForOperation(operation: HarnessOperationName): string {
  return `harness.${operation}`;
}

/** Parse a bridge command name back into its §9 operation (null when unknown). */
export function operationForBridgeCommand(command: string): HarnessOperationName | null {
  if (!command.startsWith('harness.')) {
    return null;
  }
  const operation = command.slice('harness.'.length) as HarnessOperationName;
  return HARNESS_OPERATIONS.includes(operation) ? operation : null;
}

/**
 * The local-bridge harness provider adapter (§4 tier 3): maps the §9
 * contract onto command dispatches over the injectable bridge
 * transport, gated by the binding advertisement and reply-validated
 * against the exact typed shapes.
 */
export class LocalBridgeHarnessAdapter implements HarnessProviderAdapter {
  private readonly spec: HarnessAdapterSpec;
  private readonly transport: LocalBridgeTransport;

  constructor(transport: LocalBridgeTransport, spec: HarnessAdapterSpec) {
    if (typeof transport !== 'object' || transport === null || typeof transport.dispatch !== 'function') {
      throw new InvalidHarnessAdapterSpecError('local-bridge-adapter', 'the local-bridge adapter requires a LocalBridgeTransport { dispatch }');
    }
    assertValidHarnessAdapterSpec(spec);
    this.transport = transport;
    this.spec = spec;
  }

  descriptor(): HarnessAdapterDescriptor {
    return {
      adapter_id: this.spec.adapterId,
      tier: 'local-bridge',
      provider: { ...this.spec.provider },
      placement: this.spec.placement,
      connection: { ...this.spec.connection },
      note: this.spec.note ?? `local companion/service-bridge provider adapter (§4 tier 3) over an injectable transport`,
    };
  }

  tier(): 'local-bridge' {
    return 'local-bridge';
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
    const dispatch = <T>(operation: HarnessOperationName, request: object): HarnessResult<T> => {
      if (!isOperationAdvertised(capabilities, operation)) {
        return harnessUnsupported(operation, `the provider session advertisement does not carry ${operation} — unsupported capabilities are explicit, never silent`);
      }
      const reply = transport.dispatch({ command: bridgeCommandForOperation(operation), body: structuredClone(request) as unknown as JsonValue });
      if (reply.status === 'UNKNOWN_COMMAND') {
        return harnessUnsupported(operation, `the bridge transport answered UNKNOWN_COMMAND: ${reply.message}`);
      }
      if (reply.status === 'ERROR') {
        return harnessFailed(`the bridge transport reported an error: ${reply.message}`);
      }
      if (reply.body === null) {
        return harnessFailed(`malformed transport reply for ${operation}: the bridge returned no body — never a silent success`);
      }
      const violation = harnessReplyValueViolation(operation, reply.body);
      if (violation !== null) {
        return harnessFailed(`malformed transport reply for ${operation}: ${violation} — never a silent success`);
      }
      return harnessOk(reply.body as unknown as T);
    };
    return {
      identity: () => this.identity(),
      capabilities: () => capabilities,
      createTask: (request: CreateTaskRequest) => dispatch<CreateTaskResult>('createTask', request),
      resumeTask: (request: ResumeTaskRequest) => dispatch<ResumeTaskResult>('resumeTask', request),
      pauseTask: (request: PauseTaskRequest) => dispatch<PauseTaskResult>('pauseTask', request),
      cancelTask: (request: CancelTaskRequest) => dispatch<CancelTaskResult>('cancelTask', request),
      workspace: {
        read: (request: WorkspaceReadRequest) => dispatch<WorkspaceReadResult>('workspace.read', request),
        write: (request: WorkspaceWriteRequest) => dispatch<WorkspaceWriteResult>('workspace.write', request),
      },
      shell: {
        exec: (request: ShellExecRequest) => dispatch<ShellExecResult>('shell.exec', request),
      },
      browser: {
        open: (request: BrowserOpenRequest) => dispatch<BrowserOpenResult>('browser.open', request),
        interact: (request: BrowserInteractRequest) => dispatch<BrowserInteractResult>('browser.interact', request),
      },
      git: {
        status: (request: GitStatusRequest) => dispatch<GitStatusResult>('git.status', request),
        diff: (request: GitDiffRequest) => dispatch<GitDiffResult>('git.diff', request),
        commit: (request: GitCommitRequest) => dispatch<GitCommitResult>('git.commit', request),
        push: (request: GitPushRequest) => dispatch<GitPushResult>('git.push', request),
        createBranch: (request: GitCreateBranchRequest) => dispatch<GitCreateBranchResult>('git.createBranch', request),
        createPullRequest: (request: GitCreatePullRequestRequest) => dispatch<GitCreatePullRequestResult>('git.createPullRequest', request),
      },
      artifacts: {
        capture: (request: ArtifactsCaptureRequest) => dispatch<ArtifactsCaptureResult>('artifacts.capture', request),
      },
      observations: {
        emit: (request: ObservationsEmitRequest) => dispatch<ObservationsEmitResult>('observations.emit', request),
      },
      events: {
        subscribe: (request: EventsSubscribeRequest) => dispatch<EventsSubscribeResult>('events.subscribe', request),
      },
    };
  }
}
