# Paper Noter v0.7.8

## 中文

Paper Noter v0.7.8 改进了 PDF 在浏览器缩放后的文字和矢量图清晰度。

主要更新：

- 浏览器缩放或设备像素密度变化后，自动按新的分辨率重绘当前页及邻近页。
- 滚动到此前以较低分辨率加载的页面时，会自动补充高清重绘。
- Canvas 重绘不会重复创建文本层、注释或 PDF memory，也不会改变标注坐标。
- 同时识别浏览器缩放与触控板/触屏捏合缩放，并把单页高清重绘上限提高到约 3600 万像素。

Full 安装包包含完整 CMap、标准字体回退、WASM 与 ICC 资源。

## English

Paper Noter v0.7.8 improves text and vector-figure clarity after browser zooming.

Highlights:

- Re-renders the current and nearby pages at the new resolution when browser zoom or device pixel density changes.
- Refreshes previously low-resolution pages when they return near the viewport.
- Re-renders only the canvas without rebuilding text layers, annotations, or PDF memory, preserving annotation coordinates.
- Responds to both browser zoom and trackpad/touch pinch zoom, with a higher per-page redraw ceiling of approximately 36 megapixels.

The Full package includes complete CMaps, standard-font fallbacks, WASM, and ICC resources.
