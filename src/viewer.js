import * as pdfjsLib from "./vendor/pdf.mjs";
import { extractAssistantText, loadApiSettings, parseJsonResponse, requestVision, saveApiSettings } from "./api.js";
import { PaperMemory, sha256 } from "./memory.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.mjs");

const $ = (selector) => document.querySelector(selector);
const READER_SETTINGS_KEY = "paperMemoryReaderSettings";
const ui = {
  workspace: $("#workspace"), viewer: $("#viewer"), pages: $("#pages"), fileInput: $("#fileInput"),
  openFile: $("#openFile"), emptyOpenFile: $("#emptyOpenFile"), documentTitle: $("#documentTitle"),
  analysisState: $("#analysisState"), toggleAnalysis: $("#toggleAnalysis"), exportMemory: $("#exportMemory"),
  understandImage: $("#understandImage"), selectionOverlay: $("#selectionOverlay"), bubbleLayer: $("#bubbleLayer"),
  settingsButton: $("#settingsButton"), settingsDialog: $("#settingsDialog"), settingsForm: $("#settingsForm"),
  apiEndpoint: $("#apiEndpoint"), apiModel: $("#apiModel"), apiKey: $("#apiKey"), toast: $("#toast"),
  apiTestResult: $("#apiTestResult"), errorPanel: $("#errorPanel"), errorTitle: $("#errorTitle"), errorDetail: $("#errorDetail"),
  focusHeight: $("#focusHeight"), focusHeightValue: $("#focusHeightValue"), showFocusGuide: $("#showFocusGuide"),
  focusGuideMask: $("#focusGuideMask"), focusGuide: $("#focusGuide"),
};

const state = {
  pdf: null, fileName: "", documentId: "", memory: null, pages: new Map(),
  analysisEnabled: true, analysisBusy: false, analysisTimer: 0, viewportRevision: 0, pendingAnalysis: false,
  regionSignatures: new Set(), bubbleStack: [], selectingImage: false,
  readerSettings: { focusHeight: 60, showFocusGuide: false },
};

ui.openFile.addEventListener("click", () => ui.fileInput.click());
ui.emptyOpenFile.addEventListener("click", () => ui.fileInput.click());
ui.fileInput.addEventListener("change", () => ui.fileInput.files?.[0] && openPdf(ui.fileInput.files[0]));
ui.settingsButton.addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", cancelSettings);
$("#cancelSettings").addEventListener("click", cancelSettings);
ui.settingsForm.addEventListener("submit", saveSettingsFromDialog);
ui.settingsDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelSettings(); });
$("#testApi").addEventListener("click", testApiConnection);
$("#errorSettings").addEventListener("click", openSettings);
$("#dismissError").addEventListener("click", clearError);
ui.toggleAnalysis.addEventListener("click", toggleAnalysis);
ui.exportMemory.addEventListener("click", exportMemory);
ui.understandImage.addEventListener("click", beginImageSelection);
ui.viewer.addEventListener("scroll", scheduleAnalysis, { passive: true });
ui.viewer.addEventListener("scroll", updateFocusGuide, { passive: true });
ui.focusHeight.addEventListener("input", previewReaderSettings);
ui.showFocusGuide.addEventListener("change", previewReaderSettings);
window.addEventListener("resize", () => { layoutBubbles(); updateFocusGuide(); scheduleAnalysis(); });
document.addEventListener("keydown", handleKeydown);
loadReaderSettings();

async function openPdf(file) {
  try {
    setStatus("正在打开…", "working");
    closeBubbles();
    state.pages.clear();
    state.regionSignatures.clear();
    ui.pages.replaceChildren();

    const buffer = await file.arrayBuffer();
    state.documentId = await sha256(buffer);
    state.fileName = file.name;
    state.pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: chrome.runtime.getURL("vendor/cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("vendor/standard_fonts/"),
      wasmUrl: chrome.runtime.getURL("vendor/wasm/"),
      iccUrl: chrome.runtime.getURL("vendor/iccs/"),
    }).promise;
    state.memory = await new PaperMemory(state.documentId).init({
      fileName: file.name,
      pageCount: state.pdf.numPages,
      updatedAt: new Date().toISOString(),
    });

    for (const event of state.memory.events) {
      if (event.region_signature) state.regionSignatures.add(event.region_signature);
    }
    await createPagePlaceholders();
    ui.workspace.classList.remove("empty");
    ui.documentTitle.textContent = file.name;
    ui.toggleAnalysis.disabled = false;
    ui.exportMemory.disabled = false;
    ui.understandImage.disabled = false;
    setStatus("本地 memory 已加载", "ready");
    clearError();
    updateFocusGuide();
    scheduleAnalysis(900);
  } catch (error) {
    console.error(error);
    showError("PDF 打开失败", error);
    setStatus("打开失败");
  }
}

