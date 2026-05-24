/*
 * DrawAI Renderer
 *  Парсит JSON-DSL и рисует на SVG.
 *  Координаты в миллиметрах. Ось Y направлена ВНИЗ (как у SVG).
 *
 *  Поддерживаемые элементы:
 *   line, polyline, polygon, rect, circle, ellipse, arc, path,
 *   text, point, dimension (linear|aligned|diameter|radius|angular),
 *   angle, hatch, label.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

const LINE_STYLES = {
  solid:    { dasharray: null,         weight: 0.7 },   // основная сплошная толстая
  thin:     { dasharray: null,         weight: 0.35 },  // вспомогательная тонкая
  dashed:   { dasharray: "4 2",        weight: 0.5 },   // штриховая (невидимый контур)
  dashdot:  { dasharray: "8 1.5 1 1.5", weight: 0.5 },  // штрихпунктирная (оси)
  axis:     { dasharray: "8 1.5 1 1.5", weight: 0.35 }, // тонкая штрихпунктирная (оси)
  phantom:  { dasharray: "12 2 2 2 2 2", weight: 0.5 }  // двух-штрих-пунктирная
};

function stylize(el, opts) {
  const s = LINE_STYLES[opts.style || "solid"] || LINE_STYLES.solid;
  // ВНИМАНИЕ: для толщины линии используется поле "weight" (или legacy "lineWidth"/"strokeWidth").
  // Поле "width" зарезервировано под ширину прямоугольника и не используется здесь.
  const w = opts.weight != null ? opts.weight
          : opts.lineWidth != null ? opts.lineWidth
          : opts.strokeWidth != null ? opts.strokeWidth
          : s.weight;
  el.setAttribute("stroke", opts.color || "#111");
  el.setAttribute("stroke-width", w);
  if (s.dasharray) el.setAttribute("stroke-dasharray", s.dasharray);
  el.setAttribute("fill", opts.fill || "none");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  if (opts.opacity != null) el.setAttribute("opacity", opts.opacity);
}

/**
 * Главная точка входа. parent — SVG <g>, в который встраиваем элементы.
 * elements — массив объектов DSL.
 * origin — {x,y} в мм: смещение, чтобы перенести 0,0 пользователя в нужную точку листа.
 */
function renderElements(parent, elements, origin) {
  if (!Array.isArray(elements)) throw new Error("Поле 'elements' должно быть массивом.");
  const ox = (origin && origin.x) || 0;
  const oy = (origin && origin.y) || 0;
  for (const e of elements) {
    try {
      renderOne(parent, e, ox, oy);
    } catch (err) {
      console.warn("Ошибка при рендеринге элемента", e, err);
    }
  }
}

function renderOne(parent, e, ox, oy) {
  switch (e.type) {
    case "line":      return drawLine(parent, e, ox, oy);
    case "polyline":  return drawPoly(parent, e, ox, oy, false);
    case "polygon":   return drawPoly(parent, e, ox, oy, true);
    case "rect":
    case "rectangle": return drawRect(parent, e, ox, oy);
    case "circle":    return drawCircle(parent, e, ox, oy);
    case "ellipse":   return drawEllipse(parent, e, ox, oy);
    case "arc":       return drawArc(parent, e, ox, oy);
    case "path":      return drawPath(parent, e, ox, oy);
    case "text":      return drawText(parent, e, ox, oy);
    case "point":     return drawPoint(parent, e, ox, oy);
    case "label":     return drawText(parent, e, ox, oy);
    case "dimension": return drawDimension(parent, e, ox, oy);
    case "angle":     return drawAngle(parent, e, ox, oy);
    case "hatch":     return drawHatch(parent, e, ox, oy);
    case "group":     return drawGroup(parent, e, ox, oy);
    default:
      console.warn("Неизвестный тип элемента:", e.type);
  }
}

/* ============ простые фигуры ============ */
function drawLine(p, e, ox, oy) {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", e.x1 + ox); l.setAttribute("y1", e.y1 + oy);
  l.setAttribute("x2", e.x2 + ox); l.setAttribute("y2", e.y2 + oy);
  stylize(l, e); p.appendChild(l);
}

