/*
 * Инструменты: pan, zoom, линейка, транспортир, точка.
 *
 * Каждый viewer хранит состояние:
 *  { svg, contentG, gridG, overlayG, scale, tx, ty, contentW, contentH }
 *
 * Кнопки инструментов задают активный инструмент. Активный инструмент перехватывает события мыши.
 */

function createViewer(svgEl, statusEl) {
  // Структурируем SVG: <defs>, <g class="gridG">, <g class="contentG">, <g class="overlayG">
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  const defs = document.createElementNS(SVG_NS, "defs");
  const contentG = document.createElementNS(SVG_NS, "g");
  contentG.setAttribute("class", "contentG");
  const gridG = document.createElementNS(SVG_NS, "g");
  gridG.setAttribute("class", "gridG");
  // Чтобы сетка не "съедала" клики на инструментах — пропускаем pointer events.
  gridG.setAttribute("pointer-events", "none");
  const overlayG = document.createElementNS(SVG_NS, "g");
  overlayG.setAttribute("class", "overlayG");
  overlayG.setAttribute("pointer-events", "none");
  svgEl.appendChild(defs);
  // Порядок (z-order снизу-вверх):
  //  1) contentG — лист, штамп, чертёж пользователя
  //  2) gridG    — сетка поверх листа (полупрозрачная)
  //  3) overlayG — измерения линейкой/транспортиром
  svgEl.appendChild(contentG);
  svgEl.appendChild(gridG);
  svgEl.appendChild(overlayG);

  const v = {
    svg: svgEl,
    statusEl,
    defs, gridG, contentG, overlayG,
    scale: 2.5,   // px / mm (стартовый зум)
    tx: 40, ty: 40,
    contentW: 297, contentH: 210,
    grid: { enabled: true, step: 5, opacity: 0.35, bold10: true },
    tool: null,
    onContentChange: null
  };

  applyTransform(v);

  // Изменение размеров — пересчитываем viewport
  const ro = new ResizeObserver(() => { applyTransform(v); drawGrid(v); });
  ro.observe(svgEl);

  // Pan / Zoom
  attachPanZoom(v);
  // Слежение за курсором (статус)
  attachCursorTracker(v);
  // Инструменты
  attachToolHandlers(v);

  return v;
}

function applyTransform(v) {
  const t = `translate(${v.tx} ${v.ty}) scale(${v.scale})`;
  v.gridG.setAttribute("transform", t);
  v.contentG.setAttribute("transform", t);
  v.overlayG.setAttribute("transform", t);
}

function screenToWorld(v, sx, sy) {
  const rect = v.svg.getBoundingClientRect();
  const x = (sx - rect.left - v.tx) / v.scale;
  const y = (sy - rect.top - v.ty) / v.scale;
  return { x, y };
}

/* ============ pan / zoom ============ */
function attachPanZoom(v) {
  let panning = false, lastX = 0, lastY = 0, spaceDown = false, midButton = false;
  v.svg.addEventListener("wheel", ev => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const before = screenToWorld(v, ev.clientX, ev.clientY);
    v.scale *= factor;
    v.scale = Math.max(0.2, Math.min(50, v.scale));
    const after = screenToWorld(v, ev.clientX, ev.clientY);
    v.tx += (after.x - before.x) * v.scale;
    v.ty += (after.y - before.y) * v.scale;
    applyTransform(v);
    drawGrid(v);
  }, { passive: false });

  v.svg.addEventListener("mousedown", ev => {
    midButton = ev.button === 1;
    const isPan = (v.tool === "pan" && ev.button === 0) || midButton || ev.button === 2;
    if (isPan) {
      panning = true; lastX = ev.clientX; lastY = ev.clientY;
      v.svg.style.cursor = "grabbing";
      ev.preventDefault();
    }
  });
  window.addEventListener("mousemove", ev => {
    if (!panning) return;
    v.tx += ev.clientX - lastX;
    v.ty += ev.clientY - lastY;
    lastX = ev.clientX; lastY = ev.clientY;
    applyTransform(v);
    drawGrid(v);
  });
  window.addEventListener("mouseup", () => {
    panning = false; midButton = false;
    if (v.tool !== "pan") v.svg.style.cursor = "";
    else v.svg.style.cursor = "grab";
  });
  v.svg.addEventListener("contextmenu", ev => ev.preventDefault());
}

