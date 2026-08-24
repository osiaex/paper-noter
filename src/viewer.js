import * as pdfjsLib from "./vendor/pdf.mjs";
import { authorizeApiProfile, extractAssistantText, loadApiProfileStore, loadApiSettings, parseJsonResponse, requestVision, saveApiProfileStore } from "./api.js";
import { PaperMemory, sha256 } from "./memory.js";
import { pdfFileName } from "./pdf-routing.js";
import { intervalLength, synchronizedAnimationDelay } from "./coverage.js";
import { buildQuickLink, normalizeQuickLinkSettings, validateQuickLinkSettings } from "./quick-links.js";
import { expandRangeToMathTokens, tokenizeMath } from "./math.js";
import { findExactTermRange, isAnnotationAnchorConsistent } from "./annotation-anchor.js";
import { computePdfIdentity } from "./pdf-identity.js";
import { resolvePdfTitle } from "./pdf-title.js";
import { calculateCanvasResolution, effectiveDisplayScale } from "./render-resolution.js";
import { render as renderMath } from "./vendor/katex/katex.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.mjs");

const $ = (selector) => document.querySelector(selector);
const READER_SETTINGS_KEY = "paperMemoryReaderSettings";
const VIEWPORT_SETTLE_MS = 500;
const SENT_COVERAGE_FULL_CYCLE_MS = 1250;
const IMAGE_PRECISION = {
  low: { maxSide: 768, quality: .58 },
  balanced: { maxSide: 1152, quality: .72 },
  high: { maxSide: 1600, quality: .86 },
};
const UI_TEXT = {
  zh: {
    apiProfiles: "API 配置",
    activeApiProfile: "当前启用的 API",
    openPdf: "打开 PDF", noPaper: "尚未打开文档", waitingPdf: "等待 PDF", understandImage: "理解图片",
    emptyDescription: "直接打开网页或本地 PDF 即可自动进入阅读器，也可以在这里手动选择文件。", choosePdf: "选择 PDF",
    connectModel: "连接模型", apiSettings: "API 设置", endpoint: "OpenAI 兼容接口地址", modelName: "模型名称",
    privacy: "Key 仅保存在浏览器本地。图片和当前视野文本只会在触发分析时发往你填写的接口。",
    interfaceLanguage: "界面语言", language: "语言", showStatusBubble: "显示顶部状态气泡", focusRange: "视野范围", faster: "更快 · 20%", moreContext: "更多上下文 · 100%", showFocus: "显示视野边框，并稍微调暗视野外内容",
    payloadHeading: "自动分析发送内容", textOnly: "仅发送文本", textOnlyHint: "速度更快，不上传视野截图", textImage: "文本 + 视野截图", textImageHint: "适合公式、版式与图文混排内容", imagePrecision: "截图精度", precisionLow: "低 · 最长边 768px", precisionBalanced: "标准 · 最长边 1152px", precisionHigh: "高 · 最长边 1600px", payloadHint: "仅影响自动视野分析；气泡问号和“理解图片”仍会按需发送图片。",
    quickLinks: "名词气泡快速链接", searchService: "搜索服务", quickLinkLabel: "灰色标题名称", quickLinkTemplate: "搜索 URL 模板",
    testConnection: "测试连接", cancel: "取消", save: "保存", analysisFailed: "分析失败", checkApi: "检查 API 设置",
  },
  en: {
    apiProfiles: "API profiles",
    activeApiProfile: "Active API",
    openPdf: "Open PDF", noPaper: "No document open", waitingPdf: "Waiting for PDF", understandImage: "Understand image",
    emptyDescription: "Open a web or local PDF directly, or choose a file here.", choosePdf: "Choose PDF",
    connectModel: "Connect model", apiSettings: "API settings", endpoint: "OpenAI-compatible endpoint", modelName: "Model name",
    privacy: "Your key is stored only in this browser. Images and viewport text are sent only when analysis is triggered.",
    interfaceLanguage: "Interface language", language: "Language", showStatusBubble: "Show the top status bubble", focusRange: "Viewport range", faster: "Faster · 20%", moreContext: "More context · 100%", showFocus: "Show the viewport border and dim content outside it",
    payloadHeading: "Automatic analysis payload", textOnly: "Text only", textOnlyHint: "Faster; does not upload a viewport image", textImage: "Text + viewport image", textImageHint: "Best for formulas, layout, and mixed visual content", imagePrecision: "Image precision", precisionLow: "Low · longest side 768px", precisionBalanced: "Balanced · longest side 1152px", precisionHigh: "High · longest side 1600px", payloadHint: "Only affects automatic analysis; bubble follow-ups and image understanding still send images when needed.",
    quickLinks: "Term bubble quick link", searchService: "Search service", quickLinkLabel: "Gray title label", quickLinkTemplate: "Search URL template",
    testConnection: "Test connection", cancel: "Cancel", save: "Save", analysisFailed: "Analysis failed", checkApi: "Check API settings",
  },
};
const RUNTIME_EN = new Map([
  ["正在直接加载 PDF…", "Loading PDF directly…"], ["直接加载失败", "Direct loading failed"], ["正在打开…", "Opening…"],
  ["本地 memory 已加载", "Local memory loaded"], ["PDF 打开失败", "Failed to open PDF"], ["打开失败", "Open failed"],
  ["智能标注已开启", "Smart annotation enabled"], ["智能标注已暂停", "Smart annotation paused"],
  ["正在重新分析选中的气泡文本", "Re-analyzing selected bubble text"], ["气泡文本 noting 已发出", "Bubble noting request sent"],
  ["气泡 noting 已保存", "Bubble noting saved"], ["气泡 noting 未生成标注", "Bubble noting produced no annotations"], ["气泡文本 noting 结束", "Bubble noting finished"],
  ["正在清理当前视野的发送记录…", "Resetting the current viewport…"], ["当前视野没有可提取文本", "No extractable text in the current viewport"],
  ["当前视野已重新标为已发送，正在重新识别", "Viewport marked as sent; re-analyzing"], ["重新发送失败", "Resend failed"],
  ["请先设置 API", "Configure the API first"], ["等待 API 设置", "Waiting for API settings"], ["正在捕捉当前视野", "Capturing current viewport"],
  ["当前视野已发送或已完成 · 跳过识别", "Viewport already sent or completed · skipped"], ["新区域没有文本 · 已记录覆盖", "New region has no text · coverage recorded"],
  ["已提取未扫描文本", "Extracted unscanned text"], ["已提取 PDF 文本", "Extracted PDF text"], ["已从本地 memory 恢复", "Restored from local memory"],
  ["该视野正在识别", "This viewport is already being analyzed"], ["正在理解当前视野（图文）…", "Understanding viewport (text + image)…"], ["正在理解当前视野（仅文本）…", "Understanding viewport (text only)…"],
  ["截图已压缩，正在准备请求", "Image compressed; preparing request"], ["文本载荷已准备", "Text payload ready"],
  ["请求已发出，等待模型响应", "Request sent; waiting for model"], ["模型已响应，正在解析和定位", "Model responded; parsing and locating"],
  ["首次结果无法定位，正在轻量修复", "Initial result could not be located; repairing"], ["首次未返回标注，正在补充请求", "No initial annotations; sending a repair request"],
  ["修复结果已返回，正在重新定位", "Repair result returned; locating annotations"], ["正在绘制划线并保存 memory", "Drawing underlines and saving memory"],
  ["视野理解完成", "Viewport analysis complete"], ["本次没有有效标注", "No valid annotations this time"], ["分析暂不可用", "Analysis temporarily unavailable"],
  ["当前视野分析失败", "Current viewport analysis failed"], ["分析任务结束", "Analysis task finished"],
  ["正在捕捉追问上下文", "Capturing follow-up context"], ["追问载荷已准备", "Follow-up payload ready"], ["追问结果已返回，正在保存", "Follow-up returned; saving"], ["追问已保存", "Follow-up saved"], ["追问任务结束", "Follow-up task finished"],
  ["正在理解当前视野图片…", "Understanding current viewport image…"], ["正在捕捉当前视野图片", "Capturing current viewport image"],
  ["正在压缩图片并整理上下文", "Compressing image and preparing context"], ["图片请求已发出，等待模型响应", "Image request sent; waiting for model"],
  ["图片结果已返回，正在保存 memory", "Image result returned; saving to memory"], ["图片解释已保存", "Image explanation saved"],
  ["图片解释已保存到当前 PDF memory", "Image explanation saved to this PDF memory"], ["图片理解失败", "Image understanding failed"], ["图片理解任务结束", "Image task finished"],
  ["准备理解当前视野", "Preparing viewport analysis"], ["等待当前视野稳定", "Waiting for the viewport to settle"],
  ["设置已保存在本地", "Settings saved locally"], ["未知错误", "Unknown error"],
]);
const ui = {
  toolbar: document.querySelector(".toolbar"),
  workspace: $("#workspace"), viewer: $("#viewer"), pages: $("#pages"), fileInput: $("#fileInput"),
  openFile: $("#openFile"), emptyOpenFile: $("#emptyOpenFile"), documentTitle: $("#documentTitle"), copyTitle: $("#copyTitle"),
  statusShell: $("#statusShell"), analysisState: $("#analysisState"), dismissStatus: $("#dismissStatus"), toggleAnnotations: $("#toggleAnnotations"), toggleAnalysis: $("#toggleAnalysis"), resendViewport: $("#resendViewport"), importMemory: $("#importMemory"), memoryInput: $("#memoryInput"), exportMemory: $("#exportMemory"),
  understandImage: $("#understandImage"), bubbleLayer: $("#bubbleLayer"),
  settingsButton: $("#settingsButton"), settingsDialog: $("#settingsDialog"), settingsForm: $("#settingsForm"),
  apiProfileSelect: $("#apiProfileSelect"), addApiProfile: $("#addApiProfile"), renameApiProfile: $("#renameApiProfile"), deleteApiProfile: $("#deleteApiProfile"),
  apiEndpoint: $("#apiEndpoint"), apiModel: $("#apiModel"), apiKey: $("#apiKey"), toast: $("#toast"),
  apiTestResult: $("#apiTestResult"), errorPanel: $("#errorPanel"), errorTitle: $("#errorTitle"), errorDetail: $("#errorDetail"),
  focusHeight: $("#focusHeight"), focusHeightValue: $("#focusHeightValue"), showFocusGuide: $("#showFocusGuide"), showStatusBubble: $("#showStatusBubble"),
  focusGuideMask: $("#focusGuideMask"), focusGuide: $("#focusGuide"),
  selectionTools: $("#selectionTools"), selectionQuestion: $("#selectionQuestion"),
  quickLinkProvider: $("#quickLinkProvider"), quickLinkCustom: $("#quickLinkCustom"), quickLinkCustomLabel: $("#quickLinkCustomLabel"), quickLinkCustomTemplate: $("#quickLinkCustomTemplate"),
  interfaceLanguage: $("#interfaceLanguage"), languageFlag: $("#languageFlag"),
  payloadModes: [...document.querySelectorAll('input[name="viewportPayloadMode"]')],
  imagePrecision: $("#imagePrecision"), imagePrecisionRow: $("#imagePrecisionRow"),
};

const state = {
  pdf: null, fileName: "", pdfTitle: "", documentId: "", memory: null, pages: new Map(),
  analysisEnabled: true, annotationsVisible: true, analysisTimer: 0, pdfLoading: false,
  regionSignatures: new Set(), inFlightSignatures: new Set(), resetCoverageDocuments: new Set(), coverageEpochs: new Map(), bubbleStack: [], activeImageTasks: 0,
  readerSettings: { language: "zh", focusHeight: 60, showFocusGuide: true, showStatusBubble: true, viewportPayloadMode: "image", imagePrecision: "balanced", quickLinkProvider: "wiki", quickLinkCustomLabel: "自定义", quickLinkCustomTemplate: "" }, textSelection: null,
  analysisTasks: new Map(), questionTasks: new Map(), nextAnalysisTaskId: 0, progressTimer: 0, errorAction: null, dismissedStatusKey: "", apiProfileStore: null,
};

ui.openFile.addEventListener("click", () => ui.fileInput.click());
ui.emptyOpenFile.addEventListener("click", () => ui.fileInput.click());
ui.fileInput.addEventListener("change", () => ui.fileInput.files?.[0] && openPdf(ui.fileInput.files[0]));
ui.settingsButton.addEventListener("click", openSettings);
ui.copyTitle.addEventListener("click", copyDocumentTitle);
ui.apiProfileSelect.addEventListener("change", switchApiProfile);
ui.addApiProfile.addEventListener("click", addApiProfile);
ui.renameApiProfile.addEventListener("click", renameApiProfile);
ui.deleteApiProfile.addEventListener("click", deleteApiProfile);
$("#closeSettings").addEventListener("click", cancelSettings);
$("#cancelSettings").addEventListener("click", cancelSettings);
ui.settingsForm.addEventListener("submit", saveSettingsFromDialog);
ui.settingsDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelSettings(); });
$("#testApi").addEventListener("click", testApiConnection);
$("#errorSettings").addEventListener("click", () => {
  const action = state.errorAction;
  if (action?.run) action.run();
  else openSettings();
});
$("#dismissError").addEventListener("click", clearError);
ui.toggleAnalysis.addEventListener("click", toggleAnalysis);
ui.toggleAnnotations.addEventListener("click", toggleAnnotations);
ui.dismissStatus.addEventListener("click", dismissCurrentStatus);
ui.resendViewport.addEventListener("click", resendCurrentViewport);
ui.importMemory.addEventListener("click", () => ui.memoryInput.click());
ui.memoryInput.addEventListener("change", () => importMemory(ui.memoryInput.files?.[0]));
ui.exportMemory.addEventListener("click", exportMemory);
ui.understandImage.addEventListener("click", understandCurrentViewportImage);
ui.selectionQuestion.addEventListener("pointerdown", (event) => event.preventDefault());
ui.selectionQuestion.addEventListener("click", noteSelectedText);
ui.viewer.addEventListener("scroll", handleViewerScroll, { passive: true });
ui.viewer.addEventListener("scroll", updateFocusGuide, { passive: true });
ui.focusHeight.addEventListener("input", previewReaderSettings);
ui.showFocusGuide.addEventListener("change", previewReaderSettings);
ui.showStatusBubble.addEventListener("change", previewReaderSettings);
ui.payloadModes.forEach((input) => input.addEventListener("change", previewReaderSettings));
ui.imagePrecision.addEventListener("change", previewReaderSettings);
ui.quickLinkProvider.addEventListener("change", previewReaderSettings);
ui.quickLinkCustomLabel.addEventListener("input", previewReaderSettings);
ui.quickLinkCustomTemplate.addEventListener("input", previewReaderSettings);
ui.interfaceLanguage.addEventListener("change", previewReaderSettings);
window.addEventListener("resize", handleWindowResize);
window.visualViewport?.addEventListener("resize", scheduleCanvasResolutionRefresh);
document.addEventListener("keydown", handleKeydown);
ui.viewer.addEventListener("mouseup", () => setTimeout(updateSelectionTools, 0));
ui.bubbleLayer.addEventListener("mouseup", () => setTimeout(updateSelectionTools, 0));
document.addEventListener("selectionchange", () => {
  if (document.getSelection()?.isCollapsed) hideSelectionTools();
});
initializeViewer();
watchDevicePixelRatio();