function drawPoly(p, e, ox, oy, closed) {
  const tag = closed ? "polygon" : "polyline";
  const el = document.createElementNS(SVG_NS, tag);
  const pts = (e.points || []).map(pt => `${pt[0] + ox},${pt[1] + oy}`).join(" ");
  el.setAttribute("points", pts);
  stylize(el, e);
  p.appendChild(el);
}

function drawRect(p, e, ox, oy) {
  const r = document.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", e.x + ox); r.setAttribute("y", e.y + oy);
  r.setAttribute("width", e.width); r.setAttribute("height", e.height);
  if (e.rx) r.setAttribute("rx", e.rx);
  if (e.ry) r.setAttribute("ry", e.ry);
  stylize(r, e); p.appendChild(r);
}

function drawCircle(p, e, ox, oy) {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", e.cx + ox); c.setAttribute("cy", e.cy + oy);
  c.setAttribute("r", e.r);
  stylize(c, e); p.appendChild(c);
  if (e.center) drawCenterCross(p, e.cx + ox, e.cy + oy, Math.min(e.r * 1.2, e.r + 5));
}

function drawEllipse(p, e, ox, oy) {
  const el = document.createElementNS(SVG_NS, "ellipse");
  el.setAttribute("cx", e.cx + ox); el.setAttribute("cy", e.cy + oy);
  el.setAttribute("rx", e.rx); el.setAttribute("ry", e.ry);
  stylize(el, e); p.appendChild(el);
}