async function createPagePlaceholders() {
  for (let pageNumber = 1; pageNumber <= state.pdf.numPages; pageNumber += 1) {
    const page = await state.pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.35 });
    const element = document.createElement("article");
    element.className = "pdf-page";
    element.dataset.page = String(pageNumber);
    element.style.width = `${viewport.width}px`;
    element.style.height = `${viewport.height}px`;
    element.innerHTML = `<canvas></canvas><div class="text-map"></div><div class="annotation-layer"></div>`;
    ui.pages.append(element);
    const record = { pageNumber, page, viewport, element, canvas: element.querySelector("canvas"), textItems: [], rendered: false, rendering: null };
    state.pages.set(pageNumber, record);
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
    }
  }, { root: ui.viewer, rootMargin: "900px 0px" });
  state.pages.forEach(({ element }) => observer.observe(element));
}

async function renderPage(pageNumber) {
  const record = state.pages.get(pageNumber);
  if (!record || record.rendered) return record?.rendering;
  if (record.rendering) return record.rendering;

  record.rendering = (async () => {
    const outputScale = window.devicePixelRatio || 1;
    record.canvas.width = Math.floor(record.viewport.width * outputScale);
    record.canvas.height = Math.floor(record.viewport.height * outputScale);
    record.canvas.style.width = `${record.viewport.width}px`;
    record.canvas.style.height = `${record.viewport.height}px`;
    await record.page.render({
      canvasContext: record.canvas.getContext("2d"),
      viewport: record.viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    }).promise;

    const textContent = await record.page.getTextContent();
    const textMap = record.element.querySelector(".text-map");
    record.textItems = textContent.items.filter((item) => item.str?.trim()).map((item, index) => {
      const transform = pdfjsLib.Util.transform(record.viewport.transform, item.transform);
      const fontHeight = Math.max(5, Math.hypot(transform[2], transform[3]));
      const left = transform[4];
      const top = transform[5] - fontHeight;
      const width = Math.max(2, item.width * record.viewport.scale);
      const height = fontHeight * 1.12;
      const span = document.createElement("span");
      span.className = "text-item";
      span.textContent = item.str;
      Object.assign(span.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, fontSize: `${fontHeight}px` });
      textMap.append(span);
      return {
        id: `p${pageNumber}s${index}`,
        text: item.str,
        box: [left / record.viewport.width, top / record.viewport.height, (left + width) / record.viewport.width, (top + height) / record.viewport.height],
      };
    });
    record.rendered = true;
    renderPageAnnotations(pageNumber);
    return record;
  })().catch((error) => {
    record.rendering = null;
    throw error;
  });
  return record.rendering;
}

function scheduleAnalysis(delay = 650) {
  clearTimeout(state.analysisTimer);
  state.viewportRevision += 1;
  closeBubbles();
  if (!state.analysisEnabled || !state.pdf || state.selectingImage) return;
  if (state.analysisBusy) {
    state.pendingAnalysis = true;
    return;
  }
  state.analysisTimer = setTimeout(() => analyzeCurrentRegion(), delay);
}

function toggleAnalysis() {
  state.analysisEnabled = !state.analysisEnabled;
  ui.toggleAnalysis.textContent = state.analysisEnabled ? "◉" : "○";
  setStatus(state.analysisEnabled ? "智能标注已开启" : "智能标注已暂停", state.analysisEnabled ? "ready" : "");
  if (state.analysisEnabled) scheduleAnalysis(200);
}

async function getCurrentRegion() {
  const viewerRect = ui.viewer.getBoundingClientRect();
  const focusRect = getFocusRect(viewerRect);
  const candidates = [];
  for (const record of state.pages.values()) {
    const rect = record.element.getBoundingClientRect();
    const area = intersectionArea(rect, focusRect);
    if (area > 0) candidates.push({ record, rect, area });
  }
  if (!candidates.length) return null;

  let best = null;
  for (const candidate of candidates.sort((a, b) => b.area - a.area).slice(0, 2)) {
    await renderPage(candidate.record.pageNumber);
    const rect = candidate.record.element.getBoundingClientRect();
    const local = {
      left: clamp(focusRect.left - rect.left, 0, rect.width),
      top: clamp(focusRect.top - rect.top, 0, rect.height),
      right: clamp(focusRect.right - rect.left, 0, rect.width),
      bottom: clamp(focusRect.bottom - rect.top, 0, rect.height),
    };
    const normalized = [local.left / rect.width, local.top / rect.height, local.right / rect.width, local.bottom / rect.height];
    const spans = candidate.record.textItems.filter((item) => boxesIntersect(item.box, normalized));
    const meaningfulCharacters = spans.reduce((sum, span) => sum + span.text.replace(/\s+/g, "").length, 0);
    const score = meaningfulCharacters * 1000 + candidate.area / Math.max(1, rect.width * rect.height);
    if (!best || score > best.score) best = { ...candidate, rect, normalized, spans, score };
  }

  if (!best?.spans.length) return null;
  const image = cropCanvas(best.record.canvas, best.normalized);
  return { page: best.record.pageNumber, record: best.record, spans: best.spans, normalized: best.normalized, image };
}

