/**
 * The recording FetchPort of the deployment lane — wraps an injected
 * FetchPort so that every REAL HTTP round-trip performed by the Vercel
 * REST client is recorded as a redacted transcript entry at the true
 * network boundary (the P17-A persistence-lane recording seam, mirrored
 * for this lane: the adapters' clients stay pure; the recording wrapper
 * is the one seam where evidence is captured).
 */

import type { FetchPort, HttpRequest, HttpResponse } from './http.js';
import type { DeploymentTranscriptRecorder } from './transcript.js';
import type { Clock } from '@sos-2/live-store';

export interface DeploymentRecordingFetchPortDeps {
  /** The inner (real or scripted) FetchPort. */
  readonly inner: FetchPort;
  /** The redacted transcript recorder. */
  readonly transcript: DeploymentTranscriptRecorder;
  /** The injected clock (transcript instants; no hidden time). */
  readonly clock: Clock;
}

/** Wrap a FetchPort with redacted transcript recording (the evidence seam). */
export function createDeploymentRecordingFetchPort(deps: DeploymentRecordingFetchPortDeps): FetchPort {
  const { inner, transcript, clock } = deps;
  return async (request: HttpRequest): Promise<HttpResponse> => {
    try {
      const response = await inner(request);
      transcript.record({
        at: new Date(clock.nowEpochMs()).toISOString(),
        request,
        response,
        transportError: null,
      });
      return response;
    } catch (error) {
      transcript.record({
        at: new Date(clock.nowEpochMs()).toISOString(),
        request,
        response: null,
        transportError: error instanceof Error ? error.message : 'unspecified transport failure',
      });
      throw error;
    }
  };
}
