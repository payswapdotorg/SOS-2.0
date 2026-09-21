/**
 * The IN-PROCESS TRANSPORT BRIDGES (Work Order P8) — serve ANY
 * HarnessContract (including the P8 reference bodies of
 * @sos-2/body-runtimes) through every adapter shape:
 *
 *   inProcessNativeApiTransport     the SDK-shaped typed surface
 *   inProcessMcpTransport           the tool-protocol surface
 *   inProcessLocalBridgeTransport   the companion/service-bridge surface
 *
 * This is the local-development and test composition: a reference body
 * registered through an adapter is indistinguishable from a provider
 * session at the contract level — REAL provider endpoints attach later
 * by implementing the same transports WITHOUT contract change (the
 * adapter seam is the contract; the transport is the wiring).
 *
 * Determinism: pure delegation — no clock, no randomness, no network.
 */

import { harnessRequestViolation } from './transport.js';
import type { McpProtocolTransport, McpToolCall, McpToolResult } from './shapes/mcp.js';
import { harnessToolDescriptors, operationForToolName, toolNameForOperation } from './shapes/mcp.js';
import type { BridgeCommand, BridgeReply, LocalBridgeTransport } from './shapes/local-bridge.js';
import { operationForBridgeCommand, bridgeCommandForOperation } from './shapes/local-bridge.js';
import type { NativeApiTransport } from './shapes/native-api.js';
import type { HarnessContract, HarnessOperationName, HarnessResult } from '@sos-2/harness';
import { advertisedOperations } from '@sos-2/harness';
import type { JsonValue } from '@sos-2/semantic-spine';

/** Dispatch one validated §9 request onto a HarnessContract. */
function dispatchOperation(harness: HarnessContract, operation: HarnessOperationName, request: object): HarnessResult<unknown> {
  switch (operation) {
    case 'createTask':
      return harness.createTask(request as import('@sos-2/harness').CreateTaskRequest);
    case 'resumeTask':
      return harness.resumeTask(request as import('@sos-2/harness').ResumeTaskRequest);
    case 'pauseTask':
      return harness.pauseTask(request as import('@sos-2/harness').PauseTaskRequest);
    case 'cancelTask':
      return harness.cancelTask(request as import('@sos-2/harness').CancelTaskRequest);
    case 'workspace.read':
      return harness.workspace.read(request as import('@sos-2/harness').WorkspaceReadRequest);
    case 'workspace.write':
      return harness.workspace.write(request as import('@sos-2/harness').WorkspaceWriteRequest);
    case 'shell.exec':
      return harness.shell.exec(request as import('@sos-2/harness').ShellExecRequest);
    case 'browser.open':
      return harness.browser.open(request as import('@sos-2/harness').BrowserOpenRequest);
    case 'browser.interact':
      return harness.browser.interact(request as import('@sos-2/harness').BrowserInteractRequest);
    case 'git.status':
      return harness.git.status(request as import('@sos-2/harness').GitStatusRequest);
    case 'git.diff':
      return harness.git.diff(request as import('@sos-2/harness').GitDiffRequest);
    case 'git.commit':
      return harness.git.commit(request as import('@sos-2/harness').GitCommitRequest);
    case 'git.push':
      return harness.git.push(request as import('@sos-2/harness').GitPushRequest);
    case 'git.createBranch':
      return harness.git.createBranch(request as import('@sos-2/harness').GitCreateBranchRequest);
    case 'git.createPullRequest':
      return harness.git.createPullRequest(request as import('@sos-2/harness').GitCreatePullRequestRequest);
    case 'artifacts.capture':
      return harness.artifacts.capture(request as import('@sos-2/harness').ArtifactsCaptureRequest);
    case 'observations.emit':
      return harness.observations.emit(request as import('@sos-2/harness').ObservationsEmitRequest);
    case 'events.subscribe':
      return harness.events.subscribe(request as import('@sos-2/harness').EventsSubscribeRequest);
  }
}