async function analyzeCurrentRegion() {
  if (!state.analysisEnabled) return;
  if (state.analysisBusy) { state.pendingAnalysis = true; return; }
  state.analysisBusy = true;
  const revision = state.viewportRevision;
  try {
    const settings = await loadApiSettings();
    if (!settings.endpoint || !settings.model || !settings.apiKey) {
      setStatus("请先设置 API");
      return;
    }
    const region = await getCurrentRegion();
    if (!region) return;
    const signature = `${region.page}:${simpleHash(region.spans.map((span) => span.text).join(" "))}`;
    if (state.regionSignatures.has(signature)) {
      setStatus("已从 memory 恢复", "ready");
      return;
    }

    setStatus("正在理解当前视野…", "working");
    const spanPayload = region.spans.map(({ id, text, box }) => ({ id, text, bbox: box }));
    const response = await requestVision([
      {
        role: "system",
        content: "你是学术PDF阅读助手。只分析用户当前视野。选择少量真正关键的重点和需要解释的专业名词。只要视野中存在完整、有语义的学术文本，就至少返回1个标注；只有目录、页眉页脚、参考文献编号或无实质语义内容时才能返回空数组。必须返回严格JSON，不使用Markdown。不要编造原文中不存在的span_id。",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `页面文本片段：${JSON.stringify(spanPayload)}\n返回格式：{"annotations":[{"kind":"term|keypoint","targets":[{"span_id":"...","start":0,"end":4}],"label":"原文名词或重点短标题","explanation":"简洁中文解释","context":"为什么在本文语境重要","secondary_terms":[{"term":"解释中出现的二级名词","explanation":"一句话解释","parent_concept":"上级概念"}]}]}。start/end是对应文本片段中的字符下标，end不包含；重点可覆盖多个完整片段，名词必须精确到词。名词最多5个，重点最多3个。` },
          { type: "image_url", image_url: { url: region.image } },
        ],
      },
    ]);
    if (revision !== state.viewportRevision) { state.pendingAnalysis = true; return; }
    const data = parseJsonResponse(extractAssistantText(response));
    const initialAnnotations = Array.isArray(data.annotations) ? data.annotations : [];
    let accepted = await saveAnnotations(initialAnnotations, region, signature);
    let returned = initialAnnotations.length;

    if (accepted === 0 && hasSubstantiveText(region.spans)) {
      setStatus(returned ? "正在修复标注位置…" : "正在补充最小标注…", "working");
      const repaired = await repairAnnotations(initialAnnotations, region);
      if (revision !== state.viewportRevision) { state.pendingAnalysis = true; return; }
      returned += repaired.length;
      accepted += await saveAnnotations(repaired, region, signature);
    }

    if (accepted > 0) {
      state.regionSignatures.add(signature);
      renderPageAnnotations(region.page);
      setStatus(`模型返回 ${returned} 个 · 绘制 ${accepted} 个`, "ready");
    } else {
      setStatus("本次未生成有效标注，移动视野可重试");
    }
    clearError();
  } catch (error) {
    console.error(error);
    setStatus("分析暂不可用");
    showError("当前视野分析失败", error);
  } finally {
    state.analysisBusy = false;
    if (state.pendingAnalysis && state.analysisEnabled) {
      state.pendingAnalysis = false;
      clearTimeout(state.analysisTimer);
      state.analysisTimer = setTimeout(() => analyzeCurrentRegion(), 180);
    }
  }
}

async function saveAnnotations(annotations, region, signature) {
  let accepted = 0;
  for (const annotation of annotations) {
    if (await saveModelAnnotation(annotation, region, signature)) accepted += 1;
  }
  return accepted;
}

async function repairAnnotations(annotations, region) {
  const spanPayload = region.spans.map(({ id, text }) => ({ id, text }));
  const response = await requestVision([
    {
      role: "system",
      content: "你是JSON标注修复器。只能引用给定的span id。必须返回严格JSON，不使用Markdown。",
    },
    {
      role: "user",
      content: `文本片段：${JSON.stringify(spanPayload)}\n原始候选：${JSON.stringify(annotations)}\n请修复为：{"annotations":[{"kind":"term|keypoint","targets":[{"span_id":"给定id","start":0,"end":4}],"label":"原文中的文字","explanation":"中文解释","context":"本文语境","secondary_terms":[]}]}。如果原始候选为空但文本有学术语义，请选择1至3个最值得标注的内容。start/end必须是对应片段的有效字符下标。`,
    },
  ]);
  const repaired = parseJsonResponse(extractAssistantText(response));
  return Array.isArray(repaired.annotations) ? repaired.annotations : [];
}