function attachCursorTracker(v) {
  v.svg.addEventListener("mousemove", ev => {
    const p = screenToWorld(v, ev.clientX, ev.clientY);
    if (v.statusEl) v.statusEl.textContent = `X: ${p.x.toFixed(1)}  Y: ${p.y.toFixed(1)}  мм  ·  ×${v.scale.toFixed(2)}`;
  });
}

/* ============ зум-в-точку, fit ============ */
function zoomBy(v, factor, cx, cy) {
  const rect = v.svg.getBoundingClientRect();
  cx = cx != null ? cx : rect.width / 2;
  cy = cy != null ? cy : rect.height / 2;
  const before = screenToWorld(v, rect.left + cx, rect.top + cy);
  v.scale *= factor;
  v.scale = Math.max(0.2, Math.min(50, v.scale));
  const after = screenToWorld(v, rect.left + cx, rect.top + cy);
  v.tx += (after.x - before.x) * v.scale;
  v.ty += (after.y - before.y) * v.scale;
  applyTransform(v); drawGrid(v);
}

function zoomFit(v, w, h) {
  const rect = v.svg.getBoundingClientRect();
  const margin = 24;
  const sx = (rect.width - 2 * margin) / w;
  const sy = (rect.height - 2 * margin) / h;
  v.scale = Math.min(sx, sy);
  v.scale = Math.max(0.2, Math.min(50, v.scale));
  v.tx = (rect.width - w * v.scale) / 2;
  v.ty = (rect.height - h * v.scale) / 2;
  applyTransform(v); drawGrid(v);
}

/* ============ сетка ============ */
function drawGrid(v) {
  // Очищаем
  while (v.gridG.firstChild) v.gridG.removeChild(v.gridG.firstChild);
  if (!v.grid.enabled) return;

  const rect = v.svg.getBoundingClientRect();
  // Определяем "видимый прямоугольник в мм"
  const x0 = -v.tx / v.scale;
  const y0 = -v.ty / v.scale;
  const x1 = (rect.width - v.tx) / v.scale;
  const y1 = (rect.height - v.ty) / v.scale;

  const step = v.grid.step;
  const startX = Math.floor(x0 / step) * step;
  const startY = Math.floor(y0 / step) * step;

  // Прячем сетку при сильном уменьшении (чтобы не было каши)
  const pxStep = step * v.scale;
  if (pxStep < 3) return;

  const color = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || "#4c8eff";
  const op = v.grid.opacity;

  // тонкая сетка
  const path = [];
  for (let x = startX; x <= x1; x += step) {
    path.push(`M ${x} ${y0} L ${x} ${y1}`);
  }
  for (let y = startY; y <= y1; y += step) {
    path.push(`M ${x0} ${y} L ${x1} ${y}`);
  }
  const thin = document.createElementNS(SVG_NS, "path");
  thin.setAttribute("d", path.join(" "));
  thin.setAttribute("stroke", color);
  thin.setAttribute("stroke-width", 0.5 / v.scale);
  thin.setAttribute("opacity", op);
  thin.setAttribute("fill", "none");
  v.gridG.appendChild(thin);

  // жирная каждые 10 шагов
  if (v.grid.bold10) {
    const bigStep = step * 10;
    const bx0 = Math.floor(x0 / bigStep) * bigStep;
    const by0 = Math.floor(y0 / bigStep) * bigStep;
    const bp = [];
    for (let x = bx0; x <= x1; x += bigStep) bp.push(`M ${x} ${y0} L ${x} ${y1}`);
    for (let y = by0; y <= y1; y += bigStep) bp.push(`M ${x0} ${y} L ${x1} ${y}`);
    const bold = document.createElementNS(SVG_NS, "path");
    bold.setAttribute("d", bp.join(" "));
    bold.setAttribute("stroke", color);
    bold.setAttribute("stroke-width", 1.1 / v.scale);
    bold.setAttribute("opacity", Math.min(1, op * 1.6));
    bold.setAttribute("fill", "none");
    v.gridG.appendChild(bold);
  }
}

