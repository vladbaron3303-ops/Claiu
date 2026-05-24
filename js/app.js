/*
 * Главный модуль: связывает UI, инструменты, рендерер и промты.
 */

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initTabs();
  initDrawingTab();
  initGeometryTab();
  initPromptsTab();
});

/* ============ переключение темы ============ */
function initThemeToggle() {
  const btn = document.getElementById("themeToggle");
  const saved = localStorage.getItem("drawai_theme");
  if (saved === "light") document.documentElement.classList.add("light");
  btn.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
    localStorage.setItem("drawai_theme",
      document.documentElement.classList.contains("light") ? "light" : "dark");
  });
}

/* ============ переключение вкладок ============ */
function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById("panel-" + t.dataset.tab).classList.add("active");
    // когда вкладка показывается — переотрисуем сетку, чтобы заполнить viewport правильно
    window.dispatchEvent(new Event("resize"));
  }));
}

/* ============ ВКЛАДКА: ЧЕРЧЕНИЕ ============ */
let drawingViewer;
let drawingState = {
  format: "A3",
  orientation: "landscape",
  stamp: true,
  frame: true,
  title: {}
};

function initDrawingTab() {
  drawingViewer = createViewer(document.getElementById("d-svg"), document.getElementById("d-status"));

  // Контролы формата
  document.getElementById("d-format").addEventListener("change", e => {
    drawingState.format = e.target.value;
    redrawDrawing();
  });
  document.querySelectorAll('input[name="d-orient"]').forEach(r => {
    r.addEventListener("change", e => {
      if (e.target.checked) { drawingState.orientation = e.target.value; redrawDrawing(); }
    });
  });
  document.getElementById("d-stamp").addEventListener("change", e => { drawingState.stamp = e.target.checked; redrawDrawing(); });
  document.getElementById("d-frame").addEventListener("change", e => { drawingState.frame = e.target.checked; redrawDrawing(); });

  // Штамп — поля
  const titleFields = {
    "t-name": "name", "t-designation": "designation",
    "t-scale": "scale", "t-mass": "mass",
    "t-material": "material", "t-author": "author",
    "t-checker": "checker", "t-school": "school"
  };
  Object.entries(titleFields).forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => {
      drawingState.title[key] = el.value;
      redrawDrawing();
    });
  });

  // Сетка
  bindGridControls(drawingViewer, "d-");

  // Инструменты
  bindToolButtons(drawingViewer, "#panel-drawing");

  // Zoom-кнопки
  document.getElementById("d-zoomIn").addEventListener("click", () => zoomBy(drawingViewer, 1.2));
  document.getElementById("d-zoomOut").addEventListener("click", () => zoomBy(drawingViewer, 1 / 1.2));
  document.getElementById("d-zoomFit").addEventListener("click", () => fitDrawingToView());

  // Экспорт / печать
  document.getElementById("d-exportSvg").addEventListener("click", () => exportSvg(drawingViewer, "chertezh.svg"));
  document.getElementById("d-exportPng").addEventListener("click", () => exportPng(drawingViewer, "chertezh.png"));
  document.getElementById("d-print").addEventListener("click", () => window.print());

  // Кодовая панель
  document.getElementById("d-render").addEventListener("click", renderDrawingFromCode);
  document.getElementById("d-clear").addEventListener("click", () => {
    document.getElementById("d-code").value = "";
    redrawDrawing();
    setMsg("d-msg", "Очищено", "ok");
  });
  document.getElementById("d-example").addEventListener("click", () => {
    document.getElementById("d-code").value = EXAMPLE_DRAWING;
    renderDrawingFromCode();
  });
  document.getElementById("d-copyPrompt").addEventListener("click", () => {
    copyToClipboard(PROMPTS.drawing.universal);
    setMsg("d-msg", "Промт скопирован в буфер обмена.", "ok");
  });

  // Первоначальная отрисовка
  redrawDrawing();
  setTimeout(() => fitDrawingToView(), 50);
}

function redrawDrawing(parsed) {
  const v = drawingViewer;
  // Сначала рисуем формат (рамка + штамп)
  while (v.contentG.firstChild) v.contentG.removeChild(v.contentG.firstChild);
  while (v.defs.firstChild) v.defs.removeChild(v.defs.firstChild);
  const info = buildFormat(SVG_NS, v.contentG, {
    format: drawingState.format,
    orientation: drawingState.orientation,
    stamp: drawingState.stamp,
    frame: drawingState.frame,
    title: drawingState.title
  });
  v.contentW = info.paper.w; v.contentH = info.paper.h;

  // Если есть пользовательский JSON — рисуем поверх
  if (parsed) {
    const origin = parsed.origin || { x: info.work.x + 10, y: info.work.y + 10 };
    renderElements(v.contentG, parsed.elements || [], origin);
  }
  drawGrid(v);
}