function hasSubstantiveText(spans) {
  const text = spans.map((span) => span.text).join(" ").replace(/\s+/g, " ").trim();
  return text.length >= 32 && /[A-Za-z\u4e00-\u9fff]{3}/.test(text);
}

async function saveModelAnnotation(annotation, region, signature) {
  const kind = normalizeAnnotationKind(annotation.kind || annotation.type || annotation.category);
  const targets = normalizeAnnotationTargets(annotation, region, kind);
  const matched = targets.map((target) => {
    const spanId = target.span_id || target.spanId || target.id;
    const item = region.spans.find((candidate) => candidate.id === spanId);
    if (!item) return null;
    const textLength = Math.max(1, item.text.length);
    const numericStart = Number(target.start);
    const numericEnd = Number(target.end);
    const hasRange = Number.isFinite(numericStart) && Number.isFinite(numericEnd) && numericEnd > numericStart;
    let start = clamp(hasRange ? numericStart : 0, 0, textLength);
    let end = clamp(hasRange ? numericEnd : textLength, start, textLength);
    if (kind === "term" && !hasRange) {
      const found = item.text.toLocaleLowerCase().indexOf(String(annotation.label || "").toLocaleLowerCase());
      if (found >= 0) { start = found; end = found + String(annotation.label).length; }
    }
    if (end <= start) return null;
    const [x1, y1, x2, y2] = item.box;
    const width = x2 - x1;
    return { ...item, selectedText: item.text.slice(start, end), box: [x1 + width * start / textLength, y1, x1 + width * end / textLength, y2] };
  }).filter(Boolean);
  if (!matched.length || !kind) return false;
  const label = String(annotation.label || matched.map((item) => item.text).join(" ")).slice(0, 240);
  const id = `${kind}_${region.page}_${simpleHash(`${label}:${JSON.stringify(matched.map((item) => item.box))}`)}`;
  await state.memory.append({
    event: "annotation_upsert", id, kind, page: region.page,
    region_signature: signature,
    anchor: { quote: matched.map((item) => item.selectedText || item.text).join(" "), bboxes: matched.map((item) => item.box) },
    content: {
      label,
      explanation: String(annotation.explanation || ""),
      context: String(annotation.context || ""),
      secondary_terms: normalizeSecondaryTerms(annotation.secondary_terms),
    },
    source: "viewport_mllm",
  });
  return true;
}

function normalizeAnnotationKind(value) {
  const kind = String(value || "").trim().toLocaleLowerCase();
  if (["term", "noun", "concept", "entity", "名词", "术语", "概念"].includes(kind)) return "term";
  if (["keypoint", "key_point", "important", "highlight", "重点", "要点", "关键句"].includes(kind)) return "keypoint";
  return null;
}

function normalizeAnnotationTargets(annotation, region, kind) {
  let targets = [];
  if (Array.isArray(annotation.targets)) targets = annotation.targets;
  else if (Array.isArray(annotation.spans)) targets = annotation.spans;
  else if (Array.isArray(annotation.span_ids)) targets = annotation.span_ids.map((span_id) => ({ span_id }));
  else if (annotation.span_id || annotation.spanId) targets = [{ span_id: annotation.span_id || annotation.spanId, start: annotation.start, end: annotation.end }];

  if (targets.length) return targets.map((target) => typeof target === "string" ? { span_id: target } : target);

  const quote = String(annotation.quote || annotation.text || annotation.label || "").trim();
  if (!quote) return [];
  for (const span of region.spans) {
    const index = span.text.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
    if (index >= 0) return [{ span_id: span.id, start: index, end: index + quote.length }];
  }
  if (kind === "keypoint") {
    const words = quote.split(/\s+/).filter(Boolean);
    const approximate = region.spans.find((span) => words.some((word) => word.length >= 4 && span.text.toLocaleLowerCase().includes(word.toLocaleLowerCase())));
    if (approximate) return [{ span_id: approximate.id }];
  }
  return [];
}

function renderPageAnnotations(pageNumber) {
  const record = state.pages.get(pageNumber);
  if (!record?.rendered || !state.memory) return;
  const layer = record.element.querySelector(".annotation-layer");
  layer.replaceChildren();
  for (const annotation of state.memory.list().filter((item) => item.page === pageNumber)) {
    const boxes = annotation.anchor?.bboxes || (annotation.anchor?.bbox ? [annotation.anchor.bbox] : []);
    for (const box of boxes) {
      const mark = document.createElement("button");
      mark.className = `annotation ${annotation.kind}`;
      mark.title = annotation.content?.label || "查看解释";
      mark.setAttribute("aria-label", mark.title);
      setNormalizedBox(mark, box);
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnnotationBubble(annotation, mark.getBoundingClientRect());
      });
      layer.append(mark);
    }
  }
}

