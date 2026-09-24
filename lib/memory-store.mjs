// In-memory stand-in for a Netlify Blobs store (the subset lib/app.mjs uses).
// Used for local development and tests; data is lost when the process exits.
export class MemoryStore {
  #data = new Map();
  #tick = 0;
  async getWithMetadata(key) {
    await null;
    const entry = this.#data.get(key);
    return entry ? { data: JSON.parse(entry.json), etag: entry.etag, metadata: {} } : null;
  }
  async setJSON(key, value, { onlyIfMatch, onlyIfNew } = {}) {
    await null;
    const current = this.#data.get(key);
    if (onlyIfNew && current) return { modified: false };
    if (onlyIfMatch && current?.etag !== onlyIfMatch) return { modified: false };
    const etag = `"${++this.#tick}"`;
    this.#data.set(key, { json: JSON.stringify(value), etag });
    return { modified: true, etag };
  }
  async delete(key) { this.#data.delete(key); }
  async list() { return { blobs: [...this.#data].map(([key, { etag }]) => ({ key, etag })), directories: [] }; }
}