function fitDrawingToView() {
  const v = drawingViewer;
  zoomFit(v, v.contentW, v.contentH);
}

function renderDrawingFromCode() {
  const code = document.getElementById("d-code").value.trim();
  if (!code) { setMsg("d-msg", "Вставьте JSON и нажмите «Отрисовать».", "error"); return; }
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(code));
  } catch (e) {
    setMsg("d-msg", "Ошибка JSON: " + e.message, "error");
    return;
  }
  // Применяем поля верхнего уровня
  if (parsed.format) {
    drawingState.format = parsed.format;
    document.getElementById("d-format").value = parsed.format;
  }
  if (parsed.orientation) {
    drawingState.orientation = parsed.orientation;
    document.querySelector(`input[name="d-orient"][value="${parsed.orientation}"]`).checked = true;
  }
  if (parsed.title) {
    drawingState.title = Object.assign(drawingState.title, parsed.title);
    syncStampFields();
  }
  redrawDrawing(parsed);
  setMsg("d-msg", `Отрисовано элементов: ${(parsed.elements || []).length}.`, "ok");
}

function syncStampFields() {
  const t = drawingState.title;
  const map = {
    "t-name": "name", "t-designation": "designation",
    "t-scale": "scale", "t-mass": "mass",
    "t-material": "material", "t-author": "author",
    "t-checker": "checker", "t-school": "school"
  };
  Object.entries(map).forEach(([id, key]) => {
    if (t[key] != null) document.getElementById(id).value = t[key];
  });
}

/* ============ ВКЛАДКА: ГЕОМЕТРИЯ ============ */
let geometryViewer;
let geometryState = { w: 300, h: 200, axes: false };

function initGeometryTab() {
  geometryViewer = createViewer(document.getElementById("g-svg"), document.getElementById("g-status"));

  document.getElementById("g-w").addEventListener("input", e => { geometryState.w = +e.target.value || 100; redrawGeometry(); });
  document.getElementById("g-h").addEventListener("input", e => { geometryState.h = +e.target.value || 100; redrawGeometry(); });
  document.getElementById("g-axes").addEventListener("change", e => { geometryState.axes = e.target.checked; redrawGeometry(); });

  bindGridControls(geometryViewer, "g-");
  bindToolButtons(geometryViewer, "#panel-geometry");

  document.getElementById("g-zoomIn").addEventListener("click", () => zoomBy(geometryViewer, 1.2));
  document.getElementById("g-zoomOut").addEventListener("click", () => zoomBy(geometryViewer, 1 / 1.2));
  document.getElementById("g-zoomFit").addEventListener("click", () => fitGeometryToView());
  document.getElementById("g-exportSvg").addEventListener("click", () => exportSvg(geometryViewer, "geometry.svg"));
  document.getElementById("g-exportPng").addEventListener("click", () => exportPng(geometryViewer, "geometry.png"));

  document.getElementById("g-render").addEventListener("click", renderGeometryFromCode);
  document.getElementById("g-clear").addEventListener("click", () => {
    document.getElementById("g-code").value = "";
    redrawGeometry();
    setMsg("g-msg", "Очищено", "ok");
  });
  document.getElementById("g-example").addEventListener("click", () => {
    document.getElementById("g-code").value = EXAMPLE_GEOMETRY;
    renderGeometryFromCode();
  });
  document.getElementById("g-copyPrompt").addEventListener("click", () => {
    copyToClipboard(PROMPTS.geometry.universal);
    setMsg("g-msg", "Промт скопирован в буфер обмена.", "ok");
  });

  redrawGeometry();
  setTimeout(() => fitGeometryToView(), 50);
}