function drawArc(p, e, ox, oy) {
  // углы в градусах, против ч.с. как в математике (Y вверх). В SVG Y вниз — инвертируем.
  const cx = e.cx + ox, cy = e.cy + oy, r = e.r;
  let a1 = (e.startAngle || 0) * Math.PI / 180;
  let a2 = (e.endAngle || 0) * Math.PI / 180;
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy - r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy - r * Math.sin(a2);
  let sweep = e.endAngle - e.startAngle;
  if (sweep < 0) sweep += 360;
  const largeArc = sweep > 180 ? 1 : 0;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2}`);
  stylize(path, e); p.appendChild(path);
}

function drawPath(p, e, ox, oy) {
  const path = document.createElementNS(SVG_NS, "path");
  // Если d-строка содержит координаты — пользователь сам отвечает за смещение; добавим transform.
  path.setAttribute("d", e.d);
  path.setAttribute("transform", `translate(${ox} ${oy})`);
  stylize(path, e); p.appendChild(path);
}

/* ============ текст и точки ============ */
function drawText(p, e, ox, oy) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", e.x + ox); t.setAttribute("y", e.y + oy);
  t.setAttribute("font-size", e.size || 3.5);
  t.setAttribute("font-family", e.font || "GOST type A, Times New Roman, serif");
  t.setAttribute("text-anchor", e.anchor || "start");
  t.setAttribute("fill", e.color || "#111");
  if (e.rotation) {
    t.setAttribute("transform", `rotate(${-e.rotation} ${e.x + ox} ${e.y + oy})`);
  }
  t.textContent = e.text || "";
  p.appendChild(t);
}

function drawPoint(p, e, ox, oy) {
  const cx = e.x + ox, cy = e.y + oy;
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", cx); c.setAttribute("cy", cy);
  c.setAttribute("r", e.size || 0.8);
  c.setAttribute("fill", e.color || "#111");
  p.appendChild(c);
  if (e.label) {
    const t = document.createElementNS(SVG_NS, "text");
    const dx = e.labelDx != null ? e.labelDx : 2;
    const dy = e.labelDy != null ? e.labelDy : -2;
    t.setAttribute("x", cx + dx); t.setAttribute("y", cy + dy);
    t.setAttribute("font-size", e.labelSize || 3.5);
    t.setAttribute("font-family", "GOST type A, Times New Roman, serif");
    t.setAttribute("fill", e.color || "#111");
    t.textContent = e.label;
    p.appendChild(t);
  }
}

function drawCenterCross(p, cx, cy, r) {
  const len = r * 0.15 + 2;
  const opts = { style: "axis" };
  drawLine(p, { x1: cx - r - 1, y1: cy, x2: cx + r + 1, y2: cy, ...opts }, 0, 0);
  drawLine(p, { x1: cx, y1: cy - r - 1, x2: cx, y2: cy + r + 1, ...opts }, 0, 0);
}

/* ============ размеры ============ */
function drawDimension(parent, e, ox, oy) {
  const kind = e.kind || "linear";
  if (kind === "linear" || kind === "aligned") return drawLinearDim(parent, e, ox, oy, kind === "aligned");
  if (kind === "diameter")                     return drawDiameterDim(parent, e, ox, oy);
  if (kind === "radius")                       return drawRadiusDim(parent, e, ox, oy);
  if (kind === "angular")                      return drawAngularDim(parent, e, ox, oy);
}

function drawLinearDim(parent, e, ox, oy, aligned) {
  // e.x1,y1 и e.x2,y2 — измеряемая база. offset — отступ размерной линии перпендикулярно.
  const p1 = [e.x1 + ox, e.y1 + oy];
  const p2 = [e.x2 + ox, e.y2 + oy];
  const off = e.offset != null ? e.offset : 10;
  let nx, ny;
  if (aligned) {
    // перпендикуляр к базе
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy) || 1;
    nx = -dy / len; ny = dx / len;
  } else {
    // горизонтальное или вертикальное измерение
    const horiz = e.axis ? e.axis === "x" : Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]);
    nx = horiz ? 0 : 1;
    ny = horiz ? 1 : 0;
  }

  // Концы размерной линии: проекции p1 и p2 на линию, отстоящую на off.
  const a = [p1[0] + nx * off, p1[1] + ny * off];
  const b = [p2[0] + nx * off, p2[1] + ny * off];

  // Если не aligned, b ограничивается осью: проецируем p2 на ось a-перпендикуляр.
  // Уже выше учли через nx,ny.

  // Выносные линии (extension lines) — небольшие
  const ext = 1.5;
  drawLineRaw(parent, p1, [a[0] + nx * ext, a[1] + ny * ext], "thin");
  drawLineRaw(parent, p2, [b[0] + nx * ext, b[1] + ny * ext], "thin");

  // Размерная линия
  drawLineRaw(parent, a, b, "thin");

  // Стрелки
  drawArrow(parent, a, b, e.arrow || 2.5);
  drawArrow(parent, b, a, e.arrow || 2.5);

  // Подпись
  const value = e.value != null ? String(e.value) : autoLen(p1, p2).toFixed(1);
  const midx = (a[0] + b[0]) / 2;
  const midy = (a[1] + b[1]) / 2;
  // повернуть текст вдоль размерной линии
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", midx); t.setAttribute("y", midy - 0.8);
  t.setAttribute("font-size", e.textSize || 3.5);
  t.setAttribute("font-family", "GOST type A, Times New Roman, serif");
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("fill", "#111");
  t.setAttribute("transform", `rotate(${Math.abs(ang) > 90 ? ang + 180 : ang} ${midx} ${midy})`);
  t.textContent = value;
  parent.appendChild(t);
}

function drawDiameterDim(parent, e, ox, oy) {
  const cx = e.cx + ox, cy = e.cy + oy, r = e.r;
  const ang = ((e.angle != null ? e.angle : 45) * Math.PI) / 180;
  const a = [cx - r * Math.cos(ang), cy + r * Math.sin(ang)];
  const b = [cx + r * Math.cos(ang), cy - r * Math.sin(ang)];
  drawLineRaw(parent, a, b, "thin");
  drawArrow(parent, a, b, 2.5);
  drawArrow(parent, b, a, 2.5);
  const value = "⌀" + (e.value != null ? e.value : (r * 2).toFixed(1));
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", b[0] + 2); t.setAttribute("y", b[1] - 1);
  t.setAttribute("font-size", e.textSize || 3.5);
  t.setAttribute("font-family", "GOST type A, Times New Roman, serif");
  t.setAttribute("fill", "#111");
  t.textContent = value;
  parent.appendChild(t);
}

function drawRadiusDim(parent, e, ox, oy) {
  const cx = e.cx + ox, cy = e.cy + oy, r = e.r;
  const ang = ((e.angle != null ? e.angle : 45) * Math.PI) / 180;
  const b = [cx + r * Math.cos(ang), cy - r * Math.sin(ang)];
  drawLineRaw(parent, [cx, cy], b, "thin");
  drawArrow(parent, [cx, cy], b, 2.5);
  const value = "R" + (e.value != null ? e.value : r.toFixed(1));
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", b[0] + 2); t.setAttribute("y", b[1] - 1);
  t.setAttribute("font-size", e.textSize || 3.5);
  t.setAttribute("font-family", "GOST type A, Times New Roman, serif");
  t.setAttribute("fill", "#111");
  t.textContent = value;
  parent.appendChild(t);
}

function drawAngularDim(parent, e, ox, oy) {
  // вершина и две точки, задающие лучи. Радиус дуги размерной линии — radius.
  const v = [e.vertex[0] + ox, e.vertex[1] + oy];
  const p1 = [e.p1[0] + ox, e.p1[1] + oy];
  const p2 = [e.p2[0] + ox, e.p2[1] + oy];
  const r = e.radius || 15;
  const a1 = Math.atan2(-(p1[1] - v[1]), p1[0] - v[0]); // в math-координатах
  const a2 = Math.atan2(-(p2[1] - v[1]), p2[0] - v[0]);
  const start = [v[0] + r * Math.cos(a1), v[1] - r * Math.sin(a1)];
  const end = [v[0] + r * Math.cos(a2), v[1] - r * Math.sin(a2)];
  let diff = (a2 - a1) * 180 / Math.PI; while (diff < -180) diff += 360; while (diff > 180) diff -= 360;
  const sweepFlag = diff > 0 ? 0 : 1;        // SVG: y вниз, поэтому инверсия
  const largeArc = Math.abs(diff) > 180 ? 1 : 0;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${start[0]} ${start[1]} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end[0]} ${end[1]}`);
  path.setAttribute("fill", "none"); path.setAttribute("stroke", "#111"); path.setAttribute("stroke-width", 0.35);
  parent.appendChild(path);
  drawArrow(parent, [v[0] + (r + 0.5) * Math.cos(a1), v[1] - (r + 0.5) * Math.sin(a1)], start, 2);
  drawArrow(parent, [v[0] + (r + 0.5) * Math.cos(a2), v[1] - (r + 0.5) * Math.sin(a2)], end, 2);

  const midA = (a1 + a2) / 2;
  const tx = v[0] + (r + 4) * Math.cos(midA);
  const ty = v[1] - (r + 4) * Math.sin(midA);
  const deg = Math.abs(diff).toFixed(1).replace(/\.0$/, "");
  const value = e.value != null ? e.value : deg + "°";
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", tx); t.setAttribute("y", ty);
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("font-size", e.textSize || 3.5);
  t.setAttribute("font-family", "GOST type A, Times New Roman, serif");
  t.setAttribute("fill", "#111");
  t.textContent = value;
  parent.appendChild(t);
}

