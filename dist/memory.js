import { mergeIntervals, subtractCoverage, subtractIntervals } from "./coverage.js";

const encoder = new TextEncoder();
const MEMORY_FORMAT = "paper-noter-memory";
const PORTABLE_EVENTS = new Set([
  "annotation_upsert",
  "annotation_delete",
  "bubble_annotation_upsert",
  "bubble_annotation_delete",
  "bubble_question_upsert",
  "bubble_question_delete",
  "bubble_detail",
  "bubble_delete",
  "image_explanation_upsert",
]);

export function serializeMemoryBundle(documentId, meta, events) {
  const manifest = {
    schema_version: 2,
    event: "paper_memory_manifest",
    format: MEMORY_FORMAT,
    document_id: documentId,
    exported_at: new Date().toISOString(),
    meta: {
      file_name: meta?.fileName || "",
      page_count: Number(meta?.pageCount) || 0,
      binary_sha256: meta?.binarySha256 || "",
      content_fingerprint: meta?.contentFingerprint || "",
      layout_fingerprint: meta?.layoutFingerprint || "",
    },
  };
  return `${[manifest, ...events].map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export function parseMemoryJsonl(text) {
  let manifest = null;
  const events = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Invalid memory JSONL at line ${index + 1}`);
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Invalid memory record at line ${index + 1}`);
    }
    if (record.event === "paper_memory_manifest") {
      if (record.format !== MEMORY_FORMAT || !record.document_id) {
        throw new Error(`Invalid memory manifest at line ${index + 1}`);
      }
      if (manifest) throw new Error("Memory file contains more than one manifest");
      manifest = record;
      continue;
    }
    if (!PORTABLE_EVENTS.has(record.event)) {
      throw new Error(`Unsupported memory event at line ${index + 1}`);
    }
    events.push(record);
  }
  if (!events.length && !manifest) throw new Error("Memory file is empty");
  return { manifest, events };
}

function eventFingerprint(event) {
  const { created_at: _createdAt, schema_version: _schemaVersion, ...content } = event;
  return JSON.stringify(content);
}

export class PaperMemory {
  static async findDocumentByBinary(binarySha256) {
    const root = await navigator.storage.getDirectory();
    const memoryRoot = await root.getDirectoryHandle("paper-memory", { create: true });
    try {
      await memoryRoot.getDirectoryHandle(binarySha256);
      return binarySha256;
    } catch { /* try known binary aliases */ }

    for await (const [name, handle] of memoryRoot.entries()) {
      if (handle.kind !== "directory") continue;
      try {
        const metaHandle = await handle.getFileHandle("meta.json");
        const meta = JSON.parse(await (await metaHandle.getFile()).text());
        if (Array.isArray(meta.binaryAliases) && meta.binaryAliases.includes(binarySha256)) return name;
      } catch { /* ignore incomplete legacy directories */ }
    }
    return null;
  }

  static async resolveDocumentId(binarySha256, layoutFingerprint) {
    const exact = await PaperMemory.findDocumentByBinary(binarySha256);
    if (exact) return exact;
    if (!layoutFingerprint) return binarySha256;

    const root = await navigator.storage.getDirectory();
    const memoryRoot = await root.getDirectoryHandle("paper-memory", { create: true });
    for await (const [name, handle] of memoryRoot.entries()) {
      if (handle.kind !== "directory") continue;
      try {
        const metaHandle = await handle.getFileHandle("meta.json");
        const meta = JSON.parse(await (await metaHandle.getFile()).text());
        if (meta.layoutFingerprint === layoutFingerprint) return name;
      } catch { /* ignore incomplete legacy directories */ }
    }
    return binarySha256;
  }

  constructor(documentId) {
    this.documentId = documentId;
    this.annotations = new Map();
    this.questions = new Map();
    this.bubbleAnnotations = new Map();
    this.deletedBubbles = new Set();
    this.events = [];
    this.dir = null;
    this.meta = {};
    this.writeChain = Promise.resolve();
    this.coverage = { schemaVersion: 2, completed: {}, sent: {} };
  }

  async init(meta) {
    const root = await navigator.storage.getDirectory();
    const memoryRoot = await root.getDirectoryHandle("paper-memory", { create: true });
    this.dir = await memoryRoot.getDirectoryHandle(this.documentId, { create: true });
    const existingMeta = await this.#readMeta();
    const binaryAliases = [...new Set([
      ...(Array.isArray(existingMeta.binaryAliases) ? existingMeta.binaryAliases : []),
      existingMeta.binarySha256,
      meta?.binarySha256,
    ].filter(Boolean))];
    this.meta = { ...existingMeta, ...meta, binaryAliases };
    await this.#writeMeta(this.meta);
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

  async #readMeta() {
    try {
      const handle = await this.dir.getFileHandle("meta.json");
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return {};
    }
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
    if (event.event === "bubble_delete") {
      if (event.binding_key) this.deletedBubbles.add(event.binding_key);
      return;
    }
    if (event.event === "bubble_annotation_delete") {
      if (event.id) this.bubbleAnnotations.delete(event.id);
      return;
    }
    if (event.event === "bubble_question_delete") {
      if (event.binding_key) this.questions.delete(event.binding_key);
      return;
    }
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

  isBubbleDeleted(bindingKey) {
    return this.deletedBubbles.has(bindingKey);
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
    await this.writeChain;
    return new Blob([serializeMemoryBundle(this.documentId, this.meta, this.events)], { type: "application/x-ndjson" });
  }

  async importJsonl(file, { allowLegacy = false } = {}) {
    const parsed = parseMemoryJsonl(await file.text());
    const importedMeta = parsed.manifest?.meta || {};
    const matchesDocument = !parsed.manifest
      || parsed.manifest.document_id === this.documentId
      || (importedMeta.binary_sha256 && this.meta.binaryAliases?.includes(importedMeta.binary_sha256))
      || (importedMeta.layout_fingerprint && importedMeta.layout_fingerprint === this.meta.layoutFingerprint);
    if (!matchesDocument) {
      const error = new Error("MEMORY_DOCUMENT_MISMATCH");
      error.code = "MEMORY_DOCUMENT_MISMATCH";
      throw error;
    }
    if (!parsed.manifest && !allowLegacy) {
      const error = new Error("MEMORY_LEGACY_CONFIRMATION_REQUIRED");
      error.code = "MEMORY_LEGACY_CONFIRMATION_REQUIRED";
      throw error;
    }

    await this.writeChain;
    const existing = new Set(this.events.map(eventFingerprint));
    let imported = 0;
    let skipped = 0;
    for (const event of parsed.events) {
      const fingerprint = eventFingerprint(event);
      if (existing.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      await this.append(event);
      existing.add(fingerprint);
      imported += 1;
    }
    return { imported, skipped, legacy: !parsed.manifest };
  }
}

export async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