function openAnnotationBubble(annotation, anchorRect) {
  state.bubbleStack = [{
    id: annotation.id,
    title: annotation.content?.label || (annotation.kind === "image" ? "图片解释" : "解释"),
    explanation: annotation.content?.explanation || "暂无解释",
    context: annotation.content?.context || "",
    secondaryTerms: normalizeSecondaryTerms(annotation.content?.secondary_terms),
    annotation,
    anchorRect,
  }];
  renderBubbles();
}

function openChildBubble(parentIndex, term, sourceButton) {
  state.bubbleStack = state.bubbleStack.slice(0, parentIndex + 1);
  state.bubbleStack.push({
    id: `child_${simpleHash(term.term)}`,
    title: term.term,
    explanation: term.explanation || "点击右上角问号获取详细解释。",
    context: term.parent_concept ? `上级概念：${term.parent_concept}` : "",
    secondaryTerms: normalizeSecondaryTerms(term.secondary_terms),
    anchorRect: sourceButton.getBoundingClientRect(),
  });
  renderBubbles();
}

function renderBubbles() {
  ui.bubbleLayer.replaceChildren();
  const start = Math.max(0, state.bubbleStack.length - 3);
  state.bubbleStack.slice(start).forEach((bubble, visibleIndex) => {
    const actualIndex = start + visibleIndex;
    const element = document.createElement("section");
    element.className = "concept-bubble";
    element.dataset.depth = String(actualIndex);
    const path = state.bubbleStack.slice(0, actualIndex + 1).map((item) => item.title).join(" › ");
    element.innerHTML = `<div class="bubble-path"></div><div class="bubble-head"><h3></h3><button class="ask" title="结合当前PDF视野详细解释">?</button><button class="close" title="关闭">×</button></div><div class="bubble-body"></div>`;
    element.querySelector(".bubble-path").textContent = path;
    element.querySelector("h3").textContent = bubble.title;
    renderExplanation(element.querySelector(".bubble-body"), bubble, actualIndex);
    element.querySelector(".ask").addEventListener("click", () => requestDetailedExplanation(actualIndex, element));
    element.querySelector(".close").addEventListener("click", () => {
      state.bubbleStack = state.bubbleStack.slice(0, actualIndex);
      renderBubbles();
    });
    ui.bubbleLayer.append(element);
  });
  layoutBubbles();
}

function renderExplanation(container, bubble, bubbleIndex) {
  const paragraph = document.createElement("div");
  appendTextWithTerms(paragraph, bubble.explanation, bubble.secondaryTerms, (term, button) => openChildBubble(bubbleIndex, term, button));
  container.append(paragraph);
  if (bubble.context) {
    const context = document.createElement("div");
    context.className = "bubble-context";
    context.textContent = bubble.context;
    container.append(context);
  }
}

function appendTextWithTerms(container, text, terms, onClick) {
  let remaining = String(text || "");
  const usable = [...terms].filter((item) => item.term).sort((a, b) => b.term.length - a.term.length);
  while (remaining) {
    let found = null;
    for (const term of usable) {
      const index = remaining.toLocaleLowerCase().indexOf(term.term.toLocaleLowerCase());
      if (index >= 0 && (!found || index < found.index)) found = { term, index };
    }
    if (!found) { container.append(document.createTextNode(remaining)); break; }
    if (found.index) container.append(document.createTextNode(remaining.slice(0, found.index)));
    const button = document.createElement("button");
    button.className = "bubble-term";
    button.textContent = remaining.slice(found.index, found.index + found.term.term.length);
    button.addEventListener("click", () => onClick(found.term, button));
    container.append(button);
    remaining = remaining.slice(found.index + found.term.term.length);
  }
}

function layoutBubbles() {
  const bubbles = [...ui.bubbleLayer.children];
  if (!bubbles.length) return;
  let previousRect = null;
  bubbles.forEach((element, index) => {
    const bubble = state.bubbleStack[state.bubbleStack.length - bubbles.length + index];
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = index === 0 ? bubble.anchorRect.right + 10 : previousRect.right + 10;
    let top = index === 0 ? bubble.anchorRect.top - 58 : previousRect.top + 16;
    if (left + width > window.innerWidth - 12) {
      left = index === 0 ? bubble.anchorRect.left - width - 10 : Math.max(12, previousRect.left - width - 10);
    }
    top = clamp(top, 12, window.innerHeight - 58 - height - 12);
    left = clamp(left, 12, window.innerWidth - width - 12);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    previousRect = { left, top, right: left + width, bottom: top + height };
  });
}

