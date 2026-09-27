/**
 * The dogfood journey GitHub provider (Work Order P19) — the P19-owned
 * composition seam over @sos-2/real-github's RealGitHubProvider.
 *
 * WHY THIS SEAM EXISTS (the real-GitHub discovery defect, found by the
 * RUN_REAL run 1 itself): the frozen journey consumes discovery summaries
 * through the GitHubPort contract and refuses a NON-EMPTY repository;
 * REAL GitHub answers `default_branch: "main"` and a NON-NULL `pushed_at`
 * (the creation instant) even on a freshly created repository with ZERO
 * commits, so the provider's discovery heuristic (`size === 0 &&
 * pushed_at === null`) misreads a REAL empty repository as non-empty and
 * the journey honestly refuses to continue.
 *
 * THE FIX (composition-owned, provider-owned code untouched): this seam
 * re-derives the TARGET repository's emptiness with the authoritative
 * probe the provider itself uses at snapshot time — the branches listing
 * (a REAL empty repository has no branches at all; `GET /branches`
 * answers 200 with `[]`). Everything else is the provider's own surface,
 * delegated by inheritance: nothing is re-implemented, nothing is
 * fabricated, and the deterministic scripted world (whose summaries carry
 * `pushed_at: null` for empty repositories) is unaffected — the branches
 * re-probe only runs when the provider's own heuristic answered
 * non-empty, and the scripted decoy non-empty repository answers the
 * branches listing with its real branch.
 */

import { RealGitHubProvider } from '@sos-2/real-github';

/** The discovery outcome type of the wrapped provider (derived, never re-declared). */
type DiscoveryOutcome = Awaited<ReturnType<RealGitHubProvider['discoverRepositories']>>;

/** The dogfood target repository coordinates (structural — the GitHubPort RepositoryId shape). */
export interface DogfoodTargetRepository {
  readonly owner: string;
  readonly name: string;
}

export class DogfoodJourneyGitHubProvider extends RealGitHubProvider {
  private readonly dogfoodTargetRepository: DogfoodTargetRepository;

  constructor(
    options: ConstructorParameters<typeof RealGitHubProvider>[0],
    targetRepository: DogfoodTargetRepository,
  ) {
    super(options);
    this.dogfoodTargetRepository = targetRepository;
  }

  /**
   * Discovery with the AUTHORITATIVE empty-repository discrimination for
   * the dogfood target repository: when the provider's heuristic answered
   * non-empty, the branches listing settles it (200 + zero branches ⇒
   * empty — the would-be default_branch/pushed_at of a fresh repository
   * are NOT revisions). An inconclusive branches probe leaves the
   * provider's own honest answer in place (never a fabricated emptiness).
   */
  override async discoverRepositories(): Promise<DiscoveryOutcome> {
    const outcome = await super.discoverRepositories();
    if (outcome.status !== 'OK') {
      return outcome;
    }
    const summaries = [...outcome.result];
    const index = summaries.findIndex(
      (summary) => summary.id.owner === this.dogfoodTargetRepository.owner && summary.id.name === this.dogfoodTargetRepository.name,
    );
    const summary = index === -1 ? undefined : summaries[index];
    if (summary !== undefined && !summary.is_empty) {
      const branches = await this.listBranches({ owner: this.dogfoodTargetRepository.owner, name: this.dogfoodTargetRepository.name });
      if (branches.status === 'OK' && branches.result.length === 0) {
        summaries[index] = { ...summary, is_empty: true, default_branch: null, pushed_at: null };
      }
    }
    return { status: 'OK', result: summaries };
  }
}
