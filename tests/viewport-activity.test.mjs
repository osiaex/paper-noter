import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { intervalLength, mergeIntervals, synchronizedAnimationDelay } from "../src/coverage.js";

// Exercise the real viewer control flow with a held API response, without
// loading extension APIs or making paid model requests.
const source = await readFile(new URL("../src/viewer.js", import.meta.url), "utf8");
const analyze = source.slice(source.indexOf("async function analyzeCurrentRegion("), source.indexOf("\nfunction findUnderlineInCurrentFocus("));
const render = source.slice(source.indexOf("function renderSentCoverage("), source.indexOf("\nfunction findAnnotationsAtPoint("));

function setup(mode) {
  const layer = { children: [], replaceChildren() { this.children = []; }, append(node) { this.children.push(node); } };
  const state = {
    analysisEnabled: true, documentId: "paper", readerSettings: { viewportPayloadMode: mode },
    regionSignatures: new Set(), inFlightSignatures: new Set(), activeViewportRegions: new Map(), analysisTasks: new Map(),
    memory: { reserveCoverage: async () => [[.2, .6]] },
    pages: new Map([[1, { element: { querySelector: () => layer } }]]),
  };
  let nextId = 0;
  const requests = [];
  const failures = [];
  const region = { page: 1, normalized: [0, .2, 1, .6], image: mode === "image" ? "data:image/png;base64,AA==" : null,
    spans: [{ id: "p1s0", text: "source text", box: [.1, .3, .4, .4] }] };
  const context = vm.createContext({
    state, document: { createElement: () => ({ style: {} }) }, performance, TextEncoder,
    SENT_COVERAGE_FULL_CYCLE_MS: 1250, mergeIntervals, synchronizedAnimationDelay, intervalLength,
    console: { error() {} }, ui: { analysisState: {} },
    findUnderlineInCurrentFocus: () => null, beginAnalysisProgress: () => ++nextId,
    loadApiSettings: async () => ({ endpoint: "test", model: "test", apiKey: "test" }),
    getCurrentRegion: async () => region, getCoverageEpoch: () => 0, simpleHash: (s) => s,
    setStatus() {}, setAnalysisProgress() {}, finishAnalysisProgress() {}, clearError() {}, showError() {},
    failAnalysisProgress: (_id, error) => failures.push(error),
    formatBytes: String, estimateDataUrlBytes: () => 1, precisionLabel: () => "test", responseLanguageInstruction: () => "",
    requestVision: () => { const request = Promise.withResolvers(); requests.push(request); return request.promise; },
    extractAssistantText: (r) => r, parseJsonResponse: JSON.parse,
    hasSubstantiveText: () => false, renderPageAnnotations() {},
    saveAnnotations: async () => {
      assert.ok(layer.children.length > 0, "activity must remain visible while saving annotations");
      return 1;
    },
  });
  vm.runInContext(`${render}\n${analyze}`, context);
  context.completeTaskCoverage = async () => context.renderSentCoverage(1);
  return { context, state, layer, requests, failures, region };
}

async function waitForRequests(harness, count) {
  for (let i = 0; i < 30 && harness.requests.length < count; i += 1) await Promise.resolve();
  assert.equal(harness.requests.length, count, "analysis must reach the API request");
}

for (const mode of ["image", "text"]) {
  for (const fails of [false, true]) {
    test(`${mode} mode shows activity while pending and clears it after ${fails ? "failure" : "saving"}`, async () => {
      const h = setup(mode);
      const running = h.context.analyzeCurrentRegion();
      await waitForRequests(h, 1);
      assert.equal(h.layer.children.length, 1);
      assert.equal(h.layer.children[0].style.top, "20%");
      assert.ok(Math.abs(parseFloat(h.layer.children[0].style.height) - 40) < 1e-8);
      if (fails) h.requests[0].reject(new Error("test failure"));
      else h.requests[0].resolve('{"annotations":[]}');
      await running;
      assert.equal(h.failures.length, fails ? 1 : 0);
      assert.equal(h.layer.children.length, 0);
      assert.equal(h.state.activeViewportRegions.size, 0);
    });
  }
}

test("finishing one overlapping task keeps the other task's activity visible", async () => {
  const h = setup("image");
  const first = h.context.analyzeCurrentRegion();
  await waitForRequests(h, 1);
  const second = h.context.analyzeCurrentRegion({ regionOverride: { ...h.region, normalized: [0, .4, 1, .8] } });
  await waitForRequests(h, 2);
  assert.equal(h.layer.children.length, 1, "overlapping regions should share a single animation");
  h.requests[0].resolve('{"annotations":[]}');
  await first;
  assert.equal(h.state.activeViewportRegions.size, 1);
  assert.equal(h.layer.children[0].style.top, "40%");
  h.requests[1].resolve('{"annotations":[]}');
  await second;
  assert.equal(h.layer.children.length, 0);
});

test("another document's activity is not shown on the current PDF", () => {
  const h = setup("image");
  h.state.activeViewportRegions.set(1, { documentId: "other", page: 1, intervals: [[.2, .6]] });
  h.context.renderSentCoverage(1);
  assert.equal(h.layer.children.length, 0);
});

test("a skipped, already annotated view does not start flashing", async () => {
  const h = setup("image");
  h.context.findUnderlineInCurrentFocus = () => ({ kind: "term", content: { label: "term" } });
  await h.context.analyzeCurrentRegion();
  assert.equal(h.requests.length, 0);
  assert.equal(h.layer.children.length, 0);
});