function currentLanguage() {
  return state.readerSettings.language === "en" ? "en" : "zh";
}

function t(zh, en) {
  return currentLanguage() === "en" ? en : zh;
}

function localizeRuntimeText(value) {
  const text = String(value ?? "");
  if (currentLanguage() !== "en") return text;
  return RUNTIME_EN.get(text) || text;
}

function applyInterfaceLanguage() {
  const language = currentLanguage();
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  ui.languageFlag.src = language === "en" ? "assets/flag-gb.svg" : "assets/flag-cn.svg";
  ui.languageFlag.alt = language === "en" ? "United Kingdom flag" : "中国国旗";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    if (state.pdf && (element === ui.analysisState || element === ui.documentTitle)) return;
    const value = UI_TEXT[language][element.dataset.i18n];
    if (value) element.textContent = value;
  });
  ui.toggleAnalysis.title = t("暂停或继续智能标注", "Pause or resume smart annotation");
  ui.copyTitle.title = t("复制标题", "Copy title");
  ui.copyTitle.setAttribute("aria-label", ui.copyTitle.title);
  updateAnnotationVisibilityControl();
  ui.resendViewport.title = t("清除当前视野的发送记录并重新识别", "Clear and resend the current viewport");
  ui.importMemory.title = t("导入当前 PDF memory", "Import memory for the current PDF");
  ui.exportMemory.title = t("导出当前 PDF memory", "Export the current PDF memory");
  ui.settingsButton.title = t("API 设置", "API settings");
  ui.apiEndpoint.placeholder = t("https://api.openai.com/v1 或完整 chat/completions 地址", "https://api.openai.com/v1 or a full chat/completions URL");
  ui.apiModel.placeholder = t("支持视觉输入的模型", "Vision-capable model");
  ui.quickLinkCustomLabel.placeholder = t("例如：My Search", "For example: My Search");
  $("#closeSettings").title = t("关闭设置", "Close settings");
  $("#closeSettings").setAttribute("aria-label", $("#closeSettings").title);
  $("#dismissError").title = t("关闭", "Close");
  $("#dismissError").setAttribute("aria-label", $("#dismissError").title);
  const apiProfileLabels = {
    select: t("当前 API 配置", "Current API profile"),
    add: t("新增 API 配置", "Add API profile"),
    rename: t("重命名 API 配置", "Rename API profile"),
    remove: t("删除 API 配置", "Delete API profile"),
  };
  ui.apiProfileSelect.setAttribute("aria-label", apiProfileLabels.select);
  for (const [element, label] of [[ui.addApiProfile, apiProfileLabels.add], [ui.renameApiProfile, apiProfileLabels.rename], [ui.deleteApiProfile, apiProfileLabels.remove]]) {
    element.title = label;
    element.setAttribute("aria-label", label);
  }
  ui.dismissStatus.title = t("关闭当前状态", "Dismiss current status");
  ui.dismissStatus.setAttribute("aria-label", ui.dismissStatus.title);
  ui.understandImage.title = t("立即截取并理解当前视野", "Capture and understand the current viewport");
  ui.selectionQuestion.title = t("noting 选中文本", "Run noting on selected text");
  ui.quickLinkProvider.querySelector('option[value="custom"]').textContent = t("自定义", "Custom");
  ui.quickLinkProvider.querySelector('option[value="cnki"]').textContent = t("知网", "CNKI");
}

function responseLanguageInstruction() {
  return currentLanguage() === "en" ? " Write all explanatory text in English." : " 所有解释文本使用中文。";
}

async function initializeViewer() {
  await loadReaderSettings();
  const params = new URLSearchParams(location.search);
  const source = params.get("source");
  if (source) await openPdfFromUrl(source, params.get("cache"));
}

async function openPdfFromUrl(source, cacheToken = "") {
  beginPdfLoading();
  try {
    setStatus("正在直接加载 PDF…", "working");
    if (source.startsWith("file:")) {
      const allowed = await chrome.extension.isAllowedFileSchemeAccess();
      if (!allowed) throw new Error("请在 chrome://extensions 的插件详情中开启“允许访问文件网址”，然后重新打开本地 PDF。 ");
    }
    const loaded = await loadPdfSource(source, cacheToken);
    const { buffer, contentType, contentDisposition } = loaded;
    if (!buffer.byteLength) throw new Error("PDF 响应内容为空。 ");
    const name = pdfFileName(source, contentDisposition);
    const file = new File([buffer], name, { type: contentType || "application/pdf" });
    await openPdf(file);
  } catch (error) {
    endPdfLoading(false);
    console.warn("Handled direct PDF loading failure", error);
    if (source.startsWith("file:")) {
      const localError = new Error(t(
        "无法读取本地 PDF。文件可能已被移动、删除。请重新选择该 PDF。",
        "The local PDF could not be read. It may have been moved or deleted. Please choose it again.",
      ));
      setStatus(t("本地 PDF 已移动或不可访问", "Local PDF moved or unavailable"));
      showError(t("无法直接打开 PDF", "Could not open PDF directly"), localError, {
        label: t("重新选择 PDF", "Choose PDF again"),
        run: () => ui.fileInput.click(),
      });
    } else {
      setStatus("直接加载失败");
      showError("无法直接打开 PDF", error);
    }
  }
}

async function loadPdfSource(source, cacheToken = "") {
  if (cacheToken) {
    try {
      const cache = await caches.open("paper-noter-local-pdf-v1");
      const cacheUrl = chrome.runtime.getURL(`source-cache/${cacheToken}`);
      const cached = await cache.match(cacheUrl);
      if (cached) {
        const buffer = await cached.arrayBuffer();
        await cache.delete(cacheUrl);
        if (buffer.byteLength) return {
          buffer,
          contentType: cached.headers.get("content-type") || "application/pdf",
          contentDisposition: "",
        };
      }
    } catch {
      // Cache is only an optimization; continue through the normal readers.
    }
  }
  try {
    const response = await fetch(source, { credentials: "include", cache: "default" });
    if (!response.ok && response.status !== 0) throw new Error(`PDF 下载失败：HTTP ${response.status} ${response.statusText}`);
    return {
      buffer: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") || "",
      contentDisposition: response.headers.get("content-disposition") || "",
    };
  } catch (error) {
    if (!source.startsWith("file:")) throw error;
    return loadLocalPdfWithXhr(source);
  }
}

function loadLocalPdfWithXhr(source) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", source, true);
    request.responseType = "arraybuffer";
    request.onload = () => {
      if (request.response?.byteLength) {
        resolve({
          buffer: request.response,
          contentType: request.getResponseHeader("content-type") || "application/pdf",
          contentDisposition: request.getResponseHeader("content-disposition") || "",
        });
      } else reject(new Error("Local PDF response was empty"));
    };
    request.onerror = () => reject(new Error("Local PDF could not be read"));
    request.send();
  });
}

async function openPdf(file) {
  beginPdfLoading();
  try {
    setStatus("正在打开…", "working");
    closeBubbles();
    state.pages.clear();
    state.regionSignatures.clear();
    state.pdfTitle = "";
    state.annotationsVisible = true;
    ui.copyTitle.disabled = true;
    ui.toggleAnnotations.disabled = true;
    updateAnnotationVisibilityControl();
    ui.pages.replaceChildren();

    const buffer = await file.arrayBuffer();
    const binarySha256 = await sha256(buffer);
    state.fileName = file.name;
    state.pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: chrome.runtime.getURL("vendor/cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL("vendor/standard_fonts/"),
      wasmUrl: chrome.runtime.getURL("vendor/wasm/"),
      iccUrl: chrome.runtime.getURL("vendor/iccs/"),
    }).promise;
    let pdfTitle = resolvePdfTitle(null, file.name);
    try {
      pdfTitle = resolvePdfTitle(await state.pdf.getMetadata(), file.name);
    } catch {
      // A malformed metadata dictionary must not prevent the PDF from opening.
    }
    let knownDocumentId = await PaperMemory.findDocumentByBinary(binarySha256);
    let identity = { contentFingerprint: "", layoutFingerprint: "", sampledCharacters: 0 };
    if (!knownDocumentId) {
      setStatus(t("正在安全匹配本地 memory…", "Safely matching local memory…"), "working");
      try {
        identity = await computePdfIdentity(state.pdf);
      } catch {
        // Identity must never make an otherwise readable PDF fail to open.
      }
      knownDocumentId = await PaperMemory.resolveDocumentId(binarySha256, identity.layoutFingerprint);
    }
    state.documentId = knownDocumentId || binarySha256;
    const memoryMeta = {
      fileName: file.name,
      pageCount: state.pdf.numPages,
      updatedAt: new Date().toISOString(),
      binarySha256,
    };
    if (identity.contentFingerprint) memoryMeta.contentFingerprint = identity.contentFingerprint;
    if (identity.layoutFingerprint) memoryMeta.layoutFingerprint = identity.layoutFingerprint;
    state.memory = await new PaperMemory(state.documentId).init(memoryMeta);
    if (!state.resetCoverageDocuments.has(state.documentId)) {
      await state.memory.resetSentCoverage();
      state.resetCoverageDocuments.add(state.documentId);
    }

    for (const event of state.memory.events) {
      if (event.region_signature && isAnnotationAnchorConsistent(event)) state.regionSignatures.add(event.region_signature);
    }
    await createPagePlaceholders();
    ui.workspace.classList.remove("empty");
    state.pdfTitle = pdfTitle;
    ui.documentTitle.textContent = pdfTitle;
    document.title = pdfTitle;
    endPdfLoading(true);
    ui.resendViewport.disabled = false;
    ui.importMemory.disabled = false;
    ui.exportMemory.disabled = false;
    ui.understandImage.disabled = false;
    ui.copyTitle.disabled = false;
    ui.toggleAnnotations.disabled = false;
    setStatus(state.analysisEnabled ? "本地 memory 已加载" : "智能标注已暂停", state.analysisEnabled ? "ready" : "");
    clearError();
    updateFocusGuide();
    scheduleAnalysis(900);
  } catch (error) {
    endPdfLoading(false);
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
    element.style.setProperty("--scale-factor", viewport.scale);
    element.innerHTML = `<canvas></canvas><div class="sent-coverage-layer"></div><div class="text-map"></div><div class="annotation-layer"></div>`;
    ui.pages.append(element);
    const record = {
      pageNumber, page, viewport, element, canvas: element.querySelector("canvas"), textItems: [], rendered: false, rendering: null,
      canvasRendering: null, canvasRefreshRequested: false,
    };
    state.pages.set(pageNumber, record);
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const pageNumber = Number(entry.target.dataset.page);
      void renderPage(pageNumber).then(() => refreshPageCanvasResolution(pageNumber)).catch((error) => console.error("PDF page render failed", error));
    }
  }, { root: ui.viewer, rootMargin: "900px 0px" });
  state.pages.forEach(({ element }) => observer.observe(element));
}

async function renderPage(pageNumber) {
  const record = state.pages.get(pageNumber);
  if (!record || record.rendered) return record?.rendering;
  if (record.rendering) return record.rendering;

  record.rendering = (async () => {
    await renderPageCanvas(record);

    const textContent = await record.page.getTextContent({ includeMarkedContent: true });
    const textMap = record.element.querySelector(".text-map");
    textMap.addEventListener("click", (event) => handleTextMapAnnotationClick(pageNumber, event));
    const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textMap, viewport: record.viewport });
    await textLayer.render();
    record.textLayer = textLayer;
    const stringItems = textContent.items.filter((item) => item.str !== undefined);
    const pageRect = record.element.getBoundingClientRect();
    let visibleIndex = 0;
    record.textItems = stringItems.flatMap((item, itemIndex) => {
      if (!item.str?.trim()) return [];
      const span = textLayer.textDivs[itemIndex];
      if (!span?.isConnected) return [];
      const id = `p${pageNumber}s${visibleIndex++}`;
      span.classList.add("text-item");
      span.dataset.spanId = id;
      const rect = span.getBoundingClientRect();
      const left = clamp(rect.left - pageRect.left, 0, pageRect.width);
      const top = clamp(rect.top - pageRect.top, 0, pageRect.height);
      const right = clamp(rect.right - pageRect.left, left, pageRect.width);
      const bottom = clamp(rect.bottom - pageRect.top, top, pageRect.height);
      return [{
        id,
        text: item.str,
        element: span,
        box: [left / pageRect.width, top / pageRect.height, right / pageRect.width, bottom / pageRect.height],
      }];
    });
    record.rendered = true;
    renderPageAnnotations(pageNumber);
    renderSentCoverage(pageNumber);
    return record;
  })().catch((error) => {
    record.rendering = null;
    throw error;
  });
  return record.rendering;
}

async function renderPageCanvas(record) {
  const displayScale = effectiveDisplayScale(window.devicePixelRatio, window.visualViewport?.scale);
  const resolution = calculateCanvasResolution(record.viewport.width, record.viewport.height, displayScale);
  if (record.canvas.width === resolution.pixelWidth && record.canvas.height === resolution.pixelHeight) return record.canvas;
  if (record.canvasRendering) {
    record.canvasRefreshRequested = true;
    return record.canvasRendering;
  }

  record.canvasRendering = (async () => {
    const nextCanvas = document.createElement("canvas");
    nextCanvas.width = resolution.pixelWidth;
    nextCanvas.height = resolution.pixelHeight;
    nextCanvas.style.width = `${record.viewport.width}px`;
    nextCanvas.style.height = `${record.viewport.height}px`;
    const canvasContext = nextCanvas.getContext("2d");
    canvasContext.imageSmoothingEnabled = true;
    canvasContext.imageSmoothingQuality = "high";
    await record.page.render({
      canvasContext,
      viewport: record.viewport,
      transform: resolution.outputScale === 1 ? null : [
        resolution.pixelWidth / record.viewport.width,
        0,
        0,
        resolution.pixelHeight / record.viewport.height,
        0,
        0,
      ],
    }).promise;
    if (state.pages.get(record.pageNumber) !== record) return record.canvas;
    record.canvas.replaceWith(nextCanvas);
    record.canvas = nextCanvas;
    return nextCanvas;
  })().finally(() => {
    record.canvasRendering = null;
    if (record.canvasRefreshRequested) {
      record.canvasRefreshRequested = false;
      void renderPageCanvas(record).catch((error) => console.warn("PDF resolution refresh failed", error));
    }
  });
  return record.canvasRendering;
}

