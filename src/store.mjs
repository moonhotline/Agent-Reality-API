import { mkdir, readdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const recordDigest = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');
export class EvidenceStore {
  constructor(config) { this.config = config; this.index = new Map(); this.queue = Promise.resolve(); this.timer = null; }
  path(id) { return join(this.config.dataDir, `${id}.json`); }
  async init() {
    await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
    const files = await readdir(this.config.dataDir);
    for (const file of files) {
      if (file.endsWith('.tmp')) { await unlink(join(this.config.dataDir, file)); continue; }
      const id = file.replace(/\.json$/, '');
      if (!file.endsWith('.json') || !ID.test(id)) continue;
      const envelope = JSON.parse(await readFile(this.path(id), 'utf8'));
      if (envelope.record?.evidence_id !== id || typeof envelope.owner !== 'string' || !Number.isFinite(Date.parse(envelope.record.expires_at)) || recordDigest(envelope.record) !== envelope.sha256) throw new Error(`Evidence integrity failure: ${id}. Restore or inspect this record before restarting.`);
      this.index.set(id, { owner: envelope.owner, expires: Date.parse(envelope.record.expires_at) });
    }
    await this.cleanup();
    this.timer = setInterval(() => this.serial(() => this.cleanup()).catch(() => { console.error(JSON.stringify({ event: 'evidence_cleanup_failed' })); }), 60000);
    this.timer.unref();
    return this;
  }
  serial(fn) { const work = this.queue.then(fn); this.queue = work.catch(() => {}); return work; }
  async cleanup(now = Date.now()) {
    for (const [id, entry] of this.index) if (entry.expires <= now) {
      await unlink(this.path(id)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      this.index.delete(id);
    }
  }
  async save(owner, record) {
    return this.serial(async () => {
      await this.cleanup();
      if (this.index.size >= this.config.maxEvidence || [...this.index.values()].filter(e => e.owner === owner).length >= this.config.maxClientEvidence) throw new AppError('EVIDENCE_CAPACITY', 'Evidence storage quota is full; wait for records to expire or increase the configured capacity.', 503, true);
      const envelope = { owner, record, sha256: recordDigest(record) };
      const temporary = join(this.config.dataDir, `${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(envelope));
        await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, this.path(record.evidence_id));
        if (process.platform !== 'win32') {
          const directory = await open(this.config.dataDir, 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } finally {
        if (handle) await handle.close();
        await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; });
      }
      this.index.set(record.evidence_id, { owner, expires: Date.parse(record.expires_at) });
      return { record, integrity: { algorithm: 'sha256', digest: envelope.sha256, scope: 'UTF-8 JSON.stringify(record)', attestation: false } };
    });
  }
  async get(owner, id) {
    if (!ID.test(id)) throw new AppError('EVIDENCE_NOT_FOUND', 'Evidence is missing, expired, or belongs to another client.', 404);
    const entry = this.index.get(id);
    if (!entry || entry.owner !== owner || entry.expires <= Date.now()) throw new AppError('EVIDENCE_NOT_FOUND', 'Evidence is missing, expired, or belongs to another client.', 404);
    let envelope;
    try { envelope = JSON.parse(await readFile(this.path(id), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') throw new AppError('EVIDENCE_NOT_FOUND', 'Evidence is no longer available.', 404); throw e; }
    if (envelope.owner !== owner || recordDigest(envelope.record) !== envelope.sha256) throw new AppError('EVIDENCE_CORRUPT', 'Stored evidence did not pass its integrity check.', 500);
    return { record: envelope.record, integrity: { algorithm: 'sha256', digest: envelope.sha256, scope: 'UTF-8 JSON.stringify(record)', attestation: false } };
  }
  async close() { clearInterval(this.timer); await this.queue; }
}
