/**
 * THE HOSTED MODEL PORT (Work Order P17-B) — the injectable seam the
 * hosted coding-harness body drives a REAL coding-capable model API
 * through.
 *
 * WHY AN ASYNC PORT: the frozen P5 §9 HarnessContract is SYNCHRONOUS by
 * design (bodies are in-process mechanisms; the ASYNC fabric/broker
 * wrap them), while a real hosted model API is a network call. The
 * composed answer is the P8 sync-seam discipline, verbatim: the async
 * engine runs at the COMPOSITION boundary (the operator drives
 * `runWorkProgram` — the body's documented execution engine), and every
 * result flows back through the sync §9 surface (events, workspace
 * files, artifacts, git status). The model call is always REAL when the
 * real client is attached (openrouter-client.ts) and always SCRIPTED in
 * the deterministic suites (ScriptedHostedModelPort — offline,
 * fixed-seed).
 *
 * THE MODEL IS A MECHANISM, NEVER AN AUTHORITY: model output is parsed
 * into bounded file edits inside the body's sandbox; it is never
 * authoritative evidence (§10 — the independent evaluator gates
 * completion, pinned by test).
 */

/** One hosted-model completion request. */
export interface HostedModelRequest {
  /** The model id to request (e.g. 'openai/gpt-5.1-codex-mini'). */
  readonly model: string;
  /** The system-level instructions (the harness execution-contract preamble). */
  readonly instructions: string;
  /** The user prompt (the work program + current workspace state). */
  readonly prompt: string;
  /** The token ceiling, or null for the provider default. */
  readonly max_tokens: number | null;
  /** The sampling temperature, or null for the provider default. */
  readonly temperature: number | null;
}

/** The usage the provider reported (provider facts — real evidence). */
export interface HostedModelUsage {
  readonly prompt_tokens: number | null;
  readonly completion_tokens: number | null;
  readonly total_tokens: number | null;
}

/** One hosted-model completion response (provider facts). */
export interface HostedModelResponse {
  /** The provider's response id (real evidence). */
  readonly id: string;
  /** The model the provider reports actually served (may differ from the request). */
  readonly model: string;
  /** The generated content. */
  readonly content: string;
  /** The provider's finish reason, or null. */
  readonly finish_reason: string | null;
  /** The provider-reported token usage, or null when unreported. */
  readonly usage: HostedModelUsage | null;
}

/** The typed failure of one hosted-model call (an HONEST failure, never fabricated success). */
export interface HostedModelError {
  /** HTTP-like status (0 = network failure before a response). */
  readonly status: number;
  /** The failure kind. */
  readonly kind: 'NETWORK' | 'AUTH' | 'RATE_LIMIT' | 'PROVIDER' | 'PARSE';
  /** The honest message (never carries credentials). */
  readonly message: string;
}

/** The typed outcome of one hosted-model call. */
export type HostedModelCall =
  | { readonly ok: true; readonly response: HostedModelResponse }
  | { readonly ok: false; readonly error: HostedModelError };

/**
 * THE HOSTED MODEL PORT — one completion call. Implementations: the REAL
 * OpenRouter client (openrouter-client.ts) and the deterministic
 * ScriptedHostedModelPort (tests).
 */
export interface HostedModelPort {
  complete(request: HostedModelRequest): Promise<HostedModelCall>;
}

/** One scripted response entry of the deterministic model port. */
export interface ScriptedModelEntry {
  /** Matches by request index (the nth call), or by model id when `for_model` is set. */
  readonly for_model?: string;
  readonly respond: HostedModelResponse | { readonly fail: HostedModelError };
}

/**
 * The deterministic scripted model port — offline, fixed-seed suites. The
 * entries are consumed in order; a request without a matching entry
 * answers an honest typed PROVIDER failure (never a fabricated success).
 */
export class ScriptedHostedModelPort implements HostedModelPort {
  private readonly entries: readonly ScriptedModelEntry[];
  private nextIndex = 0;
  /** The requests received (audit probe — never carries credentials). */
  readonly requests: HostedModelRequest[] = [];

  constructor(entries: readonly ScriptedModelEntry[]) {
    this.entries = [...entries];
  }

  async complete(request: HostedModelRequest): Promise<HostedModelCall> {
    this.requests.push({ ...request });
    const byOrder = this.entries[this.nextIndex];
    this.nextIndex += 1;
    const entry = byOrder?.for_model === undefined || byOrder.for_model === request.model ? byOrder : undefined;
    if (entry === undefined) {
      return {
        ok: false,
        error: {
          status: 503,
          kind: 'PROVIDER',
          message: `the scripted model port has no scripted response for call ${this.nextIndex} (model ${JSON.stringify(request.model)}) — the honest answer is this typed failure, never a fabricated success`,
        },
      };
    }
    const scripted = entry.respond;
    if ('fail' in scripted) {
      return { ok: false, error: scripted.fail };
    }
    return { ok: true, response: { ...scripted } };
  }
}

/** The structured file edit the work-program protocol asks the model for. */
export interface WorkProgramFileEdit {
  readonly path: string;
  readonly contents: string;
}

/** The parsed work-program output. */
export interface WorkProgramOutput {
  readonly files: readonly WorkProgramFileEdit[];
  readonly summary: string;
}

/**
 * Parse the model's work-program output. The protocol asks for ONE JSON
 * object: { "files": [{ "path": "...", "contents": "..." }], "summary":
 * "..." }. Parsing is honest and bounded:
 *
 *   - the whole content, then a fenced ```json block, then the outermost
 *     brace span are tried, in order;
 *   - malformed output, a non-object, or a missing files array answers
 *     null (the engine reports an honest FAILED run — never a fabricated
 *     success, never a crash);
 *   - entries are validated (non-empty path, string contents) and paths
 *     are normalized to be workspace-relative and traversal-free.
 */
export function parseWorkProgramOutput(content: string): WorkProgramOutput | null {
  const candidates: string[] = [content];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  if (fenced !== null && fenced[1] !== undefined) {
    candidates.push(fenced[1].trim());
  }
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first !== -1 && last > first) {
    candidates.push(content.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record['files'])) {
      continue;
    }
    const files: WorkProgramFileEdit[] = [];
    let malformed = false;
    for (const entry of record['files']) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        malformed = true;
        break;
      }
      const file = entry as Record<string, unknown>;
      if (typeof file['path'] !== 'string' || typeof file['contents'] !== 'string') {
        malformed = true;
        break;
      }
      const normalized = normalizeWorkspacePath(file['path']);
      if (normalized === null) {
        malformed = true;
        break;
      }
      files.push({ path: normalized, contents: file['contents'] });
    }
    if (malformed) {
      continue;
    }
    const summary = typeof record['summary'] === 'string' ? record['summary'] : '';
    return { files, summary };
  }
  return null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Normalize a model-proposed path to a safe workspace-relative path (or null when unusable). */
export function normalizeWorkspacePath(path: string): string | null {
  if (path.length === 0 || path.includes('\0')) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return null;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    return null;
  }
  return segments.join('/');
}