function refreshPageCanvasResolution(pageNumber) {
  const record = state.pages.get(pageNumber);
  if (!record?.rendered) return Promise.resolve(null);
  return renderPageCanvas(record);
}

let canvasResolutionTimer = 0;
function scheduleCanvasResolutionRefresh() {
  clearTimeout(canvasResolutionTimer);
  canvasResolutionTimer = setTimeout(() => {
    if (!state.pdf) return;
    const viewerRect = ui.viewer.getBoundingClientRect();
    for (const record of state.pages.values()) {
      if (!record.rendered) continue;
      const rect = record.element.getBoundingClientRect();
      if (rect.bottom < viewerRect.top - 800 || rect.top > viewerRect.bottom + 800) continue;
      void renderPageCanvas(record).catch((error) => console.warn("PDF resolution refresh failed", error));
    }
  }, 180);
}

let resolutionMediaQuery = null;
function watchDevicePixelRatio() {
  resolutionMediaQuery?.removeEventListener?.("change", handleDevicePixelRatioChange);
  resolutionMediaQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  resolutionMediaQuery.addEventListener("change", handleDevicePixelRatioChange, { once: true });
}

function handleDevicePixelRatioChange() {
  scheduleCanvasResolutionRefresh();
  watchDevicePixelRatio();
}

function handleWindowResize() {
  layoutBubbles();
  updateFocusGuide();
  scheduleAnalysis();
  scheduleCanvasResolutionRefresh();
}

function handleViewerScroll() {
  hideSelectionTools();
  scheduleAnalysis(VIEWPORT_SETTLE_MS);
}

function scheduleAnalysis(delay = VIEWPORT_SETTLE_MS) {
  clearTimeout(state.analysisTimer);
  closeBubbles();
  if (!state.analysisEnabled || !state.pdf || state.pdfLoading) return;
  state.analysisTimer = setTimeout(() => analyzeCurrentRegion(), delay);
}

function beginPdfLoading() {
  state.pdfLoading = true;
  clearTimeout(state.analysisTimer);
  ui.toggleAnalysis.disabled = false;
  ui.toggleAnalysis.textContent = state.analysisEnabled ? "◉" : "○";
}

function endPdfLoading(opened) {
  state.pdfLoading = false;
  ui.toggleAnalysis.disabled = !opened && !state.pdf;
}

function toggleAnalysis() {
  state.analysisEnabled = !state.analysisEnabled;
  if (!state.analysisEnabled) clearTimeout(state.analysisTimer);
  ui.toggleAnalysis.textContent = state.analysisEnabled ? "◉" : "○";
  setStatus(state.analysisEnabled ? "智能标注已开启" : "智能标注已暂停", state.analysisEnabled ? "ready" : "");
  if (state.analysisEnabled) scheduleAnalysis(200);
}

function updateSelectionTools() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !state.pdf) return hideSelectionTools();
  const range = selection.getRangeAt(0);
  const selected = buildPdfTextSelection(range) || buildBubbleTextSelection(range);
  if (!selected) return hideSelectionTools();
  state.textSelection = selected;
  const hasSavedNoting = selected.sourceType === "bubble" && state.memory?.getBubbleAnnotations(selected.parentBubble.questionBinding).some((annotation) => (
    annotation.anchor?.field === selected.field
    && annotation.anchor.end > selected.fieldStart
    && annotation.anchor.start < selected.fieldEnd
  ));
  ui.selectionQuestion.classList.toggle("saved", hasSavedNoting);
  ui.selectionQuestion.title = hasSavedNoting ? "重新 noting（已有保存结果）" : "noting 选中文本";
  ui.selectionTools.classList.remove("hidden");
  const width = ui.selectionTools.offsetWidth;
  const height = ui.selectionTools.offsetHeight;
  const left = clamp(selected.anchorRect.left + (selected.anchorRect.width - width) / 2, 8, window.innerWidth - width - 8);
  const preferredTop = selected.anchorRect.top - height - 8;
  const top = preferredTop >= 62 ? preferredTop : selected.anchorRect.bottom + 8;
  ui.selectionTools.style.left = `${left}px`;
  ui.selectionTools.style.top = `${clamp(top, toolbarHeight() + 4, window.innerHeight - height - 8)}px`;
}

function hideSelectionTools() {
  ui.selectionTools.classList.add("hidden");
  state.textSelection = null;
}

function buildPdfTextSelection(range) {
  const groups = new Map();
  for (const record of state.pages.values()) {
    const selectedSpans = [];
    for (const item of record.textItems) {
      if (!item.element || !range.intersectsNode(item.element)) continue;
      const length = item.text.length;
      let start = item.element.contains(range.startContainer) ? selectionBoundaryOffset(item.element, range.startContainer, range.startOffset, length) : 0;
      let end = item.element.contains(range.endContainer) ? selectionBoundaryOffset(item.element, range.endContainer, range.endOffset, length) : length;
      start = clamp(start, 0, length);
      end = clamp(end, start, length);
      const text = item.text.slice(start, end);
      if (!text.trim()) continue;
      const [x1, y1, x2, y2] = item.box;
      const width = x2 - x1;
      selectedSpans.push({ id: item.id, text, box: [x1 + width * start / Math.max(1, length), y1, x1 + width * end / Math.max(1, length), y2] });
    }
    if (selectedSpans.length) groups.set(record.pageNumber, { record, spans: selectedSpans });
  }
  const best = [...groups.entries()].sort((a, b) => b[1].spans.reduce((sum, item) => sum + item.text.length, 0) - a[1].spans.reduce((sum, item) => sum + item.text.length, 0))[0];
  if (!best) return null;
  const [page, value] = best;
  const quote = value.spans.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
  if (!quote) return null;
  const xs1 = value.spans.map((item) => item.box[0]), ys1 = value.spans.map((item) => item.box[1]);
  const xs2 = value.spans.map((item) => item.box[2]), ys2 = value.spans.map((item) => item.box[3]);
  const normalized = [clamp(Math.min(...xs1) - .01, 0, 1), clamp(Math.min(...ys1) - .008, 0, 1), clamp(Math.max(...xs2) + .01, 0, 1), clamp(Math.max(...ys2) + .008, 0, 1)];
  const rect = range.getBoundingClientRect();
  const rootAnnotationId = `selection_${page}_${simpleHash(`${quote}:${JSON.stringify(value.spans.map((item) => item.box))}`)}`;
  return {
    page,
    sourceType: "pdf",
    quote,
    rootAnnotationId,
    anchorRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    region: { page, record: value.record, spans: value.spans, normalized, image: null },
  };
}

function buildBubbleTextSelection(range) {
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const bubbleElement = startElement?.closest?.(".concept-bubble");
  if (!bubbleElement || startElement?.closest?.("button")) return null;
  const fieldElement = startElement?.closest?.("[data-bubble-field]");
  if (!fieldElement || !fieldElement.contains(range.endContainer)) return null;
  const bubbleIndex = Number(bubbleElement.dataset.bubbleIndex);
  const bubble = state.bubbleStack[bubbleIndex];
  const field = fieldElement.dataset.bubbleField;
  const sourceText = String(bubble?.[field] || "");
  let fieldStart = bubbleSourceOffset(fieldElement, range.startContainer, range.startOffset, "start");
  let fieldEnd = bubbleSourceOffset(fieldElement, range.endContainer, range.endOffset, "end");
  if (fieldStart === null || fieldEnd === null) return null;
  if (fieldEnd < fieldStart) [fieldStart, fieldEnd] = [fieldEnd, fieldStart];
  const rawQuote = sourceText.slice(fieldStart, fieldEnd);
  const leading = rawQuote.length - rawQuote.trimStart().length;
  const trailing = rawQuote.length - rawQuote.trimEnd().length;
  fieldStart += leading;
  fieldEnd -= trailing;
  const quote = sourceText.slice(fieldStart, fieldEnd);
  if (!bubble || !quote.trim()) return null;
  const rect = range.getBoundingClientRect();
  const conceptPath = [...bubble.conceptPath, `选中：${quote}`];
  return {
    sourceType: "bubble",
    page: bubble.page,
    quote,
    field,
    fieldStart,
    fieldEnd,
    rootAnnotationId: bubble.rootAnnotationId,
    conceptPath,
    anchorRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
    parentBubble: bubble,
  };
}

function bubbleSourceOffset(fieldElement, container, offset, edge) {
  let sourceElement = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)?.closest?.("[data-source-start]");
  if (!sourceElement || !fieldElement.contains(sourceElement)) {
    const child = edge === "start" ? fieldElement.childNodes[offset] : fieldElement.childNodes[Math.max(0, offset - 1)];
    sourceElement = child?.nodeType === Node.ELEMENT_NODE ? child.closest?.("[data-source-start]") || child.querySelector?.("[data-source-start]") : child?.parentElement?.closest?.("[data-source-start]");
  }
  if (!sourceElement || !fieldElement.contains(sourceElement)) return edge === "start" ? 0 : String(fieldElement.textContent || "").length;
  const start = Number(sourceElement.dataset.sourceStart);
  const end = Number(sourceElement.dataset.sourceEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (sourceElement.classList.contains("bubble-math")) return edge === "start" ? start : end;
  try {
    const prefix = document.createRange();
    prefix.selectNodeContents(sourceElement);
    prefix.setEnd(container, offset);
    return clamp(start + prefix.toString().length, start, end);
  } catch {
    return edge === "start" ? start : end;
  }
}

function selectionBoundaryOffset(element, container, offset, length) {
  if (container.nodeType === Node.TEXT_NODE) return offset;
  if (container === element) return offset <= 0 ? 0 : length;
  return 0;
}

async function noteSelectedText() {
  const selected = state.textSelection;
  if (!selected || !state.memory) return;
  if (selected.sourceType === "bubble") {
    hideSelectionTools();
    document.getSelection()?.removeAllRanges();
    return noteSelectedBubbleText(selected);
  }
  const taskMemory = state.memory;
  const taskDocumentId = state.documentId;
  hideSelectionTools();
  document.getSelection()?.removeAllRanges();
  try {
    bumpCoverageEpoch(taskDocumentId, selected.page);
    const reservedCoverage = await taskMemory.resetAndReserveCoverage(selected.page, [selected.region.normalized[1], selected.region.normalized[3]]);
    if (state.documentId === taskDocumentId) renderSentCoverage(selected.page);
    const includeImage = state.readerSettings.viewportPayloadMode === "image";
    selected.region.image = includeImage ? cropCanvas(selected.region.record.canvas, selected.region.normalized, state.readerSettings.imagePrecision) : null;
    if (state.documentId !== taskDocumentId) return;
    await analyzeCurrentRegion({ force: true, regionOverride: selected.region, reservedCoverage });
  } catch (error) {
    console.error(error);
    showError("选中文本 noting 失败", error);
  }
}

async function noteSelectedBubbleText(selected) {
  const taskId = beginAnalysisProgress();
  const taskMemory = state.memory;
  const taskDocumentId = state.documentId;
  try {
    setAnalysisProgress(taskId, 0, "正在重新分析选中的气泡文本", selected.quote.slice(0, 100));
    const viewportRegion = await getCurrentRegion();
    if (!viewportRegion) throw new Error("当前视野没有可用于 noting 的 PDF 内容。");
    const openBubbles = state.bubbleStack.map(({ title, explanation, context }) => ({ title, explanation, context }));
    setAnalysisProgress(taskId, 3, "气泡文本 noting 已发出", `${selected.quote.length} 个字符`);
    const response = await requestVision([
      { role: "system", content: `你是学术阅读标注助手。对用户从解释气泡中选中的文字划分重点和需要解释的名词。只能引用给定 span_id，必须返回严格 JSON，不使用 Markdown。同一字符尽量只归入一个标注。${responseLanguageInstruction()}` },
      { role: "user", content: [
        { type: "text", text: `选中的气泡文本片段：${JSON.stringify([{ id: "selected", text: selected.quote }])}\n当前视野文本：${viewportRegion.spans.map((item) => item.text).join(" ")}\n已展开气泡：${JSON.stringify(openBubbles)}\n返回：{"annotations":[{"kind":"term|keypoint","targets":[{"span_id":"selected","start":0,"end":4}],"label":"原文名词或重点","explanation":"简洁解释","context":"与论文当前语境的关系","secondary_terms":[]}]}。start/end 是选中文本内的字符下标，end 不包含。` },
        { type: "image_url", image_url: { url: viewportRegion.image } },
      ]},
    ]);
    const data = parseJsonResponse(extractAssistantText(response));
    let annotations = Array.isArray(data.annotations) ? data.annotations : [];
    if (!annotations.length && hasSubstantiveText([{ text: selected.quote }])) {
      annotations = await repairAnnotations([], { spans: [{ id: "selected", text: selected.quote }] });
    }
    const accepted = await saveSelectedBubbleAnnotations(annotations, selected, taskMemory, viewportRegion.page);
    if (state.documentId !== taskDocumentId) return;
    renderBubbles();
    finishAnalysisProgress(taskId, accepted ? "气泡 noting 已保存" : "气泡 noting 未生成标注", `生成 ${accepted} 个名词/重点划线`, accepted > 0);
  } catch (error) {
    console.error(error);
    failAnalysisProgress(taskId, error);
    toast(error.message, true);
  } finally {
    if (state.analysisTasks.has(taskId)) finishAnalysisProgress(taskId, "气泡文本 noting 结束", "未保存结果", false);
  }
}

