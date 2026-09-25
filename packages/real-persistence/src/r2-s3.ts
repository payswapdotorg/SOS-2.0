/**
 * THE REAL R2 S3 SEAM (Work Order P17-A): the S3-compatible API against
 * the Cloudflare R2 endpoint, with AWS Signature V4 signing implemented
 * on node:crypto — ZERO external dependencies (no AWS SDK: the smallest
 * real footprint that still proves the S3 contract, per the work
 * order's free-tier limits rule).
 *
 * Supported operations (exactly what the object-store port + the
 * write-once evidence contract need):
 *   - ListBuckets     GET  /                     (bucket discovery)
 *   - CreateBucket    PUT  /<bucket>             (provisioning)
 *   - HeadBucket      HEAD /<bucket>             (probe)
 *   - PutObject       PUT  /<bucket>/<key>       (create-only objects)
 *   - GetObject       GET  /<bucket>/<key>       (byte-exact read-back)
 *   - HeadObject      HEAD /<bucket>/<key>       (existence + size)
 *   - DeleteObject    DELETE /<bucket>/<key>     (the documented
 *                     retention path ONLY — never called from request
 *                     paths; the adapter exposes it separately from the
 *                     frozen port)
 *   - ListObjectsV2   GET  /<bucket>?list-type=2 (verification)
 *
 * REAL, and honest about it:
 *   - every request goes to the REAL R2 S3 endpoint
 *     (https://<account>.r2.cloudflarestorage.com by default);
 *   - the access key id / secret access key are INJECTED by the caller
 *     and live ONLY inside the SigV4 signature computation (the signed
 *     Authorization header is replaced by the R2_ACCESS_KEY_ID env NAME
 *     in transcripts);
 *   - a transport failure is a typed TransportError the adapter maps to
 *     honest UNAVAILABLE — never a fabricated success;
 *   - XML responses are parsed with a minimal bounded reader (bucket
 *     names, object keys/sizes, error codes) — no XML dependency.
 *
 * Determinism discipline: the fetch seam is INJECTABLE; the deterministic
 * suites script it (SigV4 is computed against the scripted seam's clock
 * — the signer takes the clock as an injected instant, so signature
 * inputs are deterministic in reference mode). This file is the
 * package's documented network boundary for R2.
 */

import { createHash, createHmac } from 'node:crypto';
import { TransportError } from './http.js';
import type { FetchPort, HttpRequest, HttpResponse } from './http.js';

/** The default R2 S3 endpoint template (account-scoped). */
export function r2DefaultEndpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** A recorded S3 round-trip (method + path + status — never the signing material). */
export interface RecordedR2Request {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** A typed R2 S3 failure (mapped to honest UNAVAILABLE by the adapter). */
export class R2S3Error extends Error {
  readonly status: number | null;
  /** The S3 error code parsed from the XML error body, when present. */
  readonly s3ErrorCode: string | null;

  constructor(message: string, status: number | null, s3ErrorCode: string | null) {
    super(message);
    this.name = 'R2S3Error';
    this.status = status;
    this.s3ErrorCode = s3ErrorCode;
  }
}

export interface R2S3ClientOptions {
  /** The R2 account id. */
  readonly accountId: string;
  /** The S3 access key id VALUE (injected by the caller from the environment). */
  readonly accessKeyId: string;
  /** The S3 secret access key VALUE (injected by the caller from the environment). */
  readonly secretAccessKey: string;
  /** The injectable network seam. The ONLY place this client touches the network. */
  readonly fetch: FetchPort;
  /** The S3 endpoint base URL (default: the account-scoped R2 endpoint). */
  readonly endpoint?: string;
  /** The signing region (R2 contract: 'auto'). */
  readonly region?: string;
}

/** One bucket identity from ListBuckets. */
export interface R2BucketIdentity {
  readonly name: string;
  readonly creationDate: string | null;
}

/** One object summary from ListObjectsV2. */
export interface R2ObjectSummary {
  readonly key: string;
  readonly sizeBytes: number;
  readonly lastModified: string | null;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The fetch-backed R2 S3 client with AWS SigV4 signing — the REAL
 * object-store seam of the P17-A adapter. Deterministic when a scripted
 * FetchPort is injected (the signing instant is passed per request);
 * real only when the global-fetch port is attached in the integration
 * suite.
 */
export class R2S3Client {
  private readonly accountId: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly fetch: FetchPort;
  private readonly endpoint: string;
  private readonly region: string;
  private readonly recorded: RecordedR2Request[] = [];