async function requestDetailedExplanation(index, bubbleElement) {
  const bubble = state.bubbleStack[index];
  const body = bubbleElement.querySelector(".bubble-body");
  const oldContent = body.innerHTML;
  body.innerHTML = `<div class="bubble-loading">正在结合当前视野深入解释…</div>`;
  try {
    const region = await getCurrentRegion();
    const bubbleContext = state.bubbleStack.map(({ title, explanation, context }) => ({ title, explanation, context }));
    const response = await requestVision([
      { role: "system", content: "你是严谨的学术概念导师。根据当前PDF视野和已展开概念链，详细解释目标概念。必须返回严格JSON。" },
      { role: "user", content: [
        { type: "text", text: `目标：${bubble.title}\n当前页面文本：${region.spans.map((item) => item.text).join(" ")}\n已展开气泡：${JSON.stringify(bubbleContext)}\n返回：{"explanation":"详细但清晰的解释","context":"它与当前论文内容的关系","secondary_terms":[{"term":"二级名词","explanation":"一句话解释","parent_concept":"上级概念"}]}` },
        { type: "image_url", image_url: { url: region.image } },
      ]},
    ]);
    const data = parseJsonResponse(extractAssistantText(response));
    bubble.explanation = String(data.explanation || bubble.explanation);
    bubble.context = String(data.context || bubble.context);
    bubble.secondaryTerms = normalizeSecondaryTerms(data.secondary_terms);
    await state.memory.append({
      event: "bubble_detail", id: `detail_${Date.now()}`, page: region.page,
      parent_annotation_id: state.bubbleStack[0]?.annotation?.id || null,
      concept_path: state.bubbleStack.slice(0, index + 1).map((item) => item.title),
      content: { label: bubble.title, explanation: bubble.explanation, context: bubble.context, secondary_terms: bubble.secondaryTerms },
      source: "manual_question_mllm",
    });
    renderBubbles();
  } catch (error) {
    body.innerHTML = oldContent;
    toast(error.message, true);
  }
}

function closeBubbles() {
  state.bubbleStack = [];
  ui.bubbleLayer.replaceChildren();
}

function beginImageSelection() {
  state.selectingImage = !state.selectingImage;
  ui.understandImage.classList.toggle("active", state.selectingImage);
  ui.selectionOverlay.classList.toggle("hidden", !state.selectingImage);
  if (!state.selectingImage) ui.selectionOverlay.replaceChildren();
}

let selectionStart = null;
ui.selectionOverlay.addEventListener("pointerdown", (event) => {
  selectionStart = { x: event.clientX, y: event.clientY };
  const box = document.createElement("div");
  box.className = "selection-box";
  ui.selectionOverlay.replaceChildren(box);
  drawSelectionBox(box, selectionStart.x, selectionStart.y, event.clientX, event.clientY);
  ui.selectionOverlay.setPointerCapture(event.pointerId);
});
ui.selectionOverlay.addEventListener("pointermove", (event) => {
  if (!selectionStart) return;
  drawSelectionBox(ui.selectionOverlay.firstElementChild, selectionStart.x, selectionStart.y, event.clientX, event.clientY);
});
ui.selectionOverlay.addEventListener("pointerup", async (event) => {
  if (!selectionStart) return;
  const rect = normalizedClientRect(selectionStart.x, selectionStart.y, event.clientX, event.clientY);
  selectionStart = null;
  if (rect.width < 40 || rect.height < 40) { beginImageSelection(); return; }
  await understandSelectedImage(rect);
  beginImageSelection();
});

async function understandSelectedImage(selectionRect) {
  try {
    let target = null;
    for (const record of state.pages.values()) {
      const rect = record.element.getBoundingClientRect();
      const area = intersectionArea(rect, selectionRect);
      if (!target || area > target.area) target = { record, rect, area };
    }
    if (!target || target.area < 100) throw new Error("请在 PDF 页面内框选图片。 ");
    await renderPage(target.record.pageNumber);
    target.rect = target.record.element.getBoundingClientRect();
    const box = [
      clamp((selectionRect.left - target.rect.left) / target.rect.width, 0, 1),
      clamp((selectionRect.top - target.rect.top) / target.rect.height, 0, 1),
      clamp((selectionRect.right - target.rect.left) / target.rect.width, 0, 1),
      clamp((selectionRect.bottom - target.rect.top) / target.rect.height, 0, 1),
    ];
    setStatus("正在理解图片…", "working");
    const dataUrl = cropCanvas(target.record.canvas, box);
    const nearby = target.record.textItems.filter((item) => boxesIntersect(expandBox(box, .08), item.box)).map((item) => item.text).join(" ");
    const openBubbles = state.bubbleStack.map(({ title, explanation }) => ({ title, explanation }));
    const response = await requestVision([
      { role: "system", content: "你是学术论文图片阅读助手。解释图的阅读顺序、元素含义、结论以及与附近正文的关系。必须返回严格JSON。" },
      { role: "user", content: [
        { type: "text", text: `附近正文：${nearby}\n当前展开概念：${JSON.stringify(openBubbles)}\n返回：{"label":"图片短标题","explanation":"清晰解释","context":"与论文当前内容的关系","secondary_terms":[{"term":"图中专业名词","explanation":"一句话解释","parent_concept":"上级概念"}]}` },
        { type: "image_url", image_url: { url: dataUrl } },
      ]},
    ]);
    const data = parseJsonResponse(extractAssistantText(response));
    const blob = await (await fetch(dataUrl)).blob();
    const assetHash = await sha256(await blob.arrayBuffer());
    const id = `image_${target.record.pageNumber}_${simpleHash(JSON.stringify(box))}`;
    const asset = await state.memory.saveAsset(blob, `${id}.webp`);
    await state.memory.append({
      event: "image_explanation_upsert", id, kind: "image", page: target.record.pageNumber,
      anchor: { bbox: box }, asset, asset_sha256: assetHash,
      content: { label: data.label || `第 ${target.record.pageNumber} 页图片`, explanation: data.explanation || "", context: data.context || "", secondary_terms: normalizeSecondaryTerms(data.secondary_terms) },
      source: "manual_image_mllm",
    });
    renderPageAnnotations(target.record.pageNumber);
    setStatus("图片解释已保存", "ready");
    clearError();
    toast("图片解释已保存到当前 PDF memory");
  } catch (error) {
    console.error(error);
    setStatus("图片理解失败");
    showError("图片理解失败", error);
  }
}