async function saveSelectedBubbleAnnotations(annotations, selected, memory, fallbackPage) {
  let accepted = 0;
  const region = { spans: [{ id: "selected", text: selected.quote }] };
  for (const annotation of annotations) {
    const kind = normalizeAnnotationKind(annotation.kind || annotation.type || annotation.category);
    if (!kind) continue;
    for (const target of normalizeAnnotationTargets(annotation, region, kind)) {
      if ((target.span_id || target.spanId || target.id) !== "selected") continue;
      const start = clamp(Number(target.start) || 0, 0, selected.quote.length);
      const rawEnd = Number(target.end);
      const end = clamp(Number.isFinite(rawEnd) ? rawEnd : selected.quote.length, start, selected.quote.length);
      if (end <= start) continue;
      const absoluteStart = selected.fieldStart + start;
      const absoluteEnd = selected.fieldStart + end;
      const quote = selected.quote.slice(start, end);
      const label = String(annotation.label || quote).slice(0, 240);
      await memory.append({
        event: "bubble_annotation_upsert",
        id: `bubble_${kind}_${simpleHash(`${selected.parentBubble.questionBinding}:${selected.field}:${absoluteStart}:${absoluteEnd}:${label}`)}`,
        kind,
        page: selected.page || fallbackPage,
        binding_key: selected.parentBubble.questionBinding,
        parent_annotation_id: selected.rootAnnotationId,
        parent_bubble_id: selected.parentBubble.id,
        anchor: { field: selected.field, start: absoluteStart, end: absoluteEnd, quote },
        content: {
          label,
          explanation: String(annotation.explanation || ""),
          context: String(annotation.context || ""),
          secondary_terms: normalizeSecondaryTerms(annotation.secondary_terms),
        },
        source: "selected_bubble_text_noting_mllm",
      });
      accepted += 1;
    }
  }
  return accepted;
}

async function resendCurrentViewport() {
  if (!state.pdf || !state.memory) return;
  clearTimeout(state.analysisTimer);
  ui.resendViewport.disabled = true;
  const taskMemory = state.memory;
  const taskDocumentId = state.documentId;
  try {
    const includeImage = state.readerSettings.viewportPayloadMode === "image";
    setStatus("正在清理当前视野的发送记录…", "working");
    const region = await getCurrentRegion({ includeImage, precision: state.readerSettings.imagePrecision });
    if (!region) {
      toast("当前视野没有可重新发送的 PDF 文本", true);
      setStatus("当前视野没有可提取文本");
      return;
    }
    if (state.documentId !== taskDocumentId) return;
    bumpCoverageEpoch(taskDocumentId, region.page);
    const reservedCoverage = await taskMemory.resetAndReserveCoverage(
      region.page,
      [region.normalized[1], region.normalized[3]],
    );
    if (state.documentId === taskDocumentId) renderSentCoverage(region.page);
    toast("当前视野已重新标为已发送，正在重新识别");
    await analyzeCurrentRegion({ force: true, regionOverride: region, reservedCoverage });
  } catch (error) {
    console.error(error);
    showError("重新发送当前视野失败", error);
    setStatus("重新发送失败");
  } finally {
    if (state.documentId === taskDocumentId) ui.resendViewport.disabled = false;
  }
}

function coverageEpochKey(documentId, page) {
  return `${documentId}:${page}`;
}

function getCoverageEpoch(documentId, page) {
  return state.coverageEpochs.get(coverageEpochKey(documentId, page)) || 0;
}

function bumpCoverageEpoch(documentId, page) {
  const key = coverageEpochKey(documentId, page);
  state.coverageEpochs.set(key, getCoverageEpoch(documentId, page) + 1);
}

async function completeTaskCoverage(memory, documentId, page, intervals, taskEpoch) {
  if (getCoverageEpoch(documentId, page) !== taskEpoch) return false;
  await memory.completeCoverage(page, intervals);
  if (state.documentId === documentId) renderSentCoverage(page);
  return true;
}

async function getCurrentRegion({ includeImage = true, precision = state.readerSettings.imagePrecision } = {}) {
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
  const image = includeImage ? cropCanvas(best.record.canvas, best.normalized, precision) : null;
  return { page: best.record.pageNumber, record: best.record, spans: best.spans, normalized: best.normalized, image };
}

async function analyzeCurrentRegion({ force = false, regionOverride = null, reservedCoverage = null } = {}) {
  if (!force && !state.analysisEnabled) return;
  const textOnlyMode = state.readerSettings.viewportPayloadMode === "text";
  const existingUnderline = textOnlyMode ? null : findUnderlineInCurrentFocus();
  if (!force && existingUnderline) {
    setStatus("视野内已有划线 · 已跳过识别", "ready");
    ui.analysisState.title = `检测到${existingUnderline.kind === "term" ? "名词" : "重点"}划线：${existingUnderline.content?.label || existingUnderline.anchor?.quote || "已有标注"}。左侧“理解图片”仍可正常使用。`;
    return;
  }
  const taskId = beginAnalysisProgress();
  let signature = null;
  let ownsSignature = false;
  let coverageIntervals = reservedCoverage;
  let coverageEpoch = null;
  try {
    const settings = await loadApiSettings();
    if (!settings.endpoint || !settings.model || !settings.apiKey) {
      setStatus("请先设置 API");
      finishAnalysisProgress(taskId, "等待 API 设置", "请点击右上角设置图标填写接口地址、模型与 API Key", false);
      return;
    }
    const taskMemory = state.memory;
    const taskDocumentId = state.documentId;
    const includeImage = state.readerSettings.viewportPayloadMode === "image";
    setAnalysisProgress(taskId, 0, "正在捕捉当前视野", includeImage ? "图文模式：准备裁剪页面截图" : "纯文本模式：不会生成或上传截图");
    const region = regionOverride || await getCurrentRegion({ includeImage, precision: state.readerSettings.imagePrecision });
    if (!region) {
      finishAnalysisProgress(taskId, "当前视野没有可提取文本", "请稍微滚动页面或扩大视野范围", false);
      return;
    }
    if (state.documentId !== taskDocumentId) {
      finishAnalysisProgress(taskId, "PDF 已切换", "旧文档尚未发出请求，本次任务已安全结束", false);
      return;
    }
    if (coverageIntervals) coverageEpoch = getCoverageEpoch(taskDocumentId, region.page);
    if (!includeImage) {
      coverageEpoch = getCoverageEpoch(taskDocumentId, region.page);
      if (!coverageIntervals) {
        coverageIntervals = await taskMemory.reserveCoverage(
          region.page,
          [region.normalized[1], region.normalized[3]],
        );
        if (state.documentId === taskDocumentId) renderSentCoverage(region.page);
      }
      if (!coverageIntervals.length) {
        finishAnalysisProgress(taskId, "当前视野已发送或已完成 · 跳过识别", `第 ${region.page} 页 · 重叠区域已从本次任务中裁剪`, true);
        return;
      }
      const unseenSpans = region.spans.filter((span) => coverageIntervals.some(([start, end]) => span.box[3] > start && span.box[1] < end));
      if (!unseenSpans.length) {
        await completeTaskCoverage(taskMemory, taskDocumentId, region.page, coverageIntervals, coverageEpoch);
        finishAnalysisProgress(taskId, "新区域没有文本 · 已记录覆盖", `第 ${region.page} 页 · 未调用 API`, true);
        return;
      }
      region.spans = unseenSpans;
      const targetLength = Math.max(.001, region.normalized[3] - region.normalized[1]);
      const unseenPercent = Math.min(100, Math.round(intervalLength(coverageIntervals) / targetLength * 100));
      setAnalysisProgress(taskId, 1, "已提取未扫描文本", `第 ${region.page} 页 · 新区域约占当前视野 ${unseenPercent}% · ${unseenSpans.length} 个文本片段`);
    }
    else setAnalysisProgress(taskId, 1, "已提取 PDF 文本", `第 ${region.page} 页 · ${region.spans.length} 个文本片段`);
    const legacySignature = `${region.page}:${simpleHash(region.spans.map((span) => span.text).join(" "))}`;
    const coverageKey = coverageIntervals || [[region.normalized[1], region.normalized[3]]];
    signature = `${taskDocumentId}:${legacySignature}:${coverageKey.flat().map((value) => value.toFixed(3)).join(",")}`;
    if (!force && (state.regionSignatures.has(signature) || state.regionSignatures.has(legacySignature))) {
      if (coverageIntervals) await completeTaskCoverage(taskMemory, taskDocumentId, region.page, coverageIntervals, coverageEpoch);
      setStatus("已从 memory 恢复", "ready");
      finishAnalysisProgress(taskId, "已从本地 memory 恢复", `第 ${region.page} 页 · 无需调用 API`, true);
      return;
    }
    if (!coverageIntervals && state.inFlightSignatures.has(signature)) {
      finishAnalysisProgress(taskId, "该视野正在识别", `第 ${region.page} 页 · 已有相同区域请求在运行`, true);
      return;
    }
    state.inFlightSignatures.add(signature);
    ownsSignature = true;

    setStatus(includeImage ? "正在理解当前视野（图文）…" : "正在理解当前视野（仅文本）…", "working");
    const spanPayload = region.spans.map(({ id, text, box }) => ({ id, text, bbox: box }));
    const textBytes = new TextEncoder().encode(JSON.stringify(spanPayload)).byteLength;
    const imageBytes = region.image ? estimateDataUrlBytes(region.image) : 0;
    const encodedImageBytes = region.image ? new TextEncoder().encode(region.image).byteLength : 0;
    const payloadDetail = `第 ${region.page} 页 · 文本 ${formatBytes(textBytes)}${region.image ? ` · 截图 ${formatBytes(imageBytes)} / 传输约 ${formatBytes(encodedImageBytes)} · ${precisionLabel(state.readerSettings.imagePrecision)}` : " · 无截图"}`;
    setAnalysisProgress(taskId, 2, region.image ? "截图已压缩，正在准备请求" : "文本载荷已准备", payloadDetail);
    const requestContent = [
      { type: "text", text: `页面文本片段：${JSON.stringify(spanPayload)}\n返回格式：{"annotations":[{"kind":"term|keypoint","targets":[{"span_id":"...","start":0,"end":4}],"label":"原文名词或重点短标题","explanation":"简洁中文解释","context":"为什么在本文语境重要","secondary_terms":[{"term":"解释中出现的二级名词","explanation":"一句话解释","parent_concept":"上级概念"}]}]}。start/end是对应文本片段中的字符下标，end不包含；重点可覆盖多个完整片段；名词必须精确到词，且 label 必须与 start/end 截出的原文完全一致。名词最多5个，重点最多3个。` },
    ];
    if (region.image) requestContent.push({ type: "image_url", image_url: { url: region.image } });
    setAnalysisProgress(taskId, 3, "请求已发出，等待模型响应", payloadDetail);
    const response = await requestVision([
      {
        role: "system",
        content: `你是学术PDF阅读助手。只分析用户当前视野。选择少量真正关键的重点和需要解释的专业名词。只要视野中存在完整、有语义的学术文本，就至少返回1个标注；只有目录、页眉页脚、参考文献编号或无实质语义内容时才能返回空数组。必须返回严格JSON，不使用Markdown。不要编造原文中不存在的span_id。${responseLanguageInstruction()}`,
      },
      {
        role: "user",
        content: region.image ? requestContent : requestContent[0].text,
      },
    ]);
    setAnalysisProgress(taskId, 4, "模型已响应，正在解析和定位", "校验 JSON、标注类型、span_id 与字符范围");
    const data = parseJsonResponse(extractAssistantText(response));
    if (coverageIntervals) await completeTaskCoverage(taskMemory, taskDocumentId, region.page, coverageIntervals, coverageEpoch);
    const initialAnnotations = Array.isArray(data.annotations) ? data.annotations : [];
    let accepted = await saveAnnotations(initialAnnotations, region, signature, taskMemory);
    let returned = initialAnnotations.length;

    if (accepted === 0 && hasSubstantiveText(region.spans)) {
      setStatus(returned ? "正在修复标注位置…" : "正在补充最小标注…", "working");
      setAnalysisProgress(taskId, 3, returned ? "首次结果无法定位，正在轻量修复" : "首次未返回标注，正在补充请求", `首次返回 ${returned} 个 · 第二次请求仅发送文本`);
      const repaired = await repairAnnotations(initialAnnotations, region);
      setAnalysisProgress(taskId, 4, "修复结果已返回，正在重新定位", `累计收到 ${returned + repaired.length} 个候选标注`);
      returned += repaired.length;
      accepted += await saveAnnotations(repaired, region, signature, taskMemory);
    }

    if (accepted > 0) {
      setAnalysisProgress(taskId, 5, "正在绘制划线并保存 memory", `有效标注 ${accepted} 个`);
      if (state.documentId === taskDocumentId) {
        state.regionSignatures.add(signature);
        renderPageAnnotations(region.page);
      }
      setStatus(`模型返回 ${returned} 个 · 绘制 ${accepted} 个`, "ready");
      finishAnalysisProgress(taskId, "视野理解完成", `第 ${region.page} 页 · 模型返回 ${returned} 个 · 绘制并保存 ${accepted} 个`, true);
    } else {
      setStatus("本次未生成有效标注，移动视野可重试");
      finishAnalysisProgress(taskId, "本次没有有效标注", `模型累计返回 ${returned} 个，但没有可映射到原文的标注`, false);
    }
    clearError();
  } catch (error) {
    console.error(error);
    setStatus("分析暂不可用");
    showError("当前视野分析失败", error);
    failAnalysisProgress(taskId, error);
  } finally {
    if (ownsSignature) state.inFlightSignatures.delete(signature);
    if (state.analysisTasks.has(taskId)) finishAnalysisProgress(taskId, "分析任务结束", "任务未产生可保存结果", false);
  }
}

function findUnderlineInCurrentFocus() {
  if (!state.memory || !state.pdf) return null;
  const viewerRect = ui.viewer.getBoundingClientRect();
  const focusRect = getFocusRect(viewerRect);
  for (const annotation of state.memory.list()) {
    if (!["term", "keypoint"].includes(annotation.kind)) continue;
    if (!isAnnotationAnchorConsistent(annotation)) continue;
    const record = state.pages.get(annotation.page);
    if (!record) continue;
    const pageRect = record.element.getBoundingClientRect();
    const boxes = annotation.anchor?.bboxes || (annotation.anchor?.bbox ? [annotation.anchor.bbox] : []);
    for (const [x1, y1, x2, y2] of boxes) {
      const underlineRect = {
        left: pageRect.left + x1 * pageRect.width,
        top: pageRect.top + y1 * pageRect.height,
        right: pageRect.left + x2 * pageRect.width,
        bottom: pageRect.top + y2 * pageRect.height,
      };
      if (intersectionArea(underlineRect, focusRect) > 0) return annotation;
    }
  }
  return null;
}

async function saveAnnotations(annotations, region, signature, memory) {
  let accepted = 0;
  for (const annotation of annotations) {
    if (await saveModelAnnotation(annotation, region, signature, memory)) accepted += 1;
  }
  return accepted;
}

