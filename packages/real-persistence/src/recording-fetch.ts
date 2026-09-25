/**
 * The recording FetchPort — wraps an injected FetchPort so that every
 * REAL HTTP round-trip performed by a real-persistence adapter is
 * recorded as a redacted transcript entry at the true network boundary
 * (the exact P17-C discipline: the adapters' clients stay pure; the
 * recording wrapper is the one seam where evidence is captured).
 *
 * The wrapper never inspects credential headers (they are replaced by
 * env-name references inside the recorder) and never mutates the
 * request; a transport failure is recorded with status null and
 * re-thrown untouched.
 */

import type { FetchPort, HttpRequest, HttpResponse } from './http.js';
import type { PersistenceTranscriptRecorder } from './transcript.js';
import type { Clock } from '@sos-2/live-store';

export interface RecordingFetchPortDeps {
  /** The provider label for transcript entries ('neon' | 'upstash' | 'r2'). */
  readonly provider: string;
  /** The inner (real or scripted) FetchPort. */
  readonly inner: FetchPort;
  /** The redacted transcript recorder. */
  readonly transcript: PersistenceTranscriptRecorder;
  /** The injected clock (transcript instants; no hidden time). */
  readonly clock: Clock;
}

/** Wrap a FetchPort with redacted transcript recording (the evidence seam). */
export function createRecordingFetchPort(deps: RecordingFetchPortDeps): FetchPort {
  const { provider, inner, transcript, clock } = deps;
  return async (request: HttpRequest): Promise<HttpResponse> => {
    try {
      const response = await inner(request);
      transcript.record({
        at: new Date(clock.nowEpochMs()).toISOString(),
        provider,
        request,
        response,
        transportError: null,
      });
      return response;
    } catch (error) {
      transcript.record({
        at: new Date(clock.nowEpochMs()).toISOString(),
        provider,
        request,
        response: null,
        transportError: error instanceof Error ? error.message : 'unspecified transport failure',
      });
      throw error;
    }
  };
}
