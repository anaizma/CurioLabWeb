// -------------------------------------------------------------------------
// Object storage seam for signed enrollment forms (coupling D, step 1).
//
// The service depends only on the StorageAdapter interface; the concrete
// backend is injected. Tests use InMemoryStorageAdapter. The production R2
// backend is a documented deferred stub (no network in this milestone).
//
// A stored object is addressed by an opaque `ref` (a uuid). That is exactly the
// shape `enrollment_record.signed_form_ref` and `consent.source_ref` expect
// (both uuid), so the ref threads straight through the database rows. A real R2
// adapter maps the uuid to its object key internally.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'

export interface PutObjectInput {
  /** A human-meaningful storage key/path (audit-friendly); not the DB ref. */
  key: string
  body: Uint8Array | Buffer | string
  contentType?: string
}

export interface StorageAdapter {
  /** Store an object; returns its opaque ref (a uuid) for the DB rows. */
  putObject(input: PutObjectInput): Promise<string>
  /** A time-limited read URL for a stored object. */
  getSignedUrl(ref: string): Promise<string>
  /**
   * Best-effort compensation: remove an object whose enclosing enrollment
   * transaction aborted, so a rolled-back coupling D leaves nothing dangling.
   * Optional because the core contract is put + getSignedUrl; a backend without
   * delete simply relies on a storage lifecycle rule to reap orphans.
   */
  deleteObject?(ref: string): Promise<void>
}

interface StoredBlob {
  key: string
  body: Uint8Array
  contentType?: string
}

function toBytes(body: Uint8Array | Buffer | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body
}

/**
 * An in-memory StorageAdapter for tests. Deterministic, no IO, and it exposes
 * `size`/`has` so a test can prove an orphaned upload was compensated after a
 * rolled-back transaction.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, StoredBlob>()

  async putObject(input: PutObjectInput): Promise<string> {
    const ref = randomUUID()
    this.store.set(ref, {
      key: input.key,
      body: toBytes(input.body),
      contentType: input.contentType,
    })
    return ref
  }

  async getSignedUrl(ref: string): Promise<string> {
    if (!this.store.has(ref)) throw new Error(`no such object: ${ref}`)
    return `memory://${ref}`
  }

  async deleteObject(ref: string): Promise<void> {
    this.store.delete(ref)
  }

  /** Number of stored objects (test visibility only). */
  get size(): number {
    return this.store.size
  }

  has(ref: string): boolean {
    return this.store.has(ref)
  }
}

export interface R2Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * DEFERRED STUB — the Cloudflare R2 adapter. Milestone 1 step 2 does no network
 * IO; the real presigned-PUT/GET implementation (and the § 312.8(c) written
 * assurance from Cloudflare, compliance-coppa.md 1.7) land with the HTTP layer.
 * Every method throws so a mis-wired production path fails loudly rather than
 * silently dropping a signed form.
 */
export class R2StorageAdapter implements StorageAdapter {
  constructor(private readonly config: R2Config) {}

  private notImplemented(): never {
    void this.config
    throw new Error(
      'R2StorageAdapter is a deferred stub (Milestone 1 step 2): no network IO. ' +
        'Wire the real R2 client with the HTTP layer.',
    )
  }

  putObject(): Promise<string> {
    return this.notImplemented()
  }
  getSignedUrl(): Promise<string> {
    return this.notImplemented()
  }
  deleteObject(): Promise<void> {
    return this.notImplemented()
  }
}