async function repairAnnotations(annotations, region) {
  const spanPayload = region.spans.map(({ id, text }) => ({ id, text }));
  const response = await requestVision([
    {
      role: "system",
      content: `你是JSON标注修复器。只能引用给定的span id。必须返回严格JSON，不使用Markdown。${responseLanguageInstruction()}`,
    },
    {
      role: "user",
      content: `文本片段：${JSON.stringify(spanPayload)}\n原始候选：${JSON.stringify(annotations)}\n请修复为：{"annotations":[{"kind":"term|keypoint","targets":[{"span_id":"给定id","start":0,"end":4}],"label":"原文中的文字","explanation":"中文解释","context":"本文语境","secondary_terms":[]}]}。如果原始候选为空但文本有学术语义，请选择1至3个最值得标注的内容。start/end必须是对应片段的有效字符下标；名词 label 必须与 start/end 截出的原文完全一致。`,
    },
  ]);
  const repaired = parseJsonResponse(extractAssistantText(response));
  return Array.isArray(repaired.annotations) ? repaired.annotations : [];
}

function hasSubstantiveText(spans) {
  const text = spans.map((span) => span.text).join(" ").replace(/\s+/g, " ").trim();
  return text.length >= 32 && /[A-Za-z\u4e00-\u9fff]{3}/.test(text);
}

async function saveModelAnnotation(annotation, region, signature, memory) {
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
    if (kind === "term") {
      const exact = findExactTermRange(item.text, annotation.label, start);
      if (exact) {
        start = exact.start;
        end = exact.end;
      } else {
        const alternate = region.spans.map((candidate) => ({
          item: candidate,
          range: findExactTermRange(candidate.text, annotation.label),
        })).find((candidate) => candidate.range);
        if (!alternate) return null;
        return buildMatchedTextRange(alternate.item, alternate.range.start, alternate.range.end, region.record);
      }
    }
    if (end <= start) return null;
    return buildMatchedTextRange(item, start, end, region.record);
  }).filter(Boolean);
  if (!matched.length || !kind) return false;
  const label = String(annotation.label || matched.map((item) => item.text).join(" ")).slice(0, 240);
  const bboxes = matched.flatMap((item) => item.boxes);
  const id = `${kind}_${region.page}_${simpleHash(`${label}:${JSON.stringify(bboxes)}`)}`;
  await memory.append({
    event: "annotation_upsert", id, kind, page: region.page,
    region_signature: signature,
    anchor: { quote: matched.map((item) => item.selectedText || item.text).join(" "), bboxes },
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

function buildMatchedTextRange(item, start, end, record) {
  const boxes = getTextRangeBoxes(item, start, end, record);
  if (!boxes.length) return null;
  return { ...item, selectedText: item.text.slice(start, end), boxes };
}

function getTextRangeBoxes(item, start, end, record) {
  const pageRect = record?.element?.getBoundingClientRect();
  const startPoint = textOffsetPoint(item.element, start);
  const endPoint = textOffsetPoint(item.element, end);
  if (pageRect?.width && pageRect?.height && startPoint && endPoint) {
    try {
      const range = document.createRange();
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
      const boxes = [...range.getClientRects()].filter((rect) => rect.width > .25 && rect.height > .25).map((rect) => ([
        clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
        clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
        clamp((rect.right - pageRect.left) / pageRect.width, 0, 1),
        clamp((rect.bottom - pageRect.top) / pageRect.height, 0, 1),
      ]));
      if (boxes.length) return boxes;
    } catch (error) {
      console.warn("Fell back to proportional annotation geometry", error);
    }
  }
  const textLength = Math.max(1, item.text.length);
  const [x1, y1, x2, y2] = item.box;
  const width = x2 - x1;
  return [[x1 + width * start / textLength, y1, x1 + width * end / textLength, y2]];
}

function textOffsetPoint(element, sourceOffset) {
  if (!element) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, sourceOffset);
  let last = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    last = node;
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
  }
  return last ? { node: last, offset: last.data.length } : null;
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
  for (const annotation of state.memory.list().filter((item) => item.page === pageNumber && isAnnotationAnchorConsistent(item))) {
    const boxes = annotation.anchor?.bboxes || (annotation.anchor?.bbox ? [annotation.anchor.bbox] : []);
    for (const box of boxes) {
      const mark = document.createElement("button");
      mark.className = `annotation ${annotation.kind}`;
      mark.title = annotation.content?.label || "查看解释";
      mark.setAttribute("aria-label", mark.title);
      setNormalizedBox(mark, box);
      mark.addEventListener("click", (event) => {
        if (!state.annotationsVisible) return;
        event.stopPropagation();
        const anchorRect = mark.getBoundingClientRect();
        const overlapping = annotation.kind === "image" ? [annotation] : findAnnotationsAtPoint(pageNumber, event.clientX, event.clientY, annotation);
        if (overlapping.length > 1) openAnnotationChooser(overlapping, anchorRect);
        else openAnnotationBubble(annotation, anchorRect);
      });
      layer.append(mark);
    }
  }
}

function renderSentCoverage(pageNumber) {
  const record = state.pages.get(pageNumber);
  const layer = record?.element.querySelector(".sent-coverage-layer");
  if (!layer || !state.memory) return;
  layer.replaceChildren();
  for (const [start, end] of state.memory.getSentCoverage(pageNumber)) {
    const region = document.createElement("div");
    region.className = "sent-coverage-region";
    region.style.animationDelay = `${synchronizedAnimationDelay(performance.now(), SENT_COVERAGE_FULL_CYCLE_MS)}ms`;
    region.style.top = `${start * 100}%`;
    region.style.height = `${Math.max(0, end - start) * 100}%`;
    layer.append(region);
  }
}

function findAnnotationsAtPoint(pageNumber, clientX, clientY, primary = null) {
  if (!state.annotationsVisible) return [];
  if (!clientX && !clientY) return primary ? [primary] : [];
  const record = state.pages.get(pageNumber);
  if (!record) return primary ? [primary] : [];
  const pageRect = record.element.getBoundingClientRect();
  const x = (clientX - pageRect.left) / pageRect.width;
  const y = (clientY - pageRect.top) / pageRect.height;
  const verticalTolerance = 7 / Math.max(1, pageRect.height);
  const matches = new Map(primary ? [[primary.id, primary]] : []);
  for (const annotation of state.memory.list()) {
    if (annotation.page !== pageNumber || !["term", "keypoint"].includes(annotation.kind)) continue;
    if (!isAnnotationAnchorConsistent(annotation)) continue;
    const boxes = annotation.anchor?.bboxes || (annotation.anchor?.bbox ? [annotation.anchor.bbox] : []);
    if (boxes.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 - verticalTolerance && y <= y2 + verticalTolerance)) {
      matches.set(annotation.id, annotation);
    }
  }
  return [...matches.values()].sort((a, b) => (a.kind === "term" ? -1 : 1) - (b.kind === "term" ? -1 : 1));
}

function handleTextMapAnnotationClick(pageNumber, event) {
  if (!state.annotationsVisible) return;
  if (!document.getSelection()?.isCollapsed) return;
  const overlapping = findAnnotationsAtPoint(pageNumber, event.clientX, event.clientY);
  const imageAnnotation = overlapping.length ? null : findImageAnnotationAtPoint(pageNumber, event.clientX, event.clientY);
  if (!overlapping.length && !imageAnnotation) return;
  event.stopPropagation();
  const anchorRect = { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY, width: 0, height: 0 };
  if (overlapping.length > 1) openAnnotationChooser(overlapping, anchorRect);
  else openAnnotationBubble(overlapping[0] || imageAnnotation, anchorRect);
}

function findImageAnnotationAtPoint(pageNumber, clientX, clientY) {
  if (!state.annotationsVisible) return null;
  const record = state.pages.get(pageNumber);
  if (!record) return null;
  const pageRect = record.element.getBoundingClientRect();
  const x = (clientX - pageRect.left) / pageRect.width;
  const y = (clientY - pageRect.top) / pageRect.height;
  return state.memory.list().filter((annotation) => {
    if (annotation.page !== pageNumber || annotation.kind !== "image") return false;
    const boxes = annotation.anchor?.bboxes || (annotation.anchor?.bbox ? [annotation.anchor.bbox] : []);
    return boxes.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);
  }).at(-1) || null;
}

function openAnnotationChooser(annotations, anchorRect) {
  if (!state.annotationsVisible) return;
  state.bubbleStack = [];
  ui.bubbleLayer.replaceChildren();
  const chooser = document.createElement("section");
  chooser.className = "annotation-chooser";
  const heading = document.createElement("div");
  heading.className = "chooser-heading";
  heading.innerHTML = `<strong>${t("这里有多个标注", "Multiple annotations here")}</strong><button title="${t("关闭", "Close")}">×</button>`;
  heading.querySelector("button").addEventListener("click", closeBubbles);
  chooser.append(heading);
  for (const annotation of annotations) {
    const option = document.createElement("button");
    option.className = "annotation-option";
    const badge = document.createElement("span");
    badge.className = `annotation-badge ${annotation.kind}`;
    badge.textContent = annotation.kind === "term" ? t("名词", "Term") : t("重点", "Key point");
    const label = document.createElement("span");
    label.textContent = annotation.content?.label || annotation.anchor?.quote || t("查看解释", "View explanation");
    option.append(badge, label);
    option.addEventListener("click", () => openAnnotationBubble(annotation, anchorRect));
    chooser.append(option);
  }
  ui.bubbleLayer.append(chooser);
  const width = chooser.offsetWidth;
  const height = chooser.offsetHeight;
  const left = clamp(anchorRect.right + 9, 12, window.innerWidth - width - 12);
  const headerHeight = toolbarHeight();
  const top = clamp(anchorRect.bottom - headerHeight + 7, 12, window.innerHeight - headerHeight - height - 12);
  chooser.style.left = `${left}px`;
  chooser.style.top = `${top}px`;
}

function openAnnotationBubble(annotation, anchorRect) {
  if (!state.annotationsVisible) return;
  const bubble = {
    id: annotation.id,
    title: annotation.content?.label || (annotation.kind === "image" ? t("图片解释", "Image explanation") : t("解释", "Explanation")),
    explanation: annotation.content?.explanation || t("暂无解释", "No explanation yet"),
    context: annotation.content?.context || "",
    secondaryTerms: normalizeSecondaryTerms(annotation.content?.secondary_terms),
    annotation,
    isTerm: annotation.kind === "term",
    page: annotation.page,
    rootAnnotationId: annotation.id,
    anchorRect,
  };
  bubble.conceptPath = [bubble.title];
  hydrateBubbleQuestion(bubble);
  state.bubbleStack = [bubble];
  renderBubbles();
}

function openChildBubble(parentIndex, term, sourceButton) {
  state.bubbleStack = state.bubbleStack.slice(0, parentIndex + 1);
  const parent = state.bubbleStack[parentIndex];
  const conceptPath = [...parent.conceptPath, term.term];
  if (state.memory?.isBubbleDeleted(questionBindingKey(parent.rootAnnotationId, conceptPath))) return;
  const bubble = {
    id: `child_${simpleHash(term.term)}`,
    title: term.term,
    explanation: term.explanation || t("点击右上角问号获取详细解释。", "Use the question mark in the top-right for a detailed explanation."),
    context: term.parent_concept ? `${t("上级概念", "Parent concept")}: ${term.parent_concept}` : "",
    secondaryTerms: normalizeSecondaryTerms(term.secondary_terms),
    isTerm: true,
    page: parent.page,
    rootAnnotationId: parent.rootAnnotationId,
    conceptPath,
    anchorRect: sourceButton.getBoundingClientRect(),
  };
  hydrateBubbleQuestion(bubble);
  state.bubbleStack.push(bubble);
  renderBubbles();
}

function questionBindingKey(rootAnnotationId, conceptPath) {
  return JSON.stringify([rootAnnotationId || "", ...(conceptPath || [])]);
}

function questionTaskKey(documentId, binding) {
  return `${documentId}:${binding}`;
}

function hydrateBubbleQuestion(bubble) {
  bubble.questionBinding = questionBindingKey(bubble.rootAnnotationId, bubble.conceptPath);
  bubble.questionEvent = state.memory?.getQuestion(bubble.questionBinding) || null;
  bubble.questionLoading = state.questionTasks.has(questionTaskKey(state.documentId, bubble.questionBinding));
  return bubble;
}

function syncOpenBubbleQuestion(binding, { event = undefined, loading = undefined } = {}) {
  for (const openBubble of state.bubbleStack) {
    if (openBubble.questionBinding !== binding) continue;
    if (event !== undefined) openBubble.questionEvent = event;
    if (loading !== undefined) openBubble.questionLoading = loading;
  }
}

