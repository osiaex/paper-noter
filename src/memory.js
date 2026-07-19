const encoder = new TextEncoder();

export class PaperMemory {
  constructor(documentId) {
    this.documentId = documentId;
    this.annotations = new Map();
    this.events = [];
    this.dir = null;
  }

  async init(meta) {
    const root = await navigator.storage.getDirectory();
    const memoryRoot = await root.getDirectoryHandle("paper-memory", { create: true });
    this.dir = await memoryRoot.getDirectoryHandle(this.documentId, { create: true });
    await this.#writeMeta(meta);
    await this.#loadEvents();
    return this;
  }

  async #writeMeta(meta) {
    const handle = await this.dir.getFileHandle("meta.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ schemaVersion: 1, documentId: this.documentId, ...meta }, null, 2));
    await writable.close();
  }

  async #loadEvents() {
    const handle = await this.dir.getFileHandle("memory.jsonl", { create: true });
    const file = await handle.getFile();
    const text = await file.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        this.events.push(event);
        this.#apply(event);
      } catch (error) {
        console.warn("Skipped invalid memory line", error);
      }
    }
  }

  #apply(event) {
    if (event.event === "annotation_delete") this.annotations.delete(event.id);
    if (event.event?.endsWith("_upsert")) this.annotations.set(event.id, event);
  }

  async append(event) {
    const enriched = {
      schema_version: 1,
      created_at: new Date().toISOString(),
      ...event,
    };
    const handle = await this.dir.getFileHandle("memory.jsonl", { create: true });
    const file = await handle.getFile();
    const writable = await handle.createWritable({ keepExistingData: true });
    await writable.seek(file.size);
    await writable.write(encoder.encode(`${JSON.stringify(enriched)}\n`));
    await writable.close();
    this.events.push(enriched);
    this.#apply(enriched);
    return enriched;
  }

  list() {
    return [...this.annotations.values()];
  }

  async saveAsset(blob, filename) {
    const assets = await this.dir.getDirectoryHandle("assets", { create: true });
    const handle = await assets.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return `assets/${filename}`;
  }

  async exportJsonl() {
    const handle = await this.dir.getFileHandle("memory.jsonl", { create: true });
    return handle.getFile();
  }
}

export async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
