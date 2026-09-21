/**
 * THE MCP ADAPTER SHAPE (Work Order P8) — §4 tier 2: MCP or an
 * equivalent tool protocol.
 *
 * Every §9 operation is a TOOL (listable through listTools, callable
 * through callTool with JSON arguments). The adapter marshals typed
 * requests onto tool calls and validates every reply value against the
 * operation's exact typed shape (a malformed reply is a truthful FAILED
 * result — never a silent success). Real MCP servers implement the
 * transport; tests inject fakes; the in-process bridge serves any
 * HarnessContract through the same protocol shape.
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

/** One tool descriptor of the protocol surface. */
export interface McpToolDescriptor {
  /** The tool name (the §9 operation rendered in tool-name form). */
  readonly name: string;
  readonly description: string;
}

/** One tool call. */
export interface McpToolCall {
  readonly name: string;
  /** The typed §9 request as JSON arguments. */
  readonly arguments: JsonValue;
}

/** The typed result of one tool call. */
export type McpToolResult =
  | { readonly status: 'OK'; readonly result: JsonValue }
  | { readonly status: 'ERROR'; readonly message: string }
  | { readonly status: 'UNSUPPORTED_TOOL'; readonly message: string };

/**
 * THE MCP TRANSPORT — the tool-protocol-shaped provider surface. Real
 * MCP servers implement this; tests inject fakes.
 */
export interface McpProtocolTransport {
  listTools(): readonly McpToolDescriptor[];
  callTool(call: McpToolCall): McpToolResult;
}

/** Render a §9 operation as a tool name (dots become double underscores). */
export function toolNameForOperation(operation: HarnessOperationName): string {
  return operation.replaceAll('.', '__');
}

/** Parse a tool name back into its §9 operation (null when unknown). */
export function operationForToolName(name: string): HarnessOperationName | null {
  for (const operation of HARNESS_OPERATIONS) {
    if (toolNameForOperation(operation) === name) {
      return operation;
    }
  }
  return null;
}

/** The tool descriptors of the §9 vocabulary (deterministic order). */
export function harnessToolDescriptors(): readonly McpToolDescriptor[] {
  return HARNESS_OPERATIONS.map((operation) => ({
    name: toolNameForOperation(operation),
    description: `The §9 harness operation ${operation} (P5 Harness Contract) exposed as a tool.`,
  }));
}

/**
 * The MCP harness provider adapter (§4 tier 2): maps the §9 contract
 * onto tool calls over the injectable protocol transport, gated by the
 * binding advertisement and reply-validated against the exact typed
 * shapes.
 */
export class McpHarnessAdapter implements HarnessProviderAdapter {
  private readonly spec: HarnessAdapterSpec;
  private readonly transport: McpProtocolTransport;

  constructor(transport: McpProtocolTransport, spec: HarnessAdapterSpec) {
    if (typeof transport !== 'object' || transport === null || typeof transport.callTool !== 'function' || typeof transport.listTools !== 'function') {
      throw new InvalidHarnessAdapterSpecError('mcp-adapter', 'the MCP adapter requires an McpProtocolTransport { listTools, callTool }');
    }
    assertValidHarnessAdapterSpec(spec);
    this.transport = transport;
    this.spec = spec;
  }

  descriptor(): HarnessAdapterDescriptor {
    return {
      adapter_id: this.spec.adapterId,
      tier: 'mcp-protocol',
      provider: { ...this.spec.provider },
      placement: this.spec.placement,
      connection: { ...this.spec.connection },
      note: this.spec.note ?? `MCP/equivalent tool-protocol provider adapter (§4 tier 2) over an injectable transport`,
    };
  }

  tier(): 'mcp-protocol' {
    return 'mcp-protocol';
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
    const call = <T>(operation: HarnessOperationName, request: object): HarnessResult<T> => {
      if (!isOperationAdvertised(capabilities, operation)) {
        return harnessUnsupported(operation, `the provider session advertisement does not carry ${operation} — unsupported capabilities are explicit, never silent`);
      }
      const reply = transport.callTool({ name: toolNameForOperation(operation), arguments: structuredClone(request) as unknown as JsonValue });
      if (reply.status === 'UNSUPPORTED_TOOL') {
        return harnessUnsupported(operation, `the tool transport answered UNSUPPORTED_TOOL: ${reply.message}`);
      }
      if (reply.status === 'ERROR') {
        return harnessFailed(`the tool transport reported an error: ${reply.message}`);
      }
      const violation = harnessReplyValueViolation(operation, reply.result);
      if (violation !== null) {
        return harnessFailed(`malformed transport reply for ${operation}: ${violation} — never a silent success`);
      }
      return harnessOk(reply.result as unknown as T);
    };
    return {
      identity: () => this.identity(),
      capabilities: () => capabilities,
      createTask: (request: CreateTaskRequest) => call<CreateTaskResult>('createTask', request),
      resumeTask: (request: ResumeTaskRequest) => call<ResumeTaskResult>('resumeTask', request),
      pauseTask: (request: PauseTaskRequest) => call<PauseTaskResult>('pauseTask', request),
      cancelTask: (request: CancelTaskRequest) => call<CancelTaskResult>('cancelTask', request),
      workspace: {
        read: (request: WorkspaceReadRequest) => call<WorkspaceReadResult>('workspace.read', request),
        write: (request: WorkspaceWriteRequest) => call<WorkspaceWriteResult>('workspace.write', request),
      },
      shell: {
        exec: (request: ShellExecRequest) => call<ShellExecResult>('shell.exec', request),
      },
      browser: {
        open: (request: BrowserOpenRequest) => call<BrowserOpenResult>('browser.open', request),
        interact: (request: BrowserInteractRequest) => call<BrowserInteractResult>('browser.interact', request),
      },
      git: {
        status: (request: GitStatusRequest) => call<GitStatusResult>('git.status', request),
        diff: (request: GitDiffRequest) => call<GitDiffResult>('git.diff', request),
        commit: (request: GitCommitRequest) => call<GitCommitResult>('git.commit', request),
        push: (request: GitPushRequest) => call<GitPushResult>('git.push', request),
        createBranch: (request: GitCreateBranchRequest) => call<GitCreateBranchResult>('git.createBranch', request),
        createPullRequest: (request: GitCreatePullRequestRequest) => call<GitCreatePullRequestResult>('git.createPullRequest', request),
      },
      artifacts: {
        capture: (request: ArtifactsCaptureRequest) => call<ArtifactsCaptureResult>('artifacts.capture', request),
      },
      observations: {
        emit: (request: ObservationsEmitRequest) => call<ObservationsEmitResult>('observations.emit', request),
      },
      events: {
        subscribe: (request: EventsSubscribeRequest) => call<EventsSubscribeResult>('events.subscribe', request),
      },
    };
  }
}