function renderBubbles() {
  ui.bubbleLayer.replaceChildren();
  const start = Math.max(0, state.bubbleStack.length - 3);
  state.bubbleStack.slice(start).forEach((bubble, visibleIndex) => {
    const actualIndex = start + visibleIndex;
    const element = document.createElement("section");
    element.className = "concept-bubble";
    element.dataset.depth = String(actualIndex);
    element.dataset.bubbleIndex = String(actualIndex);
    const path = state.bubbleStack.slice(0, actualIndex + 1).map((item) => item.title).join(" › ");
    element.innerHTML = `<div class="bubble-topbar"><div class="bubble-path"></div><div class="bubble-controls"><button class="delete" title="${t("删除气泡", "Delete bubble")}" aria-label="${t("删除气泡", "Delete bubble")}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" /></svg></button><button class="close" title="${t("关闭", "Close")}">×</button></div></div><div class="bubble-head"><h3></h3><button class="ask" title="${t("结合当前PDF视野详细解释", "Explain using the current PDF viewport")}">?</button></div><div class="bubble-body"></div>`;
    const pathElement = element.querySelector(".bubble-path");
    if (bubble.isTerm) {
      const quickLink = buildQuickLink(bubble.title, state.readerSettings);
      const wikiLink = document.createElement("a");
      wikiLink.className = "bubble-wiki-link";
      wikiLink.textContent = `${quickLink.label} · ${bubble.title}`;
      wikiLink.href = quickLink.url;
      wikiLink.target = "_blank";
      wikiLink.rel = "noopener noreferrer";
      pathElement.append(wikiLink);
    } else {
      pathElement.textContent = path;
    }
    element.querySelector("h3").textContent = bubble.title;
    element.querySelector("h3").dataset.bubbleField = "title";
    renderBubbleAnnotatedText(element.querySelector("h3"), bubble.title, bubble, actualIndex, "title", false);
    renderExplanation(element.querySelector(".bubble-body"), bubble, actualIndex);
    const ask = element.querySelector(".ask");
    ask.classList.toggle("saved", Boolean(bubble.questionEvent));
    ask.classList.toggle("loading", Boolean(bubble.questionLoading));
    if (bubble.questionLoading) {
      ask.replaceChildren(...[0, 1, 2].map(() => {
        const dot = document.createElement("span");
        dot.className = "ask-dot";
        dot.textContent = ".";
        dot.setAttribute("aria-hidden", "true");
        return dot;
      }));
      ask.setAttribute("aria-label", t("追问处理中", "Processing follow-up"));
    } else {
      ask.textContent = "?";
      ask.setAttribute("aria-label", bubble.questionEvent ? t("展开或收起已保存的追问", "Expand or collapse the saved follow-up") : t("结合当前 PDF 视野追问", "Ask using the current PDF viewport"));
    }
    ask.title = bubble.questionLoading
      ? t("API 正在处理追问", "The API is processing the follow-up")
      : bubble.questionEvent ? t("展开或收起已保存的追问", "Expand or collapse the saved follow-up") : t("结合当前 PDF 视野追问", "Ask using the current PDF viewport");
    ask.disabled = Boolean(bubble.questionLoading);
    ask.addEventListener("click", () => handleBubbleQuestion(actualIndex, ask));
    const deleteButton = element.querySelector(".delete");
    deleteButton.disabled = Boolean(bubble.questionLoading);
    deleteButton.addEventListener("click", () => deleteBubble(actualIndex));
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
  paragraph.dataset.bubbleField = "explanation";
  renderBubbleAnnotatedText(paragraph, bubble.explanation, bubble, bubbleIndex, "explanation", true);
  container.append(paragraph);
  if (bubble.context) {
    const context = document.createElement("div");
    context.className = "bubble-context";
    context.dataset.bubbleField = "context";
    renderBubbleAnnotatedText(context, bubble.context, bubble, bubbleIndex, "context", false);
    container.append(context);
  }
}

function renderBubbleAnnotatedText(container, text, bubble, bubbleIndex, field, includeSecondaryTerms) {
  container.replaceChildren();
  const value = String(text || "");
  const annotations = (state.memory?.getBubbleAnnotations(bubble.questionBinding) || []).filter((annotation) => (
    annotation.anchor?.field === field
    && Number.isFinite(annotation.anchor.start)
    && Number.isFinite(annotation.anchor.end)
    && annotation.anchor.end > annotation.anchor.start
    && annotation.anchor.start < value.length
  ));
  const renderAnnotations = annotations.map((annotation) => ({
    annotation,
    ...expandRangeToMathTokens(value, annotation.anchor.start, annotation.anchor.end),
  }));
  const boundaries = [...new Set([0, value.length, ...renderAnnotations.flatMap((item) => [
    item.start,
    item.end,
  ])])].sort((a, b) => a - b);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index], end = boundaries[index + 1];
    if (end <= start) continue;
    const segment = value.slice(start, end);
    const active = renderAnnotations
      .filter((item) => item.start < end && item.end > start)
      .map((item) => item.annotation);
    if (!active.length) {
      appendRichBubbleText(container, segment, start, includeSecondaryTerms ? visibleSecondaryTerms(bubble) : [], (term, button) => openChildBubble(bubbleIndex, term, button));
      continue;
    }
    const mark = document.createElement("span");
    mark.className = `bubble-note-mark ${[...new Set(active.map((annotation) => annotation.kind))].join(" ")}`;
    mark.setAttribute("role", "button");
    mark.tabIndex = 0;
    appendRichBubbleText(mark, segment, start, [], null);
    mark.title = active.map((annotation) => annotation.content?.label || annotation.anchor?.quote).join(" / ");
    const openMark = () => {
      const anchorRect = mark.getBoundingClientRect();
      if (active.length > 1) openBubbleNoteChooser(bubbleIndex, active, anchorRect);
      else openBubbleNote(bubbleIndex, active[0], anchorRect);
    };
    mark.addEventListener("click", openMark);
    mark.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openMark();
    });
    container.append(mark);
  }
}

function visibleSecondaryTerms(bubble) {
  return bubble.secondaryTerms.filter((term) => !state.memory?.isBubbleDeleted(
    questionBindingKey(bubble.rootAnnotationId, [...bubble.conceptPath, term.term]),
  ));
}

function appendRichBubbleText(container, text, baseOffset, terms, onTermClick) {
  for (const token of tokenizeMath(text)) {
    const segment = document.createElement("span");
    segment.dataset.sourceStart = String(baseOffset + token.start);
    segment.dataset.sourceEnd = String(baseOffset + token.end);
    if (token.type === "math") {
      segment.className = `bubble-math${token.displayMode ? " display" : " inline"}`;
      segment.dataset.mathSource = token.value;
      segment.title = token.value;
      renderMath(token.expression, segment, { displayMode: token.displayMode, throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" });
    } else if (terms?.length && onTermClick) {
      segment.className = "bubble-source-segment";
      appendTextWithTerms(segment, token.value, terms, onTermClick);
    } else {
      segment.className = "bubble-source-segment";
      segment.textContent = token.value;
    }
    container.append(segment);
  }
}

function openBubbleNote(bubbleIndex, annotation, anchorRect) {
  const parent = state.bubbleStack[bubbleIndex];
  if (!parent) return;
  state.bubbleStack = state.bubbleStack.slice(0, bubbleIndex + 1);
  const bubble = {
    id: annotation.id,
    title: annotation.content?.label || annotation.anchor?.quote || "标注",
    explanation: annotation.content?.explanation || "暂无解释",
    context: annotation.content?.context || "",
    secondaryTerms: normalizeSecondaryTerms(annotation.content?.secondary_terms),
    isTerm: annotation.kind === "term",
    page: annotation.page || parent.page,
    rootAnnotationId: parent.rootAnnotationId,
    conceptPath: [...parent.conceptPath, annotation.content?.label || annotation.anchor?.quote || "标注"],
    anchorRect,
    annotation,
  };
  hydrateBubbleQuestion(bubble);
  state.bubbleStack.push(bubble);
  renderBubbles();
}

function openBubbleNoteChooser(bubbleIndex, annotations, anchorRect) {
  ui.bubbleLayer.querySelector(".bubble-note-chooser")?.remove();
  const chooser = document.createElement("section");
  chooser.className = "annotation-chooser bubble-note-chooser";
  const heading = document.createElement("div");
  heading.className = "chooser-heading";
  heading.innerHTML = `<strong>这里有多个标注</strong><button title="关闭">×</button>`;
  heading.querySelector("button").addEventListener("click", () => chooser.remove());
  chooser.append(heading);
  for (const annotation of annotations) {
    const option = document.createElement("button");
    option.className = "annotation-option";
    option.innerHTML = `<span class="annotation-badge ${annotation.kind}">${annotation.kind === "term" ? "名词" : "重点"}</span><span></span>`;
    option.lastElementChild.textContent = annotation.content?.label || annotation.anchor?.quote || "查看解释";
    option.addEventListener("click", () => openBubbleNote(bubbleIndex, annotation, anchorRect));
    chooser.append(option);
  }
  ui.bubbleLayer.append(chooser);
  const left = clamp(anchorRect.right + 9, 12, window.innerWidth - chooser.offsetWidth - 12);
  const headerHeight = toolbarHeight();
  const top = clamp(anchorRect.bottom - headerHeight + 7, 12, window.innerHeight - headerHeight - chooser.offsetHeight - 12);
  chooser.style.left = `${left}px`;
  chooser.style.top = `${top}px`;
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
    const headerHeight = toolbarHeight();
    let top = index === 0 ? bubble.anchorRect.top - headerHeight : previousRect.top + 16;
    if (left + width > window.innerWidth - 12) {
      left = index === 0 ? bubble.anchorRect.left - width - 10 : Math.max(12, previousRect.left - width - 10);
    }
    top = clamp(top, 12, window.innerHeight - headerHeight - height - 12);
    left = clamp(left, 12, window.innerWidth - width - 12);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    previousRect = { left, top, right: left + width, bottom: top + height };
  });
}

function handleBubbleQuestion(index, sourceButton) {
  const bubble = state.bubbleStack[index];
  if (!bubble || bubble.questionLoading) return;
  const anchorRect = sourceButton.getBoundingClientRect();
  if (bubble.questionEvent) toggleQuestionBubble(index, anchorRect);
  else requestBubbleQuestion(bubble, anchorRect);
}

function toggleQuestionBubble(parentIndex, anchorRect) {
  const parent = state.bubbleStack[parentIndex];
  const next = state.bubbleStack[parentIndex + 1];
  if (next?.questionParentBinding === parent.questionBinding) {
    state.bubbleStack = state.bubbleStack.slice(0, parentIndex + 1);
    renderBubbles();
    return;
  }
  openQuestionBubble(parentIndex, anchorRect);
}

function openQuestionBubble(parentIndex, anchorRect) {
  const parent = state.bubbleStack[parentIndex];
  const event = parent?.questionEvent;
  if (!event) return;
  const content = event.content || {};
  state.bubbleStack = state.bubbleStack.slice(0, parentIndex + 1);
  const bubble = {
    id: event.id,
    title: content.label || "深入解释",
    explanation: content.explanation || "暂无追问结果",
    context: content.context || "",
    secondaryTerms: normalizeSecondaryTerms(content.secondary_terms),
    page: event.page || parent.page,
    rootAnnotationId: parent.rootAnnotationId,
    conceptPath: [...parent.conceptPath, "追问"],
    questionParentBinding: parent.questionBinding,
    anchorRect,
  };
  hydrateBubbleQuestion(bubble);
  state.bubbleStack.push(bubble);
  renderBubbles();
}

async function deleteBubble(index) {
  const bubble = state.bubbleStack[index];
  if (!bubble || !state.memory || bubble.questionLoading) return;
  const confirmed = window.confirm(t(
    `确定删除气泡“${bubble.title}”吗？删除会保存到当前 PDF memory。`,
    `Delete the bubble “${bubble.title}”? This deletion will be saved to the current PDF memory.`,
  ));
  if (!confirmed) return;

  try {
    if (bubble.questionParentBinding) {
      await state.memory.append({
        event: "bubble_question_delete",
        id: bubble.id,
        binding_key: bubble.questionParentBinding,
        parent_annotation_id: bubble.rootAnnotationId,
      });
      const parent = state.bubbleStack[index - 1];
      if (parent?.questionBinding === bubble.questionParentBinding) parent.questionEvent = null;
    } else if (bubble.annotation?.event === "bubble_annotation_upsert") {
      await state.memory.append({
        event: "bubble_annotation_delete",
        id: bubble.annotation.id,
        binding_key: bubble.annotation.binding_key,
        parent_annotation_id: bubble.rootAnnotationId,
      });
    } else if (index === 0 && bubble.annotation) {
      await state.memory.append({
        event: "annotation_delete",
        id: bubble.annotation.id,
        page: bubble.page,
      });
      renderPageAnnotations(bubble.page);
    } else {
      await state.memory.append({
        event: "bubble_delete",
        id: bubble.id,
        binding_key: bubble.questionBinding,
        parent_annotation_id: bubble.rootAnnotationId,
        concept_path: bubble.conceptPath,
      });
    }
    state.bubbleStack = state.bubbleStack.slice(0, index);
    renderBubbles();
    toast(t("气泡已删除", "Bubble deleted"));
  } catch (error) {
    console.warn("Handled bubble deletion failure", error);
    toast(t(`删除失败：${error.message}`, `Delete failed: ${error.message}`), true);
  }
}

async function requestBubbleQuestion(bubble, anchorRect) {
  const taskMemory = state.memory;
  const taskDocumentId = state.documentId;
  const binding = bubble.questionBinding;
  const registryKey = questionTaskKey(taskDocumentId, binding);
  if (state.questionTasks.has(registryKey)) return;
  const taskId = beginAnalysisProgress();
  state.questionTasks.set(registryKey, { taskId, binding, documentId: taskDocumentId });
  const bubbleContext = state.bubbleStack.map(({ title, explanation, context }) => ({ title, explanation, context }));
  syncOpenBubbleQuestion(binding, { loading: true });
  renderBubbles();
  try {
    setAnalysisProgress(taskId, 0, "正在捕捉追问上下文", `目标：${bubble.title}`);
    const region = await getCurrentRegion();
    if (!region) throw new Error("当前视野没有可用于追问的 PDF 内容。");
    if (state.documentId !== taskDocumentId) throw new Error("PDF 已切换，本次追问已结束。");
    setAnalysisProgress(taskId, 2, "追问载荷已准备", `第 ${region.page} 页 · 当前视野截图 + ${region.spans.length} 个文本片段`);
    const response = await requestVision([
      { role: "system", content: `你是严谨的学术概念导师。根据当前 PDF 视野和已展开概念链，详细解释目标概念。必须返回严格 JSON。${responseLanguageInstruction()}` },
      { role: "user", content: [
        { type: "text", text: `目标：${bubble.title}\n当前页面文本：${region.spans.map((item) => item.text).join(" ")}\n已展开气泡：${JSON.stringify(bubbleContext)}\n返回：{"label":"深入解释的短标题","explanation":"详细但清晰的解释","context":"它与当前论文内容的关系","secondary_terms":[{"term":"二级名词","explanation":"一句话解释","parent_concept":"上级概念"}]}` },
        { type: "image_url", image_url: { url: region.image } },
      ]},
    ]);
    setAnalysisProgress(taskId, 4, "追问结果已返回，正在保存", "解析 JSON 并绑定到当前气泡");
    const data = parseJsonResponse(extractAssistantText(response));
    const saved = await taskMemory.append({
      event: "bubble_question_upsert",
      id: `question_${simpleHash(binding)}`,
      page: region.page,
      binding_key: binding,
      parent_annotation_id: bubble.rootAnnotationId,
      parent_bubble_id: bubble.id,
      concept_path: bubble.conceptPath,
      content: {
        label: String(data.label || "深入解释"),
        explanation: String(data.explanation || "暂无追问结果"),
        context: String(data.context || ""),
        secondary_terms: normalizeSecondaryTerms(data.secondary_terms),
      },
      source: "manual_question_mllm",
    });
    if (state.documentId !== taskDocumentId) return;
    state.questionTasks.delete(registryKey);
    syncOpenBubbleQuestion(binding, { event: saved, loading: false });
    finishAnalysisProgress(taskId, "追问已保存", `已绑定到“${bubble.title}”`, true);
    const currentIndex = state.bubbleStack.findIndex((item) => item.questionBinding === binding);
    if (currentIndex >= 0) {
      const currentButton = ui.bubbleLayer.querySelector(`.concept-bubble[data-bubble-index="${currentIndex}"] .ask`);
      openQuestionBubble(currentIndex, currentButton?.getBoundingClientRect() || anchorRect);
    }
  } catch (error) {
    console.warn("Handled bubble question failure", error);
    state.questionTasks.delete(registryKey);
    syncOpenBubbleQuestion(binding, { loading: false });
    failAnalysisProgress(taskId, error);
    toast(error.message, true);
    if (state.documentId === taskDocumentId) renderBubbles();
  } finally {
    if (state.questionTasks.get(registryKey)?.taskId === taskId) state.questionTasks.delete(registryKey);
    if (state.documentId === taskDocumentId && !state.questionTasks.has(registryKey)) syncOpenBubbleQuestion(binding, { loading: false });
    if (state.analysisTasks.has(taskId)) finishAnalysisProgress(taskId, "追问任务结束", "未保存追问结果", false);
  }
}