function drawAngle(parent, e, ox, oy) {
  // Простая маркировка угла без выноса значения: дуга от p1 до p2 с центром в vertex.
  const v = [e.vertex[0] + ox, e.vertex[1] + oy];
  const p1 = [e.p1[0] + ox, e.p1[1] + oy];
  const p2 = [e.p2[0] + ox, e.p2[1] + oy];
  const r = e.radius || 6;
  const a1 = Math.atan2(-(p1[1] - v[1]), p1[0] - v[0]);
  const a2 = Math.atan2(-(p2[1] - v[1]), p2[0] - v[0]);
  const start = [v[0] + r * Math.cos(a1), v[1] - r * Math.sin(a1)];
  const end = [v[0] + r * Math.cos(a2), v[1] - r * Math.sin(a2)];
  let diff = (a2 - a1) * 180 / Math.PI; while (diff < -180) diff += 360; while (diff > 180) diff -= 360;
  const sweepFlag = diff > 0 ? 0 : 1;
  const largeArc = Math.abs(diff) > 180 ? 1 : 0;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${start[0]} ${start[1]} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end[0]} ${end[1]}`);
  path.setAttribute("fill", "none"); path.setAttribute("stroke", e.color || "#111"); path.setAttribute("stroke-width", e.width || 0.3);
  if (e.style === "dashed") path.setAttribute("stroke-dasharray", "2 1");
  parent.appendChild(path);
  if (e.label) {
    const midA = (a1 + a2) / 2;
    const tx = v[0] + (r + 3) * Math.cos(midA);
    const ty = v[1] - (r + 3) * Math.sin(midA);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", tx); t.setAttribute("y", ty);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", e.labelSize || 3.5);
    t.setAttribute("font-family", "GOST type A, Times New Roman, serif");
    t.setAttribute("fill", e.color || "#111");
    t.textContent = e.label;
    parent.appendChild(t);
  }
}

/* ============ штриховка ============ */
function drawHatch(parent, e, ox, oy) {
  // e.region: список точек замкнутого контура; е.angle (deg); e.spacing (мм)
  if (!e.region || e.region.length < 3) return;
  const pts = e.region.map(p => [p[0] + ox, p[1] + oy]);
  // Сначала рисуем контур (тонко)
  const poly = document.createElementNS(SVG_NS, "polygon");
  poly.setAttribute("points", pts.map(p => p.join(",")).join(" "));
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", "transparent");
  parent.appendChild(poly);

  // Создаём clipPath
  const clipId = "clip_" + Math.random().toString(36).slice(2, 9);
  const defs = ensureDefs(parent);
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", clipId);
  const cpoly = document.createElementNS(SVG_NS, "polygon");
  cpoly.setAttribute("points", pts.map(p => p.join(",")).join(" "));
  clipPath.appendChild(cpoly);
  defs.appendChild(clipPath);

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(p => {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  });
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const ang = ((e.angle != null ? e.angle : 45) * Math.PI) / 180;
  const dx = Math.cos(ang), dy = -Math.sin(ang); // направление штриховки
  const px = -dy, py = dx;                        // перпендикуляр
  const spacing = e.spacing || 2;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("clip-path", `url(#${clipId})`);
  const steps = Math.ceil(diag / spacing) + 2;
  for (let i = -steps; i <= steps; i++) {
    const sx = cx + px * i * spacing - dx * diag;
    const sy = cy + py * i * spacing - dy * diag;
    const ex = cx + px * i * spacing + dx * diag;
    const ey = cy + py * i * spacing + dy * diag;
    const ln = document.createElementNS(SVG_NS, "line");
    ln.setAttribute("x1", sx); ln.setAttribute("y1", sy);
    ln.setAttribute("x2", ex); ln.setAttribute("y2", ey);
    ln.setAttribute("stroke", e.color || "#111");
    ln.setAttribute("stroke-width", e.width || 0.25);
    g.appendChild(ln);
  }
  parent.appendChild(g);
}

