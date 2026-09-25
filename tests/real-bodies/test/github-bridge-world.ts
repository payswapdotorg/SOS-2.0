/**
 * The deterministic scripted request port of the real-bodies suites
 * (Work Order P17-B) — the same offline fixed-order seam as
 * tests/real-github's world, duplicated here because test packages are
 * independent (the P8/P15 suite-isolation precedent).
 */

import type { GitHubProviderRequest, GitHubProviderResponse, GitHubRequestPort } from '@sos-2/real-github';

/** One scripted response (consumed in fixed order). */
export interface ScriptedEntry {
  readonly status: number;
  readonly body: unknown;
}

/** The scripted request port — deterministic, offline, ordered. */
export class ScriptedGitHubRequestPort implements GitHubRequestPort {
  readonly requests: GitHubProviderRequest<unknown>[] = [];
  private readonly queue: ScriptedEntry[];

  constructor(entries: readonly ScriptedEntry[]) {
    this.queue = [...entries];
  }

  async request<TBody, TResult>(request: GitHubProviderRequest<TBody>): Promise<GitHubProviderResponse<TResult>> {
    this.requests.push(request as GitHubProviderRequest<unknown>);
    const entry = this.queue.shift();
    if (entry === undefined) {
      return { status: 500, body: ({ message: 'the scripted port is exhausted — a deterministic defect in the test fixture' } as unknown) as TResult };
    }
    return { status: entry.status, body: (entry.body as TResult | null) ?? null };
  }
}