function redrawGeometry(parsed) {
  const v = geometryViewer;
  while (v.contentG.firstChild) v.contentG.removeChild(v.contentG.firstChild);
  while (v.defs.firstChild) v.defs.removeChild(v.defs.firstChild);
  v.contentW = geometryState.w; v.contentH = geometryState.h;

  // фон плоскости
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", 0); bg.setAttribute("y", 0);
  bg.setAttribute("width", geometryState.w); bg.setAttribute("height", geometryState.h);
  bg.setAttribute("class", "paper-bg");
  v.contentG.appendChild(bg);

  // Координатные оси (если включены)
  if (geometryState.axes) {
    const ax = document.createElementNS(SVG_NS, "g");
    const cx = geometryState.w / 2, cy = geometryState.h / 2;
    drawAxisLine(ax, 0, cy, geometryState.w, cy);
    drawAxisLine(ax, cx, 0, cx, geometryState.h);
    v.contentG.appendChild(ax);
  }

  if (parsed) {
    const origin = parsed.origin || { x: 10, y: 10 };
    renderElements(v.contentG, parsed.elements || [], origin);
  }
  drawGrid(v);
}

function drawAxisLine(g, x1, y1, x2, y2) {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", x1); l.setAttribute("y1", y1);
  l.setAttribute("x2", x2); l.setAttribute("y2", y2);
  l.setAttribute("stroke", "#999"); l.setAttribute("stroke-width", 0.2);
  g.appendChild(l);
}

function fitGeometryToView() {
  zoomFit(geometryViewer, geometryState.w, geometryState.h);
}

function renderGeometryFromCode() {
  const code = document.getElementById("g-code").value.trim();
  if (!code) { setMsg("g-msg", "Вставьте JSON и нажмите «Отрисовать».", "error"); return; }
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(code));
  } catch (e) {
    setMsg("g-msg", "Ошибка JSON: " + e.message, "error");
    return;
  }
  if (parsed.viewport) {
    geometryState.w = parsed.viewport.width || geometryState.w;
    geometryState.h = parsed.viewport.height || geometryState.h;
    document.getElementById("g-w").value = geometryState.w;
    document.getElementById("g-h").value = geometryState.h;
  }
  redrawGeometry(parsed);
  setMsg("g-msg", `Отрисовано элементов: ${(parsed.elements || []).length}.`, "ok");
}

/* ============ Общие хелперы ============ */
function bindGridControls(viewer, prefix) {
  const enabled = document.getElementById(prefix + "grid");
  const opacity = document.getElementById(prefix + "gridOpacity");
  const opacityVal = document.getElementById(prefix + "gridOpacityVal");
  const step = document.getElementById(prefix + "gridStep");
  const bold10 = document.getElementById(prefix + "grid10");

  enabled.addEventListener("change", e => { viewer.grid.enabled = e.target.checked; drawGrid(viewer); });
  opacity.addEventListener("input", e => {
    viewer.grid.opacity = (+e.target.value) / 100;
    opacityVal.textContent = e.target.value + "%";
    drawGrid(viewer);
  });
  step.addEventListener("input", e => {
    const v = +e.target.value;
    if (v > 0) { viewer.grid.step = v; drawGrid(viewer); }
  });
  bold10.addEventListener("change", e => { viewer.grid.bold10 = e.target.checked; drawGrid(viewer); });
}

function bindToolButtons(viewer, scopeSel) {
  const buttons = document.querySelectorAll(`${scopeSel} .tool`);
  buttons.forEach(b => {
    b.addEventListener("click", () => {
      const wasActive = b.classList.contains("active");
      buttons.forEach(x => x.classList.remove("active"));
      if (wasActive) { setTool(viewer, null); return; }
      b.classList.add("active");
      setTool(viewer, b.dataset.tool);
    });
  });
}

function setMsg(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "codepanel-foot " + (kind || "");
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand("copy"); ta.remove();
}