function closeBubbles() {
  state.bubbleStack = [];
  ui.bubbleLayer.replaceChildren();
}

async function understandCurrentViewportImage() {
  if (!state.pdf || !state.memory) return;
  const taskId = beginAnalysisProgress();
  const taskContext = {
    taskId,
    memory: state.memory,
    documentId: state.documentId,
    imagePrecision: state.readerSettings.imagePrecision,
    openBubbles: state.bubbleStack.map(({ title, explanation }) => ({ title, explanation })),
    language: currentLanguage(),
  };
  const focusRect = getFocusRect(ui.viewer.getBoundingClientRect());
  state.activeImageTasks += 1;
  ui.understandImage.classList.add("active");
  try {
    setAnalysisProgress(taskId, 1, "正在捕捉当前视野图片", taskContext.language === "en" ? "The central viewport was frozen at click time" : "点击时的中央视野已固定");
    const pageNumber = await understandViewportImage(focusRect, taskContext);
    if (state.documentId !== taskContext.documentId) return;
    clearError();
    toast("图片解释已保存到当前 PDF memory");
    finishAnalysisProgress(taskId, "图片解释已保存", taskContext.language === "en" ? `Page ${pageNumber} · Image task complete` : `第 ${pageNumber} 页 · 图片任务完成`, true);
  } catch (error) {
    console.error(error);
    if (state.documentId === taskContext.documentId) showError("图片理解失败", error);
    failAnalysisProgress(taskId, error);
  } finally {
    state.activeImageTasks = Math.max(0, state.activeImageTasks - 1);
    ui.understandImage.classList.toggle("active", state.activeImageTasks > 0);
    if (state.analysisTasks.has(taskId)) finishAnalysisProgress(taskId, "图片理解任务结束", taskContext.language === "en" ? "No image explanation was saved" : "未保存图片解释", false);
  }
}

async function understandViewportImage(viewportRect, taskContext) {
    const { taskId, memory: taskMemory, documentId: taskDocumentId, imagePrecision, openBubbles, language } = taskContext;
    let target = null;
    for (const record of state.pages.values()) {
      const rect = record.element.getBoundingClientRect();
      const area = intersectionArea(rect, viewportRect);
      if (!target || area > target.area) target = { record, rect, area };
    }
    if (!target || target.area < 100) throw new Error(language === "en" ? "There is no capturable PDF content in the central viewport." : "当前中央视野没有可截取的 PDF 页面内容。");
    await renderPage(target.record.pageNumber);
    target.rect = target.record.element.getBoundingClientRect();
    const box = [
      clamp((viewportRect.left - target.rect.left) / target.rect.width, 0, 1),
      clamp((viewportRect.top - target.rect.top) / target.rect.height, 0, 1),
      clamp((viewportRect.right - target.rect.left) / target.rect.width, 0, 1),
      clamp((viewportRect.bottom - target.rect.top) / target.rect.height, 0, 1),
    ];
    setAnalysisProgress(taskId, 2, "正在压缩图片并整理上下文", language === "en"
      ? `Page ${target.record.pageNumber} · ${imagePrecision === "low" ? "low" : imagePrecision === "high" ? "high" : "balanced"} precision`
      : `第 ${target.record.pageNumber} 页 · ${precisionLabel(imagePrecision)}`);
    const dataUrl = cropCanvas(target.record.canvas, box, imagePrecision);
    const nearby = target.record.textItems.filter((item) => boxesIntersect(expandBox(box, .08), item.box)).map((item) => item.text).join(" ");
    const systemPrompt = language === "en"
      ? "You are an academic-figure reading assistant. Explain the reading order, visual elements, conclusion, and relationship to nearby text. Return strict JSON only. Write all explanatory text in English."
      : "你是学术论文图片阅读助手。解释图的阅读顺序、元素含义、结论以及与附近正文的关系。必须返回严格JSON。所有解释文本使用中文。";
    const userPrompt = language === "en"
      ? `Nearby text: ${nearby}\nOpen concepts: ${JSON.stringify(openBubbles)}\nReturn: {"label":"short figure title","explanation":"clear explanation","context":"relationship to the current paper content","secondary_terms":[{"term":"technical term in the figure","explanation":"one-sentence explanation","parent_concept":"parent concept"}]}`
      : `附近正文：${nearby}\n当前展开概念：${JSON.stringify(openBubbles)}\n返回：{"label":"图片短标题","explanation":"清晰解释","context":"与论文当前内容的关系","secondary_terms":[{"term":"图中专业名词","explanation":"一句话解释","parent_concept":"上级概念"}]}`;
    setAnalysisProgress(taskId, 3, "图片请求已发出，等待模型响应", language === "en"
      ? `Page ${target.record.pageNumber} · ${formatBytes(estimateDataUrlBytes(dataUrl))}`
      : `第 ${target.record.pageNumber} 页 · ${formatBytes(estimateDataUrlBytes(dataUrl))}`);
    const response = await requestVision([
      { role: "system", content: systemPrompt },
      { role: "user", content: [
        { type: "text", text: userPrompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ]},
    ]);
    setAnalysisProgress(taskId, 4, "图片结果已返回，正在保存 memory", language === "en"
      ? `Page ${target.record.pageNumber} · Parsing JSON`
      : `第 ${target.record.pageNumber} 页 · 正在解析 JSON`);
    const data = parseJsonResponse(extractAssistantText(response));
    if (state.documentId !== taskDocumentId) return target.record.pageNumber;
    const blob = await (await fetch(dataUrl)).blob();
    const assetHash = await sha256(await blob.arrayBuffer());
    const id = `image_${target.record.pageNumber}_${simpleHash(JSON.stringify(box))}`;
    const asset = await taskMemory.saveAsset(blob, `${id}.webp`);
    await taskMemory.append({
      event: "image_explanation_upsert", id, kind: "image", page: target.record.pageNumber,
      anchor: { bbox: box }, asset, asset_sha256: assetHash,
      content: { label: data.label || (language === "en" ? `Image on page ${target.record.pageNumber}` : `第 ${target.record.pageNumber} 页图片`), explanation: data.explanation || "", context: data.context || "", secondary_terms: normalizeSecondaryTerms(data.secondary_terms) },
      source: "manual_image_mllm",
    });
    renderPageAnnotations(target.record.pageNumber);
    return target.record.pageNumber;
}

function syncActiveApiProfileFromForm() {
  if (!state.apiProfileStore) return;
  const target = currentApiProfileDraft();
  if (!target) return;
  Object.assign(target, {
    endpoint: ui.apiEndpoint.value.trim(),
    model: ui.apiModel.value.trim(),
    apiKey: ui.apiKey.value.trim(),
  });
}

function updateAnnotationVisibilityControl() {
  const visible = state.annotationsVisible;
  ui.workspace.classList.toggle("annotations-hidden", !visible);
  ui.toggleAnnotations.setAttribute("aria-pressed", String(visible));
  const label = visible ? t("隐藏所有注释", "Hide all annotations") : t("显示所有注释", "Show all annotations");
  ui.toggleAnnotations.title = label;
  ui.toggleAnnotations.setAttribute("aria-label", label);
}

function toggleAnnotations() {
  if (!state.pdf) return;
  state.annotationsVisible = !state.annotationsVisible;
  if (!state.annotationsVisible) {
    if (document.activeElement?.closest?.(".annotation-layer, .bubble-layer")) document.activeElement.blur();
    closeBubbles();
  }
  updateAnnotationVisibilityControl();
  toast(state.annotationsVisible ? t("所有注释已显示", "All annotations shown") : t("所有注释已隐藏", "All annotations hidden"));
}

let copyTitleFeedbackTimer;
async function copyDocumentTitle() {
  const title = state.pdfTitle.trim();
  if (!title) return;
  try {
    await writeClipboardText(title);
    clearTimeout(copyTitleFeedbackTimer);
    ui.copyTitle.classList.add("copied");
    copyTitleFeedbackTimer = setTimeout(() => ui.copyTitle.classList.remove("copied"), 900);
    toast(t("标题已复制", "Title copied"));
  } catch (error) {
    toast(t("复制标题失败", "Could not copy title"), true);
    console.warn("Could not copy PDF title", error);
  }
}

async function writeClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  Object.assign(input.style, { position: "fixed", inset: "0 auto auto -9999px", opacity: "0" });
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Clipboard copy was rejected");
  } finally {
    input.remove();
  }
}

function currentApiProfileDraft() {
  const store = state.apiProfileStore;
  if (!store) return null;
  return store.profiles.find((profile) => profile.id === store.activeProfileId) || store.profiles[0] || null;
}

function fillApiProfileForm() {
  const profile = currentApiProfileDraft();
  if (!profile) return;
  ui.apiEndpoint.value = profile.endpoint || "";
  ui.apiModel.value = profile.model || "";
  ui.apiKey.value = profile.apiKey || "";
}

function renderApiProfileSelector({ fillForm = true } = {}) {
  const store = state.apiProfileStore;
  if (!store) return;
  ui.apiProfileSelect.replaceChildren(...store.profiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    return option;
  }));
  ui.apiProfileSelect.value = store.activeProfileId;
  ui.deleteApiProfile.disabled = store.profiles.length <= 1;
  if (fillForm) fillApiProfileForm();
}

function switchApiProfile() {
  if (!state.apiProfileStore) return;
  syncActiveApiProfileFromForm();
  state.apiProfileStore.activeProfileId = ui.apiProfileSelect.value;
  fillApiProfileForm();
  ui.apiTestResult.textContent = "";
  ui.apiTestResult.className = "api-test-result";
}

function nextApiProfileName() {
  const names = new Set((state.apiProfileStore?.profiles || []).map((profile) => profile.name.toLocaleLowerCase()));
  let index = 1;
  while (names.has(`api ${index}`)) index += 1;
  return `API ${index}`;
}