/* ============ инструменты: линейка / транспортир / точка ============ */
function setTool(v, tool) {
  v.tool = tool;
  v.svg.style.cursor =
    tool === "pan" ? "grab" :
    tool === "ruler" ? "crosshair" :
    tool === "protractor" ? "crosshair" :
    tool === "point" ? "crosshair" : "default";
  clearMeasurements(v);
}

function clearMeasurements(v) {
  while (v.overlayG.firstChild) v.overlayG.removeChild(v.overlayG.firstChild);
}

function attachToolHandlers(v) {
  let stage = 0;
  let p1 = null, p2 = null, p3 = null;
  v.svg.addEventListener("mousedown", ev => {
    if (ev.button !== 0) return;
    if (!v.tool || v.tool === "pan") return;
    const p = screenToWorld(v, ev.clientX, ev.clientY);
    // Привязка к сетке (Shift отключает)
    const snap = !ev.shiftKey ? v.grid.step / 2 : 0;
    if (snap) { p.x = Math.round(p.x / snap) * snap; p.y = Math.round(p.y / snap) * snap; }

    if (v.tool === "ruler") {
      if (stage === 0) { p1 = p; stage = 1; clearMeasurements(v); drawMarker(v.overlayG, p1); }
      else {
        p2 = p; stage = 0;
        drawMeasurement(v.overlayG, p1, p2);
        p1 = p2 = null;
      }
    } else if (v.tool === "protractor") {
      if (stage === 0) { p1 = p; stage = 1; clearMeasurements(v); drawMarker(v.overlayG, p1); }
      else if (stage === 1) { p2 = p; stage = 2; drawMarker(v.overlayG, p2); drawLineOverlay(v.overlayG, p1, p2); }
      else { p3 = p; stage = 0; drawAngleOverlay(v.overlayG, p1, p2, p3); p1 = p2 = p3 = null; }
    } else if (v.tool === "point") {
      drawMarker(v.overlayG, p);
    }
  });

  v.svg.addEventListener("mousemove", ev => {
    if (!v.tool || v.tool === "pan") return;
    if (stage === 0) return;
    const p = screenToWorld(v, ev.clientX, ev.clientY);
    const snap = !ev.shiftKey ? v.grid.step / 2 : 0;
    if (snap) { p.x = Math.round(p.x / snap) * snap; p.y = Math.round(p.y / snap) * snap; }
    // удаляем предпросмотр
    const preview = v.overlayG.querySelector("[data-preview]");
    if (preview) preview.remove();

    if (v.tool === "ruler" && stage === 1) {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("data-preview", "1");
      v.overlayG.appendChild(g);
      drawMeasurement(g, p1, p);
    } else if (v.tool === "protractor") {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("data-preview", "1");
      v.overlayG.appendChild(g);
      if (stage === 1) drawLineOverlay(g, p1, p);
      if (stage === 2) drawAngleOverlay(g, p1, p2, p);
    }
  });

  // Esc — отменить
  window.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      stage = 0; p1 = p2 = p3 = null; clearMeasurements(v);
    }
  });
}

function drawMarker(g, p) {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", p.x); c.setAttribute("cy", p.y);
  c.setAttribute("r", 0.8); c.setAttribute("fill", "#e25c5c");
  g.appendChild(c);
}

function drawLineOverlay(g, a, b) {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", a.x); l.setAttribute("y1", a.y);
  l.setAttribute("x2", b.x); l.setAttribute("y2", b.y);
  l.setAttribute("stroke", "#e25c5c"); l.setAttribute("stroke-width", 0.4);
  l.setAttribute("stroke-dasharray", "2 1");
  g.appendChild(l);
}