function stripCodeFences(s) {
  // На случай если нейросеть всё-таки обернула в ```json ... ```
  s = s.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "");
    s = s.replace(/\n?```$/, "");
  }
  return s.trim();
}

/* ============ ВКЛАДКА: ПРОМТЫ ============ */
let promptsState = { mode: "drawing", family: "universal" };

function initPromptsTab() {
  document.querySelectorAll("#p-mode .seg-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#p-mode .seg-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      promptsState.mode = b.dataset.mode;
      refreshPromptView();
    });
  });
  document.querySelectorAll("#p-family .seg-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#p-family .seg-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      promptsState.family = b.dataset.family;
      refreshPromptView();
    });
  });
  document.getElementById("p-copy").addEventListener("click", () => {
    copyToClipboard(document.getElementById("p-text").value);
    const el = document.getElementById("p-copied");
    el.textContent = "✓ Скопировано в буфер обмена";
    setTimeout(() => el.textContent = "", 2500);
  });
  refreshPromptView();
}

function refreshPromptView() {
  const text = (PROMPTS[promptsState.mode] || {})[promptsState.family] || "";
  document.getElementById("p-text").value = text;
  const titles = {
    drawing: "черчение", geometry: "геометрия"
  };
  const families = {
    universal: "универсальный", claude: "Claude", gpt: "GPT", gemini: "Gemini", local: "локальные модели"
  };
  document.getElementById("p-title").textContent =
    `Промт — ${families[promptsState.family]}, ${titles[promptsState.mode]}`;
}

/* ============ Примеры (для кнопки «Пример») ============ */
const EXAMPLE_DRAWING = `{
  "version": "1.0",
  "mode": "drawing",
  "format": "A3",
  "orientation": "landscape",
  "title": {
    "name": "Пластина опорная",
    "designation": "DEMO.001.001",
    "scale": "1:1",
    "material": "Сталь 45 ГОСТ 1050-2013",
    "author": "Иванов А.А.",
    "checker": "Петров Б.Б.",
    "school": "МГТУ, гр. ИУ7-12Б"
  },
  "origin": { "x": 80, "y": 60 },
  "elements": [
    { "type": "rect", "x": 0, "y": 0, "width": 180, "height": 100, "style": "solid", "width_": 0.7 },
    { "type": "circle", "cx": 30, "cy": 30, "r": 10, "style": "solid", "center": true },
    { "type": "circle", "cx": 150, "cy": 30, "r": 10, "style": "solid", "center": true },
    { "type": "circle", "cx": 30, "cy": 70, "r": 10, "style": "solid", "center": true },
    { "type": "circle", "cx": 150, "cy": 70, "r": 10, "style": "solid", "center": true },
    { "type": "circle", "cx": 90, "cy": 50, "r": 25, "style": "solid", "center": true },

    { "type": "line", "x1": -10, "y1": 50, "x2": 190, "y2": 50, "style": "axis" },
    { "type": "line", "x1": 90, "y1": -10, "x2": 90, "y2": 110, "style": "axis" },

    { "type": "dimension", "kind": "linear", "x1": 0, "y1": 100, "x2": 180, "y2": 100, "offset": 15, "value": "180" },
    { "type": "dimension", "kind": "linear", "x1": 180, "y1": 0, "x2": 180, "y2": 100, "offset": 15, "value": "100" },
    { "type": "dimension", "kind": "linear", "x1": 30, "y1": 30, "x2": 150, "y2": 30, "offset": -10, "value": "120" },
    { "type": "dimension", "kind": "diameter", "cx": 90, "cy": 50, "r": 25, "angle": 30 },
    { "type": "dimension", "kind": "diameter", "cx": 30, "cy": 30, "r": 10, "angle": 45 }
  ]
}`;

const EXAMPLE_GEOMETRY = `{
  "version": "1.0",
  "mode": "geometry",
  "viewport": { "width": 300, "height": 200 },
  "origin": { "x": 30, "y": 30 },
  "elements": [
    { "type": "polygon", "points": [[0,120],[200,120],[80,0]], "style": "solid" },

    { "type": "point", "x": 0, "y": 120, "label": "A", "labelDx": -6, "labelDy": 6 },
    { "type": "point", "x": 200, "y": 120, "label": "B", "labelDx": 4, "labelDy": 6 },
    { "type": "point", "x": 80, "y": 0, "label": "C", "labelDx": -2, "labelDy": -3 },

    { "type": "line", "x1": 80, "y1": 0, "x2": 100, "y2": 120, "style": "thin" },
    { "type": "point", "x": 100, "y": 120, "label": "M", "labelDx": 2, "labelDy": 10 },

    { "type": "circle", "cx": 80, "cy": 80, "r": 60, "style": "thin" },

    { "type": "angle", "vertex": [0,120], "p1": [200,120], "p2": [80,0], "label": "α", "radius": 18 },
    { "type": "angle", "vertex": [200,120], "p1": [80,0], "p2": [0,120], "label": "β", "radius": 18 },
    { "type": "angle", "vertex": [80,0], "p1": [0,120], "p2": [200,120], "label": "γ", "radius": 14 },

    { "type": "dimension", "kind": "aligned", "x1": 0, "y1": 120, "x2": 200, "y2": 120, "offset": 12, "value": "AB = 20" }
  ]
}`;