function addApiProfile() {
  if (!state.apiProfileStore) return;
  syncActiveApiProfileFromForm();
  const profile = {
    id: `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: nextApiProfileName(),
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "",
    apiKey: "",
  };
  state.apiProfileStore.profiles.push(profile);
  state.apiProfileStore.activeProfileId = profile.id;
  renderApiProfileSelector();
  ui.apiEndpoint.focus();
}

function renameApiProfile() {
  if (!state.apiProfileStore) return;
  syncActiveApiProfileFromForm();
  const profile = currentApiProfileDraft();
  const name = window.prompt(t("输入新的 API 配置名称", "Enter a new API profile name"), profile.name)?.trim();
  if (!name || name === profile.name) return;
  if (state.apiProfileStore.profiles.some((item) => item.id !== profile.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    toast(t("API 配置名称不能重复", "API profile names must be unique"), true);
    return;
  }
  profile.name = name;
  renderApiProfileSelector({ fillForm: false });
}

function deleteApiProfile() {
  const store = state.apiProfileStore;
  if (!store) return;
  if (store.profiles.length <= 1) {
    toast(t("至少需要保留一个 API 配置", "At least one API profile is required"), true);
    return;
  }
  syncActiveApiProfileFromForm();
  const index = store.profiles.findIndex((profile) => profile.id === store.activeProfileId);
  const profile = currentApiProfileDraft();
  if (!window.confirm(t(`删除 API 配置“${profile.name}”？`, `Delete API profile “${profile.name}”?`))) return;
  store.profiles.splice(Math.max(0, index), 1);
  store.activeProfileId = store.profiles[Math.min(Math.max(0, index), store.profiles.length - 1)].id;
  renderApiProfileSelector();
}

function localizeApiSettingsError(error) {
  const name = error?.profileName || currentApiProfileDraft()?.name || "";
  const messages = {
    API_PROFILE_REQUIRED: t("至少需要保留一个 API 配置。", "At least one API profile is required."),
    API_PROFILE_NAME_REQUIRED: t("API 配置名称不能为空。", "The API profile name cannot be empty."),
    API_PROFILE_NAME_DUPLICATE: t(`API 配置名称不能重复：${name}`, `API profile names must be unique: ${name}`),
    API_PROFILE_INCOMPLETE: t(
      name ? `请完整填写“${name}”的地址、模型和 API Key。` : "请完整填写地址、模型和 API Key。",
      name ? `Complete the endpoint, model, and API Key for “${name}”.` : "Complete the endpoint, model, and API Key.",
    ),
    API_ENDPOINT_INVALID: t("API 地址无效。", "The API endpoint is invalid."),
    API_ENDPOINT_PROTOCOL: t("API 地址必须以 http:// 或 https:// 开头。", "The API endpoint must start with http:// or https://."),
    API_PERMISSION_REQUIRED: t("需要允许访问 API 域名才能发送请求。", "Allow access to the API domain before sending requests."),
    API_SETTINGS_REQUIRED: t("请先设置 API 地址、模型和 API Key。", "Configure an API endpoint, model, and API Key first."),
  };
  if (!messages[error?.code]) return error;
  return Object.assign(new Error(messages[error.code]), { code: error.code });
}

async function openSettings() {
  state.apiProfileStore = await loadApiProfileStore();
  renderApiProfileSelector();
  ui.focusHeight.value = String(state.readerSettings.focusHeight);
  ui.focusHeightValue.value = `${state.readerSettings.focusHeight}%`;
  ui.showFocusGuide.checked = state.readerSettings.showFocusGuide;
  ui.showStatusBubble.checked = state.readerSettings.showStatusBubble;
  ui.payloadModes.forEach((input) => { input.checked = input.value === state.readerSettings.viewportPayloadMode; });
  ui.imagePrecision.value = state.readerSettings.imagePrecision;
  ui.quickLinkProvider.value = state.readerSettings.quickLinkProvider;
  ui.quickLinkCustomLabel.value = state.readerSettings.quickLinkCustomLabel;
  ui.quickLinkCustomTemplate.value = state.readerSettings.quickLinkCustomTemplate;
  ui.interfaceLanguage.value = state.readerSettings.language;
  updateImagePrecisionState();
  updateQuickLinkCustomState();
  ui.apiTestResult.textContent = "";
  ui.apiTestResult.className = "api-test-result";
  ui.settingsDialog.showModal();
}

async function testApiConnection() {
  const button = $("#testApi");
  button.disabled = true;
  ui.apiTestResult.textContent = t("正在测试接口、权限和模型响应…", "Testing the endpoint, permission, and model response…");
  ui.apiTestResult.className = "api-test-result";
  try {
    syncActiveApiProfileFromForm();
    const profile = currentApiProfileDraft();
    const testedProfile = await authorizeApiProfile(profile);
    Object.assign(profile, testedProfile);
    fillApiProfileForm();
    const testImage = createApiTestImage();
    const response = await requestVision([
      { role: "system", content: "只返回严格JSON，不使用Markdown。" },
      { role: "user", content: [
        { type: "text", text: "这是一次视觉模型连接测试。读取附带的小图片，然后返回 {\"ok\":true,\"message\":\"连接成功\"}" },
        { type: "image_url", image_url: { url: testImage } },
      ] },
    ], testedProfile);
    const text = extractAssistantText(response);
    parseJsonResponse(text);
    ui.apiTestResult.textContent = t("连接成功：接口可访问，模型能返回可解析文本。", "Connection successful: the endpoint is reachable and the model returned parseable text.");
    ui.apiTestResult.className = "api-test-result success";
    clearError();
  } catch (error) {
    const localizedError = localizeApiSettingsError(error);
    ui.apiTestResult.textContent = localizedError.message;
    ui.apiTestResult.className = "api-test-result error";
    showError(t("API 连接测试失败", "API connection test failed"), localizedError);
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
    syncActiveApiProfileFromForm();
    state.apiProfileStore = await saveApiProfileStore(state.apiProfileStore);
    await saveReaderSettings();
    ui.settingsDialog.close();
    toast("设置已保存在本地");
    clearError();
    if (state.pdf) scheduleAnalysis(100);
  } catch (error) { toast(localizeApiSettingsError(error).message, true); }
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

async function importMemory(file) {
  if (!file || !state.memory || !state.pdf) return;
  try {
    let result;
    try {
      result = await state.memory.importJsonl(file);
    } catch (error) {
      if (error?.code !== "MEMORY_LEGACY_CONFIRMATION_REQUIRED") throw error;
      const accepted = window.confirm(t(
        "这是旧版 memory，没有 PDF 哈希，无法自动确认它属于当前论文。仍要导入吗？",
        "This is a legacy memory without a PDF hash, so its paper cannot be verified automatically. Import it anyway?",
      ));
      if (!accepted) return;
      result = await state.memory.importJsonl(file, { allowLegacy: true });
    }

    for (const event of state.memory.events) {
      if (event.region_signature) state.regionSignatures.add(event.region_signature);
    }
    closeBubbles();
    for (const pageNumber of state.pages.keys()) renderPageAnnotations(pageNumber);
    if (!result.imported && !result.skipped) {
      toast(t("该 memory 暂时没有可导入的标注", "This memory does not contain any annotations yet"));
    } else {
      toast(t(
        `已导入 ${result.imported} 条 memory，跳过 ${result.skipped} 条重复记录`,
        `Imported ${result.imported} memory records; skipped ${result.skipped} duplicates`,
      ));
    }
  } catch (error) {
    console.warn("Handled memory import failure", error);
    if (error?.code === "MEMORY_DOCUMENT_MISMATCH") {
      toast(t("导入失败：该 memory 属于另一份 PDF", "Import failed: this memory belongs to a different PDF"), true);
    } else {
      toast(t(`导入失败：${error.message}`, `Import failed: ${error.message}`), true);
    }
  } finally {
    ui.memoryInput.value = "";
  }
}

function cropCanvas(canvas, normalizedBox, precision = "balanced") {
  const [x1, y1, x2, y2] = normalizedBox;
  const sx = Math.floor(x1 * canvas.width), sy = Math.floor(y1 * canvas.height);
  const sw = Math.max(1, Math.floor((x2 - x1) * canvas.width));
  const sh = Math.max(1, Math.floor((y2 - y1) * canvas.height));
  const profile = IMAGE_PRECISION[precision] || IMAGE_PRECISION.balanced;
  const maxSide = profile.maxSide;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const output = document.createElement("canvas");
  output.width = Math.max(16, Math.floor(sw * scale));
  output.height = Math.max(16, Math.floor(sh * scale));
  output.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return output.toDataURL("image/webp", profile.quality);
}

function normalizeSecondaryTerms(terms) {
  return Array.isArray(terms) ? terms.slice(0, 8).map((item) => typeof item === "string" ? { term: item, explanation: "", parent_concept: "" } : {
    term: String(item?.term || ""), explanation: String(item?.explanation || ""), parent_concept: String(item?.parent_concept || ""), secondary_terms: normalizeSecondaryTerms(item?.secondary_terms),
  }).filter((item) => item.term) : [];
}

function handleKeydown(event) {
  if (event.key !== "Escape") return;
  if (!ui.selectionTools.classList.contains("hidden")) {
    hideSelectionTools();
    document.getSelection()?.removeAllRanges();
    return;
  }
  if (state.bubbleStack.length) {
    state.bubbleStack.pop();
    renderBubbles();
  }
}

async function loadReaderSettings() {
  const stored = await chrome.storage.local.get(READER_SETTINGS_KEY);
  const value = stored[READER_SETTINGS_KEY] || {};
  state.readerSettings = {
    language: value.language === "en" ? "en" : "zh",
    focusHeight: clamp(Number(value.focusHeight) || 60, 20, 100),
    showFocusGuide: value.showFocusGuide === undefined ? true : Boolean(value.showFocusGuide),
    showStatusBubble: value.showStatusBubble === undefined ? true : Boolean(value.showStatusBubble),
    viewportPayloadMode: value.viewportPayloadMode === "text" ? "text" : "image",
    imagePrecision: IMAGE_PRECISION[value.imagePrecision] ? value.imagePrecision : "balanced",
    ...normalizeQuickLinkSettings(value),
  };
  applyInterfaceLanguage();
  updateStatusBubbleVisibility();
  updateFocusGuide();
}

async function saveReaderSettings() {
  const quickLinkSettings = validateQuickLinkSettings(normalizeQuickLinkSettings({
    quickLinkProvider: ui.quickLinkProvider.value,
    quickLinkCustomLabel: ui.quickLinkCustomLabel.value,
    quickLinkCustomTemplate: ui.quickLinkCustomTemplate.value,
  }));
  state.readerSettings = {
    language: ui.interfaceLanguage.value === "en" ? "en" : "zh",
    focusHeight: clamp(Number(ui.focusHeight.value) || 60, 20, 100),
    showFocusGuide: ui.showFocusGuide.checked,
    showStatusBubble: ui.showStatusBubble.checked,
    viewportPayloadMode: ui.payloadModes.find((input) => input.checked)?.value === "text" ? "text" : "image",
    imagePrecision: IMAGE_PRECISION[ui.imagePrecision.value] ? ui.imagePrecision.value : "balanced",
    ...quickLinkSettings,
  };
  await chrome.storage.local.set({ [READER_SETTINGS_KEY]: state.readerSettings });
  updateStatusBubbleVisibility();
  updateFocusGuide();
}

function previewReaderSettings() {
  state.readerSettings.focusHeight = clamp(Number(ui.focusHeight.value) || 60, 20, 100);
  state.readerSettings.language = ui.interfaceLanguage.value === "en" ? "en" : "zh";
  state.readerSettings.showFocusGuide = ui.showFocusGuide.checked;
  state.readerSettings.showStatusBubble = ui.showStatusBubble.checked;
  state.readerSettings.viewportPayloadMode = ui.payloadModes.find((input) => input.checked)?.value === "text" ? "text" : "image";
  state.readerSettings.imagePrecision = IMAGE_PRECISION[ui.imagePrecision.value] ? ui.imagePrecision.value : "balanced";
  Object.assign(state.readerSettings, normalizeQuickLinkSettings({
    quickLinkProvider: ui.quickLinkProvider.value,
    quickLinkCustomLabel: ui.quickLinkCustomLabel.value,
    quickLinkCustomTemplate: ui.quickLinkCustomTemplate.value,
  }));
  ui.focusHeightValue.value = `${state.readerSettings.focusHeight}%`;
  updateImagePrecisionState();
  updateQuickLinkCustomState();
  applyInterfaceLanguage();
  updateStatusBubbleVisibility();
  updateFocusGuide();
  if (state.bubbleStack.length) renderBubbles();
}

function updateImagePrecisionState() {
  const enabled = ui.payloadModes.find((input) => input.checked)?.value === "image";
  ui.imagePrecision.disabled = !enabled;
  ui.imagePrecisionRow.classList.toggle("disabled", !enabled);
}

function updateQuickLinkCustomState() {
  ui.quickLinkCustom.classList.toggle("hidden", ui.quickLinkProvider.value !== "custom");
}

function beginAnalysisProgress() {
  const taskId = ++state.nextAnalysisTaskId;
  state.analysisTasks.set(taskId, {
    id: taskId,
    startedAt: performance.now(),
    title: localizeRuntimeText("准备理解当前视野"),
    detail: localizeRuntimeText("等待当前视野稳定"),
  });
  if (!state.progressTimer) state.progressTimer = setInterval(renderActiveAnalysisStatus, 100);
  renderActiveAnalysisStatus();
  return taskId;
}

function setAnalysisProgress(taskId, _step, title, detail) {
  const task = state.analysisTasks.get(taskId);
  if (!task) return;
  task.title = localizeRuntimeText(title);
  task.detail = localizeRuntimeText(detail);
  renderActiveAnalysisStatus();
}

function finishAnalysisProgress(taskId, title, detail, success) {
  const task = state.analysisTasks.get(taskId);
  if (!task) return;
  const elapsed = ((performance.now() - task.startedAt) / 1000).toFixed(1);
  state.analysisTasks.delete(taskId);
  if (state.analysisTasks.size) {
    renderActiveAnalysisStatus();
  } else {
    stopAnalysisStatusTimer();
    setStatus(`${localizeRuntimeText(title)} · ${elapsed}s`, success ? "ready" : "");
    ui.analysisState.title = localizeRuntimeText(detail);
  }
}

function failAnalysisProgress(taskId, error) {
  const task = state.analysisTasks.get(taskId);
  if (!task) return;
  const elapsed = ((performance.now() - task.startedAt) / 1000).toFixed(1);
  const detail = error?.message || String(error || "未知错误");
  state.analysisTasks.delete(taskId);
  if (state.analysisTasks.size) {
    renderActiveAnalysisStatus();
  } else {
    stopAnalysisStatusTimer();
    setStatus(`视野理解失败 · ${elapsed}s`);
    ui.analysisState.title = detail;
  }
}

function renderActiveAnalysisStatus() {
  if (!state.analysisTasks.size) return;
  const tasks = [...state.analysisTasks.values()].sort((a, b) => b.id - a.id);
  const latest = tasks[0];
  const elapsed = ((performance.now() - latest.startedAt) / 1000).toFixed(1);
  const parallel = tasks.length > 1 ? ` · ${tasks.length} ${t("个并行任务", "parallel tasks")}` : "";
  setStatus(`${latest.title} · ${elapsed}s${parallel}`, "working", `analysis-task:${latest.id}`);
  ui.analysisState.title = `${latest.detail}${tasks.length > 1 ? `\n${t(`另有 ${tasks.length - 1} 个较早任务仍在处理中`, `${tasks.length - 1} earlier task(s) still running`)}` : ""}`;
}

function stopAnalysisStatusTimer() {
  clearInterval(state.progressTimer);
  state.progressTimer = 0;
}

function estimateDataUrlBytes(dataUrl) {
  const encoded = String(dataUrl).split(",")[1] || "";
  return Math.max(0, Math.floor(encoded.length * .75) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function precisionLabel(value) {
  return value === "low" ? "低精度" : value === "high" ? "高精度" : "标准精度";
}

function toolbarHeight() {
  return ui.toolbar?.getBoundingClientRect().height || 58;
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
  if (state.bubbleStack.length) renderBubbles();
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
function intersectionArea(a, b) { const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)); const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); return width * height; }
function boxesIntersect(a, b) { return Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]); }
function expandBox([x1, y1, x2, y2], amount) { return [clamp(x1 - amount, 0, 1), clamp(y1 - amount, 0, 1), clamp(x2 + amount, 0, 1), clamp(y2 + amount, 0, 1)]; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function simpleHash(value) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function dismissCurrentStatus() {
  state.dismissedStatusKey = ui.statusShell.dataset.statusKey || "initial";
  ui.statusShell.classList.add("dismissed");
}
function updateStatusBubbleVisibility() {
  ui.statusShell.classList.toggle("hidden-by-setting", !state.readerSettings.showStatusBubble);
}
function setStatus(text, className = "", statusKey = "") {
  const localizedText = localizeRuntimeText(text);
  const key = statusKey || `message:${className}:${localizedText}`;
  ui.analysisState.textContent = localizedText;
  ui.analysisState.className = `status ${className}`.trim();
  ui.analysisState.title = "";
  ui.statusShell.dataset.statusKey = key;
  ui.statusShell.classList.toggle("dismissed", state.dismissedStatusKey === key);
}
let toastTimer;
function toast(message, error = false) { clearTimeout(toastTimer); ui.toast.textContent = localizeRuntimeText(message); ui.toast.className = `toast show${error ? " error" : ""}`; toastTimer = setTimeout(() => { ui.toast.className = "toast"; }, 4200); }
function showError(title, error, action = null) {
  const detail = error?.message || String(error || "未知错误");
  ui.errorTitle.textContent = localizeRuntimeText(title);
  ui.errorDetail.textContent = detail;
  state.errorAction = action;
  $("#errorSettings").textContent = action?.label || t("检查 API 设置", "Check API settings");
  ui.errorPanel.classList.remove("hidden");
  ui.errorPanel.title = detail;
  toast(detail, true);
}
function clearError() {
  ui.errorPanel.classList.add("hidden");
  ui.errorDetail.textContent = "";
  state.errorAction = null;
  $("#errorSettings").textContent = t("检查 API 设置", "Check API settings");
}
