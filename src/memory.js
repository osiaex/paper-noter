import { mergeIntervals, subtractCoverage, subtractIntervals } from "./coverage.js";

const encoder = new TextEncoder();

export class PaperMemory {
  constructor(documentId) {
    this.documentId = documentId;
    this.annotations = new Map();
    this.questions = new Map();
    this.bubbleAnnotations = new Map();
    this.events = [];
    this.dir = null;
    this.writeChain = Promise.resolve();
    this.coverage = { schemaVersion: 2, completed: {}, sent: {} };
  }

  async init(meta) {
    const root = await navigator.storage.getDirectory();
    const memoryRoot = await root.getDirectoryHandle("paper-memory", { create: true });
    this.dir = await memoryRoot.getDirectoryHandle(this.documentId, { create: true });
    await this.#writeMeta(meta);
    await this.#loadEvents();
    await this.#loadCoverage();
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

  async #loadCoverage() {
    const handle = await this.dir.getFileHandle("coverage.json", { create: true });
    const file = await handle.getFile();
    if (!file.size) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.completed && typeof parsed.completed === "object") {
        this.coverage = {
          schemaVersion: 2,
          completed: parsed.completed,
          sent: parsed.sent && typeof parsed.sent === "object" ? parsed.sent : {},
        };
      } else if (parsed?.pages && typeof parsed.pages === "object") {
        this.coverage = { schemaVersion: 2, completed: parsed.pages, sent: {} };
      }
    } catch (error) {
      console.warn("Skipped invalid coverage file", error);
    }
  }

  #apply(event) {
    if (event.event === "bubble_annotation_upsert") {
      this.bubbleAnnotations.set(event.id, event);
      return;
    }
    if (event.event === "bubble_question_upsert" || event.event === "bubble_detail") {
      const bindingKey = event.binding_key || JSON.stringify([
        event.parent_annotation_id || "",
        ...(Array.isArray(event.concept_path) ? event.concept_path : []),
      ]);
      if (bindingKey) this.questions.set(bindingKey, event);
      return;
    }
    if (event.event === "annotation_delete") this.annotations.delete(event.id);
    if (event.event?.endsWith("_upsert")) this.annotations.set(event.id, event);
  }

  append(event) {
    const operation = this.writeChain.then(() => this.#appendNow(event));
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  async #appendNow(event) {
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

  getQuestion(bindingKey) {
    return this.questions.get(bindingKey) || null;
  }

  getBubbleAnnotations(bindingKey) {
    return [...this.bubbleAnnotations.values()].filter((event) => event.binding_key === bindingKey);
  }

  getCoverage(page) {
    return mergeIntervals(this.coverage.completed[String(page)] || []);
  }

  getSentCoverage(page) {
    return mergeIntervals(this.coverage.sent[String(page)] || []);
  }

  reserveCoverage(page, target) {
    const operation = this.writeChain.then(async () => {
      const key = String(page);
      const completed = this.coverage.completed[key] || [];
      const sent = this.coverage.sent[key] || [];
      const reserved = subtractCoverage(target, [...completed, ...sent]);
      if (!reserved.length) return [];
      this.coverage.sent[key] = mergeIntervals([...sent, ...reserved]);
      await this.#writeCoverage();
      return reserved;
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  completeCoverage(page, intervals) {
    const operation = this.writeChain.then(async () => {
      const key = String(page);
      this.coverage.completed[key] = mergeIntervals([...(this.coverage.completed[key] || []), ...intervals]);
      this.coverage.sent[key] = subtractIntervals(this.coverage.sent[key] || [], intervals);
      if (!this.coverage.sent[key].length) delete this.coverage.sent[key];
      await this.#writeCoverage();
      return this.coverage.completed[key];
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  clearCoverage(page, intervals) {
    const operation = this.writeChain.then(async () => {
      const key = String(page);
      this.coverage.completed[key] = subtractIntervals(this.coverage.completed[key] || [], intervals);
      this.coverage.sent[key] = subtractIntervals(this.coverage.sent[key] || [], intervals);
      if (!this.coverage.completed[key].length) delete this.coverage.completed[key];
      if (!this.coverage.sent[key].length) delete this.coverage.sent[key];
      await this.#writeCoverage();
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  resetAndReserveCoverage(page, target) {
    const operation = this.writeChain.then(async () => {
      const key = String(page);
      const reserved = mergeIntervals([target]);
      this.coverage.completed[key] = subtractIntervals(this.coverage.completed[key] || [], reserved);
      this.coverage.sent[key] = subtractIntervals(this.coverage.sent[key] || [], reserved);
      if (!this.coverage.completed[key].length) delete this.coverage.completed[key];
      this.coverage.sent[key] = mergeIntervals([...(this.coverage.sent[key] || []), ...reserved]);
      await this.#writeCoverage();
      return reserved;
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  resetSentCoverage() {
    const operation = this.writeChain.then(async () => {
      this.coverage.sent = {};
      await this.#writeCoverage();
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  async #writeCoverage() {
    const handle = await this.dir.getFileHandle("coverage.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(this.coverage));
    await writable.close();
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