async function openSettings() {
  const settings = await loadApiSettings();
  ui.apiEndpoint.value = settings.endpoint || "";
  ui.apiModel.value = settings.model || "";
  ui.apiKey.value = settings.apiKey || "";
  ui.focusHeight.value = String(state.readerSettings.focusHeight);
  ui.focusHeightValue.value = `${state.readerSettings.focusHeight}%`;
  ui.showFocusGuide.checked = state.readerSettings.showFocusGuide;
  ui.apiTestResult.textContent = "";
  ui.apiTestResult.className = "api-test-result";
  ui.settingsDialog.showModal();
}

async function testApiConnection() {
  const button = $("#testApi");
  button.disabled = true;
  ui.apiTestResult.textContent = "正在测试接口、权限和模型响应…";
  ui.apiTestResult.className = "api-test-result";
  try {
    const saved = await saveApiSettings({ endpoint: ui.apiEndpoint.value.trim(), model: ui.apiModel.value.trim(), apiKey: ui.apiKey.value.trim() });
    ui.apiEndpoint.value = saved.endpoint;
    const testImage = createApiTestImage();
    const response = await requestVision([
      { role: "system", content: "只返回严格JSON，不使用Markdown。" },
      { role: "user", content: [
        { type: "text", text: "这是一次视觉模型连接测试。读取附带的小图片，然后返回 {\"ok\":true,\"message\":\"连接成功\"}" },
        { type: "image_url", image_url: { url: testImage } },
      ] },
    ]);
    const text = extractAssistantText(response);
    parseJsonResponse(text);
    ui.apiTestResult.textContent = "连接成功：接口可访问，模型能返回可解析文本。";
    ui.apiTestResult.className = "api-test-result success";
    clearError();
  } catch (error) {
    ui.apiTestResult.textContent = error.message;
    ui.apiTestResult.className = "api-test-result error";
    showError("API 连接测试失败", error);
  } finally { button.disabled = false; }
}

function createApiTestImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fffef9";
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = "#176b5b";
  context.fillRect(7, 7, 18, 18);
  return canvas.toDataURL("image/png");
}

async function saveSettingsFromDialog(event) {
  event.preventDefault();
  try {
    await saveApiSettings({ endpoint: ui.apiEndpoint.value.trim(), model: ui.apiModel.value.trim(), apiKey: ui.apiKey.value.trim() });
    await saveReaderSettings();
    ui.settingsDialog.close();
    toast("API 设置已保存在本地");
    clearError();
    if (state.pdf) scheduleAnalysis(100);
  } catch (error) { toast(error.message, true); }
}

