/**
 * Typed harness operation results (Work Order P5).
 *
 * spec/productization-execution-architecture.md §9: "Not every body must
 * support every operation. Unsupported capabilities remain explicit."
 *
 * Every §9 operation answers EXACTLY one of three typed outcomes — never a
 * silent failure, never a thrown error for an expected refusal:
 *
 *   OK           the operation ran and succeeded (availability SUCCESS)
 *   FAILED       the operation RAN and failed — truthful (availability
 *                FAILURE); refusing-to-run and running-and-failing are
 *                distinct facts (the W12 discipline)
 *   UNSUPPORTED  the operation is NOT advertised by the binding capability
 *                advertisement — explicit, typed (availability
 *                UNSUPPORTED)
 *
 * The availability values come from the frozen six-state truth vocabulary
 * consumed from @sos-2/semantic-spine (SUCCESS/FAILURE/UNSUPPORTED here;
 * UNAVAILABLE belongs to the broker/fabric plane when a body cannot be
 * reached at all).
 */

import type { EvidenceTruthState } from '@sos-2/semantic-spine';
import type { HarnessOperationName } from './operations.js';

/** The typed result of one §9 harness operation. */
export type HarnessResult<T> =
  | {
      /** The operation ran and succeeded. */
      readonly status: 'OK';
      readonly availability: Extract<EvidenceTruthState, 'SUCCESS'>;
      readonly value: T;
    }
  | {
      /** The operation RAN and failed — truthful failure, never a conflation with refusal. */
      readonly status: 'FAILED';
      readonly availability: Extract<EvidenceTruthState, 'FAILURE'>;
      readonly error: string;
      readonly value: null;
    }
  | {
      /** The operation is explicitly NOT SUPPORTED by the advertisement. */
      readonly status: 'UNSUPPORTED';
      readonly availability: Extract<EvidenceTruthState, 'UNSUPPORTED'>;
      readonly operation: HarnessOperationName;
      readonly reason: string;
      readonly value: null;
    };

/** Construct an OK result. */
export function harnessOk<T>(value: T): HarnessResult<T> {
  return { status: 'OK', availability: 'SUCCESS', value };
}

/** Construct a FAILED result (the operation ran and failed — truthful). */
export function harnessFailed<T>(error: string): HarnessResult<T> {
  return { status: 'FAILED', availability: 'FAILURE', error, value: null };
}

/** Construct the typed UNSUPPORTED result for an unadvertised operation. */
export function harnessUnsupported<T>(operation: HarnessOperationName, reason: string): HarnessResult<T> {
  return { status: 'UNSUPPORTED', availability: 'UNSUPPORTED', operation, reason, value: null };
}