  constructor(options: R2S3ClientOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('R2S3Client requires an options object');
    }
    for (const field of ['accountId', 'accessKeyId', 'secretAccessKey'] as const) {
      const value = options[field];
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`R2S3Client requires a non-empty ${field} (fail closed — never an empty credential)`);
      }
    }
    this.accountId = options.accountId;
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.fetch = options.fetch;
    this.endpoint = (options.endpoint ?? r2DefaultEndpoint(options.accountId)).replace(/\/+$/, '');
    this.region = options.region ?? 'auto';
  }

  /** The recorded request log (method + path + status; never bodies, never signing material). */
  recordedRequests(): readonly RecordedR2Request[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  // ------------------------------------------------------------ bucket ops

  /** ListBuckets — GET / (the bucket discovery probe). */
  async listBuckets(signingInstant: Date): Promise<R2BucketIdentity[]> {
    const response = await this.signedRequest('GET', '/', {}, null, signingInstant, '/');
    this.requireOk(response, 'list buckets');
    return parseListBuckets(responseTextOf(response));
  }

  /** CreateBucket — PUT /<bucket> (idempotent per S3 semantics: re-creating an owned bucket returns OK on R2). */
  async createBucket(bucket: string, signingInstant: Date): Promise<void> {
    this.assertBucketName(bucket);
    const response = await this.signedRequest('PUT', `/${bucket}`, {}, null, signingInstant, `/${bucket}`);
    this.requireOk(response, `create bucket ${bucket}`);
  }

  /** HeadBucket — HEAD /<bucket> (the cheap reachability probe). */
  async headBucket(bucket: string, signingInstant: Date): Promise<boolean> {
    this.assertBucketName(bucket);
    const response = await this.signedRequest('HEAD', `/${bucket}`, {}, null, signingInstant, `/${bucket}`);
    if (response.status >= 200 && response.status < 300) {
      return true;
    }
    const error = this.parseS3Error(response);
    if (error?.code === 'NoSuchBucket' || response.status === 404) {
      return false;
    }
    throw new R2S3Error(`head bucket ${bucket} failed with HTTP ${String(response.status)}`, response.status, error?.code ?? null);
  }

  /** ListObjectsV2 under a prefix (verification; bounded pages). */
  async listObjects(bucket: string, prefix: string, signingInstant: Date, maxKeys = 100): Promise<R2ObjectSummary[]> {
    this.assertBucketName(bucket);
    const path = `/${bucket}`;
    const query = `list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=${String(maxKeys)}`;
    const response = await this.signedRequest('GET', `${path}?${query}`, {}, null, signingInstant, path, query);
    this.requireOk(response, `list objects in ${bucket}`);
    return parseListObjects(responseTextOf(response));
  }

  // ------------------------------------------------------------ object ops

  /** PutObject — PUT /<bucket>/<key> with raw bytes (create-only per the write-once contract). */
  async putObject(bucket: string, key: string, bytes: Uint8Array, signingInstant: Date): Promise<void> {
    this.assertBucketName(bucket);
    this.assertObjectKey(key);
    const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const response = await this.signedRequest('PUT', path, {}, bytes, signingInstant, path);
    this.requireOk(response, `put object ${bucket}/${key}`);
  }

  /** GetObject — GET /<bucket>/<key> (byte-exact read-back), or null when absent. */
  async getObject(bucket: string, key: string, signingInstant: Date): Promise<Uint8Array | null> {
    this.assertBucketName(bucket);
    this.assertObjectKey(key);
    const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const response = await this.signedRequest('GET', path, {}, null, signingInstant, path);
    if (response.status === 404) {
      const error = this.parseS3Error(response);
      if (error === null || error.code === 'NoSuchKey') {
        return null;
      }
    }
    this.requireOk(response, `get object ${bucket}/${key}`);
    return response.bytes;
  }

  /** HeadObject — HEAD /<bucket>/<key> (existence + size), or null when absent. */
  async headObject(bucket: string, key: string, signingInstant: Date): Promise<{ sizeBytes: number } | null> {
    this.assertBucketName(bucket);
    this.assertObjectKey(key);
    const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const response = await this.signedRequest('HEAD', path, {}, null, signingInstant, path);
    if (response.status === 404) {
      return null;
    }
    this.requireOk(response, `head object ${bucket}/${key}`);
    const length = response.headers['content-length'];
    const size = length === undefined ? 0 : Number.parseInt(length, 10);
    return { sizeBytes: Number.isFinite(size) ? size : 0 };
  }

  /**
   * DeleteObject — DELETE /<bucket>/<key>. THE DOCUMENTED RETENTION
   * PATH ONLY (the P3 R2_IMMUTABILITY_CONTRACT: deletion happens only
   * through the documented retention policy; no ad-hoc delete from
   * request paths). The adapter exposes this OUTSIDE the frozen port.
   */
  async deleteObject(bucket: string, key: string, signingInstant: Date): Promise<void> {
    this.assertBucketName(bucket);
    this.assertObjectKey(key);
    const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const response = await this.signedRequest('DELETE', path, {}, null, signingInstant, path);
    this.requireOk(response, `delete object ${bucket}/${key}`);
  }

  // ------------------------------------------------------------ signing

  /**
   * One SigV4-signed S3 request. The signing instant is INJECTED per
   * call (deterministic in reference mode; the real composition passes
   * the system clock's current instant). The canonical path/query are
   * passed separately from the URL because S3 signing canonicalizes
   * them (unencoded path for bucket/key, sorted query).
   */
  private async signedRequest(
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    urlPathAndQuery: string,
    headers: Record<string, string>,
    body: Uint8Array | null,
    signingInstant: Date,
    canonicalPath: string,
    canonicalQuery?: string,
  ): Promise<HttpResponse> {
    const url = new URL(`${this.endpoint}${urlPathAndQuery}`);
    const amzDate = signingInstant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const dateStamp = amzDate.slice(0, 8);
    // The REAL payload hash (empty-string hash for bodyless requests; the
    // body's hash when bytes are sent) — correct SigV4 for both S3 and R2.
    const payloadHash = body === null ? sha256Hex('') : sha256Hex(body);
    const host = url.host;
    const signedHeadersList = ['host', 'x-amz-content-sha256', 'x-amz-date'];
    const canonicalHeaders =
      `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQuery ?? '',
      canonicalHeaders,
      signedHeadersList.join(';'),
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeadersList.join(';')}, Signature=${signature}`;
    const request: HttpRequest = {
      method,
      url: url.toString(),
      headers: {
        ...headers,
        // The signing material is injected here and ONLY here — never
        // logged, never echoed (the transcript recorder replaces the
        // whole Authorization header with the R2_ACCESS_KEY_ID env NAME).
        authorization,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        ...(body !== null ? { 'content-length': String(body.byteLength) } : {}),
      },
      body,
    };
    const pathForLog = `${url.pathname}${url.search}`;
    try {
      const response = await this.fetch(request);
      this.recorded.push({ method, path: pathForLog, status: response.status });
      return response;
    } catch (error) {
      this.recorded.push({ method, path: pathForLog, status: 0 });
      if (error instanceof TransportError) {
        throw error;
      }
      throw new TransportError(`r2 s3 transport failure: ${(error as Error).message}`);
    }
  }

  private requireOk(response: HttpResponse, what: string): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    const error = this.parseS3Error(response);
    throw new R2S3Error(
      `${what} failed with HTTP ${String(response.status)}${error?.code !== undefined ? ` (S3 code ${error.code})` : ''}: ${error?.message ?? 'unspecified provider error'}`,
      response.status,
      error?.code ?? null,
    );
  }

  private parseS3Error(response: HttpResponse): { code: string; message: string } | null {
    if (response.status >= 200 && response.status < 300) {
      return null;
    }
    const text = responseTextOf(response);
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    const message = /<Message>([^<]*)<\/Message>/.exec(text)?.[1];
    if (code === undefined && message === undefined) {
      return null;
    }
    return { code: code ?? '', message: message ?? '' };
  }

  private assertBucketName(bucket: string): void {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error(`R2 bucket name '${bucket}' violates the S3 bucket naming convention`);
    }
  }

  private assertObjectKey(key: string): void {
    if (key.length === 0 || key.startsWith('/') || key.includes('..') || key.includes('//')) {
      throw new Error(`R2 object key '${key}' is malformed (empty segments/path traversal rejected)`);
    }
  }
}