/** Serve a HarnessContract as the SDK-shaped typed transport. */
export function inProcessNativeApiTransport(harness: HarnessContract): NativeApiTransport {
  return {
    createTask: (request) => harness.createTask(request),
    resumeTask: (request) => harness.resumeTask(request),
    pauseTask: (request) => harness.pauseTask(request),
    cancelTask: (request) => harness.cancelTask(request),
    workspace: {
      read: (request) => harness.workspace.read(request),
      write: (request) => harness.workspace.write(request),
    },
    shell: {
      exec: (request) => harness.shell.exec(request),
    },
    browser: {
      open: (request) => harness.browser.open(request),
      interact: (request) => harness.browser.interact(request),
    },
    git: {
      status: (request) => harness.git.status(request),
      diff: (request) => harness.git.diff(request),
      commit: (request) => harness.git.commit(request),
      push: (request) => harness.git.push(request),
      createBranch: (request) => harness.git.createBranch(request),
      createPullRequest: (request) => harness.git.createPullRequest(request),
    },
    artifacts: {
      capture: (request) => harness.artifacts.capture(request),
    },
    observations: {
      emit: (request) => harness.observations.emit(request),
    },
    events: {
      subscribe: (request) => harness.events.subscribe(request),
    },
  };
}

/** Serve a HarnessContract as the MCP tool-protocol transport. */
export function inProcessMcpTransport(harness: HarnessContract): McpProtocolTransport {
  const advertised = new Set<string>(advertisedOperations(harness.capabilities()).map(toolNameForOperation));
  return {
    listTools(): readonly import('./shapes/mcp.js').McpToolDescriptor[] {
      // The tool list mirrors the contract's BINDING advertisement (honest:
      // a tool the provider session does not carry is not listed).
      return harnessToolDescriptors().filter((tool) => advertised.has(tool.name));
    },
    callTool(call: McpToolCall): McpToolResult {
      const operation = operationForToolName(call.name);
      if (operation === null) {
        return { status: 'UNSUPPORTED_TOOL', message: `no §9 harness operation maps to tool ${JSON.stringify(call.name)}` };
      }
      if (!advertised.has(call.name)) {
        return { status: 'UNSUPPORTED_TOOL', message: `tool ${JSON.stringify(call.name)} is not carried by this provider session's advertisement` };
      }
      const violation = harnessRequestViolation(operation, call.arguments);
      if (violation !== null || typeof call.arguments !== 'object' || call.arguments === null) {
        return { status: 'ERROR', message: violation ?? 'tool arguments must be the typed request object' };
      }
      const result = dispatchOperation(harness, operation, call.arguments as object);
      if (result.status === 'UNSUPPORTED') {
        return { status: 'UNSUPPORTED_TOOL', message: result.reason };
      }
      if (result.status === 'FAILED') {
        return { status: 'ERROR', message: result.error };
      }
      return { status: 'OK', result: structuredClone(result.value) as unknown as JsonValue };
    },
  };
}

/** Serve a HarnessContract as the local companion/service-bridge transport. */
export function inProcessLocalBridgeTransport(harness: HarnessContract): LocalBridgeTransport {
  const advertised = new Set<string>(advertisedOperations(harness.capabilities()).map(bridgeCommandForOperation));
  return {
    dispatch(command: BridgeCommand): BridgeReply {
      const operation = operationForBridgeCommand(command.command);
      if (operation === null) {
        return { status: 'UNKNOWN_COMMAND', message: `no §9 harness operation maps to command ${JSON.stringify(command.command)}` };
      }
      if (!advertised.has(command.command)) {
        return { status: 'UNKNOWN_COMMAND', message: `command ${JSON.stringify(command.command)} is not carried by this provider session's advertisement` };
      }
      const violation = harnessRequestViolation(operation, command.body);
      if (violation !== null || typeof command.body !== 'object' || command.body === null) {
        return { status: 'ERROR', message: violation ?? 'the command body must be the typed request object' };
      }
      const result = dispatchOperation(harness, operation, command.body as object);
      if (result.status === 'UNSUPPORTED') {
        return { status: 'UNKNOWN_COMMAND', message: result.reason };
      }
      if (result.status === 'FAILED') {
        return { status: 'ERROR', message: result.error };
      }
      return { status: 'OK', body: structuredClone(result.value) as unknown as JsonValue };
    },
  };
}