async function exportMemory() {
  const file = await state.memory.exportJsonl();
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${state.fileName.replace(/\.pdf$/i, "")}.memory.jsonl`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cropCanvas(canvas, normalizedBox) {
  const [x1, y1, x2, y2] = normalizedBox;
  const sx = Math.floor(x1 * canvas.width), sy = Math.floor(y1 * canvas.height);
  const sw = Math.max(1, Math.floor((x2 - x1) * canvas.width));
  const sh = Math.max(1, Math.floor((y2 - y1) * canvas.height));
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const output = document.createElement("canvas");
  output.width = Math.max(16, Math.floor(sw * scale));
  output.height = Math.max(16, Math.floor(sh * scale));
  output.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return output.toDataURL("image/webp", .86);
}

function normalizeSecondaryTerms(terms) {
  return Array.isArray(terms) ? terms.slice(0, 8).map((item) => typeof item === "string" ? { term: item, explanation: "", parent_concept: "" } : {
    term: String(item?.term || ""), explanation: String(item?.explanation || ""), parent_concept: String(item?.parent_concept || ""), secondary_terms: normalizeSecondaryTerms(item?.secondary_terms),
  }).filter((item) => item.term) : [];
}

function handleKeydown(event) {
  if (event.key !== "Escape") return;
  if (state.selectingImage) beginImageSelection();
  else if (state.bubbleStack.length) {
    state.bubbleStack.pop();
    renderBubbles();
  }
}

async function loadReaderSettings() {
  const stored = await chrome.storage.local.get(READER_SETTINGS_KEY);
  const value = stored[READER_SETTINGS_KEY] || {};
  state.readerSettings = {
    focusHeight: clamp(Number(value.focusHeight) || 60, 20, 100),
    showFocusGuide: Boolean(value.showFocusGuide),
  };
  updateFocusGuide();
}

async function saveReaderSettings() {
  state.readerSettings = {
    focusHeight: clamp(Number(ui.focusHeight.value) || 60, 20, 100),
    showFocusGuide: ui.showFocusGuide.checked,
  };
  await chrome.storage.local.set({ [READER_SETTINGS_KEY]: state.readerSettings });
  updateFocusGuide();
}

function previewReaderSettings() {
  state.readerSettings.focusHeight = clamp(Number(ui.focusHeight.value) || 60, 20, 100);
  state.readerSettings.showFocusGuide = ui.showFocusGuide.checked;
  ui.focusHeightValue.value = `${state.readerSettings.focusHeight}%`;
  updateFocusGuide();
}

function getFocusRect(viewerRect = ui.viewer.getBoundingClientRect()) {
  const height = viewerRect.height * state.readerSettings.focusHeight / 100;
  const top = viewerRect.top + (viewerRect.height - height) / 2;
  return {
    left: viewerRect.left,
    right: viewerRect.right,
    top,
    bottom: top + height,
  };
}

async function cancelSettings() {
  await loadReaderSettings();
  ui.settingsDialog.close();
}

function updateFocusGuide() {
  if (!state.pdf || !state.readerSettings.showFocusGuide) {
    ui.focusGuideMask.classList.add("hidden");
    return;
  }
  const viewerRect = ui.viewer.getBoundingClientRect();
  const focusRect = getFocusRect(viewerRect);
  let best = null;
  for (const record of state.pages.values()) {
    const rect = record.element.getBoundingClientRect();
    const area = intersectionArea(rect, focusRect);
    if (!best || area > best.area) best = { rect, area };
  }
  if (!best || best.area <= 0) { ui.focusGuideMask.classList.add("hidden"); return; }
  ui.focusGuideMask.classList.remove("hidden");
  const left = clamp(best.rect.left, viewerRect.left, viewerRect.right);
  const right = clamp(best.rect.right, viewerRect.left, viewerRect.right);
  Object.assign(ui.focusGuide.style, {
    left: `${left}px`,
    top: `${focusRect.top - viewerRect.top}px`,
    width: `${Math.max(0, right - left)}px`,
    height: `${focusRect.bottom - focusRect.top}px`,
  });
}

function setNormalizedBox(element, [x1, y1, x2, y2]) {
  Object.assign(element.style, { left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` });
}
function drawSelectionBox(box, x1, y1, x2, y2) { const rect = normalizedClientRect(x1, y1, x2, y2); Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }); }
function normalizedClientRect(x1, y1, x2, y2) { const left = Math.min(x1, x2), top = Math.min(y1, y2), right = Math.max(x1, x2), bottom = Math.max(y1, y2); return { left, top, right, bottom, width: right - left, height: bottom - top }; }
function intersectionArea(a, b) { const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)); const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); return width * height; }
function boxesIntersect(a, b) { return Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]); }
function expandBox([x1, y1, x2, y2], amount) { return [clamp(x1 - amount, 0, 1), clamp(y1 - amount, 0, 1), clamp(x2 + amount, 0, 1), clamp(y2 + amount, 0, 1)]; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function simpleHash(value) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function setStatus(text, className = "") { ui.analysisState.textContent = text; ui.analysisState.className = `status ${className}`.trim(); }
let toastTimer;
function toast(message, error = false) { clearTimeout(toastTimer); ui.toast.textContent = message; ui.toast.className = `toast show${error ? " error" : ""}`; toastTimer = setTimeout(() => { ui.toast.className = "toast"; }, 4200); }
function showError(title, error) {
  const detail = error?.message || String(error || "未知错误");
  ui.errorTitle.textContent = title;
  ui.errorDetail.textContent = detail;
  ui.errorPanel.classList.remove("hidden");
  ui.errorPanel.title = detail;
  toast(detail, true);
}
function clearError() { ui.errorPanel.classList.add("hidden"); ui.errorDetail.textContent = ""; }