function drawMeasurement(g, a, b) {
  drawLineOverlay(g, a, b);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angDeg = Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  // фон под текст
  const text = `${len.toFixed(2)} мм / ${angDeg.toFixed(1)}°`;
  drawLabel(g, mx, my - 2, text, "#e25c5c");
}

function drawAngleOverlay(g, vtx, p1, p2) {
  drawLineOverlay(g, vtx, p1);
  drawLineOverlay(g, vtx, p2);
  const a1 = Math.atan2(-(p1.y - vtx.y), p1.x - vtx.x);
  const a2 = Math.atan2(-(p2.y - vtx.y), p2.x - vtx.x);
  let diff = (a2 - a1) * 180 / Math.PI;
  while (diff < -180) diff += 360; while (diff > 180) diff -= 360;
  const r = 8;
  const start = [vtx.x + r * Math.cos(a1), vtx.y - r * Math.sin(a1)];
  const end = [vtx.x + r * Math.cos(a2), vtx.y - r * Math.sin(a2)];
  const sweepFlag = diff > 0 ? 0 : 1;
  const largeArc = Math.abs(diff) > 180 ? 1 : 0;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${start[0]} ${start[1]} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end[0]} ${end[1]}`);
  path.setAttribute("stroke", "#e25c5c"); path.setAttribute("fill", "none"); path.setAttribute("stroke-width", 0.35);
  g.appendChild(path);
  const midA = (a1 + a2) / 2;
  drawLabel(g, vtx.x + (r + 4) * Math.cos(midA), vtx.y - (r + 4) * Math.sin(midA), Math.abs(diff).toFixed(1) + "°", "#e25c5c");
}

function drawLabel(g, x, y, text, color) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("fill", color || "#e25c5c");
  t.setAttribute("font-size", 3);
  t.setAttribute("font-family", "ui-monospace, Menlo, monospace");
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("paint-order", "stroke");
  t.setAttribute("stroke", "#fff");
  t.setAttribute("stroke-width", 0.8);
  t.setAttribute("stroke-linejoin", "round");
  t.textContent = text;
  g.appendChild(t);
}

/* ============ экспорт ============ */
function exportSvg(v, filename) {
  // Клонируем SVG, фиксируем размеры в мм для печати
  const clone = v.svg.cloneNode(true);
  // Применим viewBox по контентному прямоугольнику, если он известен
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", v.contentW + "mm");
  clone.setAttribute("height", v.contentH + "mm");
  clone.setAttribute("viewBox", `0 0 ${v.contentW} ${v.contentH}`);
  // Сбрасываем transform контентного слоя — экспортируем содержимое в "натуральных" координатах
  const transforms = clone.querySelectorAll("[transform]");
  transforms.forEach(t => {
    if (t.classList.contains("contentG") || t.classList.contains("gridG") || t.classList.contains("overlayG")) {
      t.removeAttribute("transform");
    }
  });
  // overlay и сетку при экспорте убираем — это вспомогательные слои
  const overlay = clone.querySelector(".overlayG");
  if (overlay) overlay.remove();
  const grid = clone.querySelector(".gridG");
  if (grid) grid.remove();

  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename || "drawing.svg";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportPng(v, filename) {
  const clone = v.svg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", v.contentW * 4);
  clone.setAttribute("height", v.contentH * 4);
  clone.setAttribute("viewBox", `0 0 ${v.contentW} ${v.contentH}`);
  const transforms = clone.querySelectorAll("[transform]");
  transforms.forEach(t => {
    if (t.classList.contains("contentG") || t.classList.contains("gridG") || t.classList.contains("overlayG")) {
      t.removeAttribute("transform");
    }
  });
  const overlay = clone.querySelector(".overlayG");
  if (overlay) overlay.remove();
  const grid = clone.querySelector(".gridG");
  if (grid) grid.remove();

  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = v.contentW * 4; c.height = v.contentH * 4;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => {
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u; a.download = filename || "drawing.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 500);
    }, "image/png");
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