// ---------------------------------------------------------------- XML readers

/** Decode a response body as UTF-8 text (bounded; pure). */
function responseTextOf(response: HttpResponse): string {
  return new TextDecoder('utf-8').decode(response.bytes);
}

/** Parse ListAllMyBucketsResult buckets (minimal bounded reader — no XML dependency). */
export function parseListBuckets(xml: string): R2BucketIdentity[] {
  const buckets: R2BucketIdentity[] = [];
  const bucketPattern = /<Bucket><CreationDate>([^<]*)<\/CreationDate><Name>([^<]+)<\/Name><\/Bucket>/g;
  let match = bucketPattern.exec(xml);
  while (match !== null) {
    buckets.push({ name: match[2]!, creationDate: match[1]!.length > 0 ? match[1]! : null });
    match = bucketPattern.exec(xml);
  }
  return buckets;
}

/** Parse ListBucketResult contents (minimal bounded reader — no XML dependency). */
export function parseListObjects(xml: string): R2ObjectSummary[] {
  const objects: R2ObjectSummary[] = [];
  const objectPattern = /<Contents><Key>([^<]+)<\/Key><LastModified>([^<]*)<\/LastModified><ETag>[^<]*<\/ETag><Size>(\d+)<\/Size>(?:<StorageClass>[^<]*<\/StorageClass>)?<\/Contents>/g;
  let match = objectPattern.exec(xml);
  while (match !== null) {
    objects.push({
      key: match[1]!,
      sizeBytes: Number.parseInt(match[3]!, 10),
      lastModified: match[2]!.length > 0 ? match[2]! : null,
    });
    match = objectPattern.exec(xml);
  }
  return objects;
}

/** Construct the R2 S3 client (the real object-store seam). */
export function createR2S3Client(options: R2S3ClientOptions): R2S3Client {
  return new R2S3Client(options);
}
