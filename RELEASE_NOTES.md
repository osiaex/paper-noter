# Paper Noter v0.7

## 中文

Paper Noter v0.7 聚焦于可靠的本地记忆迁移、更安全的 PDF 读取，以及更准确、更克制的阅读标注体验。

主要更新：

- 为每篇 PDF 提供可导入、导出的便携 JSONL memory，并自动合并去重。
- 使用文件 SHA-256 与布局指纹安全匹配 memory；纯文本指纹不会直接复用旧坐标。
- 本地 PDF 在进入阅读器前进行短期缓存，并提供 fetch、XHR 与手动选择回退。
- 修复模型名词与错误字符坐标不一致导致的错位划线，改用真实 DOM Range 定位。
- 支持删除根气泡、嵌套概念、气泡 noting 与追问结果，并持久保存删除状态。
- 改进超长术语换行、气泡操作区、双层划线位置与 30% 透明度。
- 默认显示视野边框，并同步所有“已发送、未完成”区域的柔和呼吸动画。
- 空 memory、图片型 PDF 与抽样页损坏均可安全降级，不影响正常阅读。

Full 安装包包含完整 CMap、标准字体回退、WASM 与 ICC 资源。

## English

Paper Noter v0.7 focuses on portable local memory, safer PDF loading, and more accurate, restrained reading annotations.

Highlights:

- Portable JSONL memory import/export for each PDF, with deduplicated merging.
- Safe memory matching with file SHA-256 and layout fingerprints; text-only identity never reuses old coordinates automatically.
- Short-lived local-PDF caching before reader navigation, followed by fetch, XHR, and manual-selection fallbacks.
- Exact term-to-source validation and real DOM Range geometry to prevent misplaced underlines.
- Persistent deletion for root bubbles, nested concepts, bubble noting, and follow-up results.
- Better long-term wrapping, bubble controls, dual-underline positioning, and 30% underline transparency.
- A visible-by-default focus guide and synchronized, gentle breathing for sent-but-unfinished regions.
- Safe degradation for empty memories, image-only PDFs, and damaged sampled text layers.

The Full package includes complete CMaps, standard-font fallbacks, WASM, and ICC resources.
