/**
 * The §9 harness operation vocabulary (Work Order P5) — the exact operation
 * list of spec/productization-execution-architecture.md section 9:
 *
 *   identity()  capabilities()  createTask()  resumeTask()  pauseTask()
 *   cancelTask()  workspace.read()  workspace.write()  shell.exec()
 *   browser.open()  browser.interact()  git.status()  git.diff()
 *   git.commit()  git.push()  git.createBranch()  git.createPullRequest()
 *   artifacts.capture()  observations.emit()  events.subscribe()
 *
 * "Not every body must support every operation. Unsupported capabilities
 * remain explicit." — the operation name vocabulary below is CLOSED: an
 * operation outside it is not part of the harness contract.
 */

/** The closed §9 operation vocabulary (dotted names mirror the contract surface). */
export const HARNESS_OPERATIONS = [
  'createTask',
  'resumeTask',
  'pauseTask',
  'cancelTask',
  'workspace.read',
  'workspace.write',
  'shell.exec',
  'browser.open',
  'browser.interact',
  'git.status',
  'git.diff',
  'git.commit',
  'git.push',
  'git.createBranch',
  'git.createPullRequest',
  'artifacts.capture',
  'observations.emit',
  'events.subscribe',
] as const;

export type HarnessOperationName = (typeof HARNESS_OPERATIONS)[number];

const OPERATION_SET: ReadonlySet<string> = new Set(HARNESS_OPERATIONS);

/** Is this a §9 operation name? */
export function isHarnessOperation(value: unknown): value is HarnessOperationName {
  return typeof value === 'string' && OPERATION_SET.has(value);
}

/** Workspace operation vocabulary (filesystem access, §1). */
export const WORKSPACE_OPERATIONS = ['read', 'write'] as const;
export type WorkspaceOperation = (typeof WORKSPACE_OPERATIONS)[number];

/** Shell operation vocabulary (terminal access, §1). */
export const SHELL_OPERATIONS = ['exec'] as const;
export type ShellOperation = (typeof SHELL_OPERATIONS)[number];

/** Browser operation vocabulary (browser/UI interaction, §1). */
export const BROWSER_OPERATIONS = ['open', 'interact'] as const;
export type BrowserOperation = (typeof BROWSER_OPERATIONS)[number];

/** Git operation vocabulary (repository operations, §1). */
export const GIT_OPERATIONS = ['status', 'diff', 'commit', 'push', 'createBranch', 'createPullRequest'] as const;
export type GitOperation = (typeof GIT_OPERATIONS)[number];

/** Browser interaction vocabulary — provider-neutral, closed. */
export const BROWSER_ACTIONS = ['click', 'type', 'read'] as const;
export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

const BROWSER_ACTION_SET: ReadonlySet<string> = new Set(BROWSER_ACTIONS);

/** Is this a browser interaction action? */
export function isBrowserAction(value: unknown): value is BrowserAction {
  return typeof value === 'string' && BROWSER_ACTION_SET.has(value);
}