function ensureDefs(parent) {
  // ищем defs в корне svg
  let root = parent;
  while (root.parentNode && root.tagName !== "svg") root = root.parentNode;
  let defs = root.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(SVG_NS, "defs");
    root.insertBefore(defs, root.firstChild);
  }
  return defs;
}

/* ============ группы ============ */
function drawGroup(parent, e, ox, oy) {
  const g = document.createElementNS(SVG_NS, "g");
  if (e.transform) g.setAttribute("transform", e.transform);
  parent.appendChild(g);
  renderElements(g, e.elements || [], { x: ox + (e.x || 0), y: oy + (e.y || 0) });
}

/* ============ вспомогательные ============ */
function drawLineRaw(parent, a, b, style) {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", a[0]); l.setAttribute("y1", a[1]);
  l.setAttribute("x2", b[0]); l.setAttribute("y2", b[1]);
  stylize(l, { style: style || "thin" });
  parent.appendChild(l);
}

function drawArrow(parent, from, to, size) {
  // стрелочка-наконечник в точке `to`, направленная от `from` к `to`.
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const half = (size || 2.5) * 0.35;
  const tip = to;
  const base = [to[0] - ux * size, to[1] - uy * size];
  const left = [base[0] - uy * half, base[1] + ux * half];
  const right = [base[0] + uy * half, base[1] - ux * half];
  const p = document.createElementNS(SVG_NS, "polygon");
  p.setAttribute("points", `${tip[0]},${tip[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}`);
  p.setAttribute("fill", "#111");
  parent.appendChild(p);
}

function autoLen(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
