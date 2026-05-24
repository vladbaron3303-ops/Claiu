// app.js — UI, вкладки, инструменты, рендер.

(function () {
  "use strict";

  // ----- tabs ------------------------------------------------------------
  const tabs = document.getElementById("tabs");
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab"); if (!btn) return;
    for (const b of tabs.querySelectorAll(".tab")) b.classList.toggle("active", b === btn);
    const id = btn.dataset.tab;
    for (const p of document.querySelectorAll(".page")) p.classList.add("hidden");
    document.getElementById("page-" + id).classList.remove("hidden");
    if (id === "drafting") schedule("d");
    if (id === "geometry") schedule("g");
  });

  // ----- per-tab state ---------------------------------------------------
  const state = {
    d: { tab: "d", code: "", view: { zoom: 1, panX: 0, panY: 0 }, tool: "select",
         ruler: null, lastRender: 0 },
    g: { tab: "g", code: "", view: { zoom: 1, panX: 0, panY: 0 }, tool: "select",
         ruler: null, autofitBounds: null, lastRender: 0 },
  };

  // ----- canvas setup ----------------------------------------------------
  function setupCanvas(canvasId, wrapId, side) {
    const canvas = document.getElementById(canvasId);
    const wrap = document.getElementById(wrapId);
    const ctx = canvas.getContext("2d");
    const ro = new ResizeObserver(() => { fit(); schedule(side); });
    ro.observe(wrap);
    fit();

    function fit() {
      const dpr = window.devicePixelRatio || 1;
      const r = wrap.getBoundingClientRect();
      canvas.width = Math.max(10, Math.round(r.width * dpr));
      canvas.height = Math.max(10, Math.round(r.height * dpr));
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ----- mouse interactions ----
    let panning = false, lastX = 0, lastY = 0;
    let rulerStart = null;

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", (e) => {
      const tool = state[side].tool;
      if (e.button === 1 || e.button === 2 || tool === "pan" || e.shiftKey) {
        panning = true; lastX = e.clientX; lastY = e.clientY; return;
      }
      if (tool === "ruler") {
        const p = canvasToWorld(e, side);
        if (!rulerStart) { rulerStart = p; }
        else { rulerStart = null; state[side].ruler = null; schedule(side); }
      }
    });
    canvas.addEventListener("mousemove", (e) => {
      if (panning) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        state[side].view.panX += dx;
        state[side].view.panY += dy;
        schedule(side);
        return;
      }
      if (state[side].tool === "ruler" && rulerStart) {
        const p = canvasToWorld(e, side);
        const dx = p.x - rulerStart.x, dy = p.y - rulerStart.y;
        const L = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx) * 180/Math.PI;
        state[side].ruler = { a: rulerStart, b: p };
        document.getElementById("ruler-readout-" + side).textContent =
          `Δx=${dx.toFixed(1)} мм · Δy=${dy.toFixed(1)} мм · L=${L.toFixed(2)} мм · α=${ang.toFixed(1)}°`;
        schedule(side);
      }
    });
    canvas.addEventListener("mouseup", () => { panning = false; });
    canvas.addEventListener("mouseleave", () => { panning = false; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const v = state[side].view;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const scale = e.deltaY < 0 ? 1.1 : 1/1.1;
      const newZoom = Math.max(0.05, Math.min(20, v.zoom * scale));
      // zoom around cursor
      const k = newZoom / v.zoom;
      v.panX = mx - k * (mx - v.panX);
      v.panY = my - k * (my - v.panY);
      v.zoom = newZoom;
      schedule(side);
    }, { passive: false });

    return { canvas, ctx, wrap };
  }

  function canvasToWorld(e, side) {
    const canvas = document.getElementById("canvas-" + side);
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const v = state[side].view;
    const mmToPx = currentMmToPx(side) * v.zoom;
    const ox = v.panX, oy = v.panY;
    return { x: (px - ox) / mmToPx, y: (py - oy) / mmToPx };
  }

  function currentMmToPx(side) {
    // 1 мм -> px at zoom = 1, fitted to canvas.
    // For drafting: scale so that paper fits canvas; for geometry: 4 px/mm by default.
    if (side === "d") {
      const f = Sheet.getFormat(document.getElementById("d-format").value);
      const wrap = document.getElementById("canvas-wrap-d").getBoundingClientRect();
      const margin = 40;
      const sx = (wrap.width - margin) / f.w;
      const sy = (wrap.height - margin) / f.h;
      return Math.max(0.5, Math.min(sx, sy));
    } else {
      const b = state.g.autofitBounds;
      const wrap = document.getElementById("canvas-wrap-g").getBoundingClientRect();
      const margin = 40;
      if (b && Number.isFinite(b.minX) && (b.maxX - b.minX) > 0) {
        const sx = (wrap.width - margin) / (b.maxX - b.minX);
        const sy = (wrap.height - margin) / (b.maxY - b.minY);
        return Math.max(0.5, Math.min(sx, sy));
      }
      return 8; // 8 px на мм по умолчанию
    }
  }

  const dC = setupCanvas("canvas-d", "canvas-wrap-d", "d");
  const gC = setupCanvas("canvas-g", "canvas-wrap-g", "g");

  // ----- grid (0.5 cm = 5 mm) -------------------------------------------
  function drawGrid(ctx, side, mmToPx, originX, originY, viewW, viewH, opacity) {
    if (opacity <= 0) return;
    const step = 5; // мм
    const minorAlpha = 0.5 * opacity;
    const majorAlpha = 1.0 * opacity;
    // visible world rect:
    const xMinW = -originX / mmToPx;
    const yMinW = -originY / mmToPx;
    const xMaxW = (viewW - originX) / mmToPx;
    const yMaxW = (viewH - originY) / mmToPx;
    const x0 = Math.floor(xMinW / step) * step;
    const y0 = Math.floor(yMinW / step) * step;
    ctx.save();
    for (let x = x0; x <= xMaxW; x += step) {
      const isMajor = Math.round(x / 10) * 10 === Math.round(x);
      ctx.strokeStyle = isMajor ? "rgba(140,160,180," + majorAlpha + ")"
                                : "rgba(120,140,170," + minorAlpha + ")";
      ctx.lineWidth = isMajor ? 0.6 : 0.3;
      const px = x * mmToPx + originX;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, viewH); ctx.stroke();
    }
    for (let y = y0; y <= yMaxW; y += step) {
      const isMajor = Math.round(y / 10) * 10 === Math.round(y);
      ctx.strokeStyle = isMajor ? "rgba(140,160,180," + majorAlpha + ")"
                                : "rgba(120,140,170," + minorAlpha + ")";
      ctx.lineWidth = isMajor ? 0.6 : 0.3;
      const py = y * mmToPx + originY;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(viewW, py); ctx.stroke();
    }
    ctx.restore();
  }

  function drawAxes(ctx, mmToPx, originX, originY, viewW, viewH, axisYUp) {
    ctx.save();
    ctx.strokeStyle = "rgba(150,90,90,0.7)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, originY); ctx.lineTo(viewW, originY);
    ctx.moveTo(originX, 0); ctx.lineTo(originX, viewH);
    ctx.stroke();
    ctx.fillStyle = "rgba(160,100,100,0.9)";
    ctx.font = "11px sans-serif";
    ctx.fillText("x", viewW - 10, originY - 4);
    ctx.fillText(axisYUp ? "y" : "y", originX + 4, 10);
    ctx.restore();
  }

  // ----- render flow ----------------------------------------------------
  function schedule(side) {
    const s = state[side];
    if (s._raf) return;
    s._raf = requestAnimationFrame(() => { s._raf = 0; render(side); });
  }

  function render(side) {
    if (side === "d") renderDrafting();
    else renderGeometry();
  }

  function renderDrafting() {
    const { canvas, ctx } = dC;
    const wrap = document.getElementById("canvas-wrap-d").getBoundingClientRect();
    const viewW = wrap.width, viewH = wrap.height;
    ctx.clearRect(0, 0, viewW, viewH);

    const v = state.d.view;
    const mmToPxBase = currentMmToPx("d");
    const mmToPx = mmToPxBase * v.zoom;
    const formatName = document.getElementById("d-format").value;
    const F = Sheet.getFormat(formatName);
    // Default centering when pan==0
    if (!v._inited) {
      v.panX = (viewW - F.w * mmToPx) / 2;
      v.panY = (viewH - F.h * mmToPx) / 2;
      v._inited = true;
    }

    // background paper
    ctx.fillStyle = "#fbf9f3";
    ctx.fillRect(v.panX, v.panY, F.w * mmToPx, F.h * mmToPx);

    // grid (inside paper)
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.panX, v.panY, F.w * mmToPx, F.h * mmToPx);
    ctx.clip();
    const gridOp = +document.getElementById("grid-opacity-d").value / 100;
    drawGridOnPaper(ctx, v.panX, v.panY, F.w, F.h, mmToPx, gridOp);
    ctx.restore();

    // transform to mm
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(mmToPx, mmToPx);

    // sheet frame + title block
    Sheet.drawSheet(ctx, formatName, getTitleBlockFields());

    // user drawing inside work area
    const wa = Sheet.workArea(formatName);
    ctx.save();
    // Clip drawing to inside frame (paper minus margins, also exclude title block area).
    ctx.beginPath();
    ctx.rect(wa.x, wa.y, wa.w, wa.h);
    ctx.clip();

    ctx.translate(wa.x, wa.y);
    const lineWeightScale = (+document.getElementById("line-weight-d").value / 7);
    const inkAlpha = +document.getElementById("ink-opacity-d").value / 100;

    const src = document.getElementById("code-d").value;
    let runResult = { errors: [] };
    if (src.trim()) {
      const ops = DSL.parse(src);
      runResult = DSL.execute(ops, ctx, { lineWeightScale, inkAlpha });
    }
    ctx.restore();
    ctx.restore();

    // ruler overlay
    drawRulerOverlay("d", mmToPx);

    setStatus("d", runResult.errors);
  }

  function renderGeometry() {
    const { canvas, ctx } = gC;
    const wrap = document.getElementById("canvas-wrap-g").getBoundingClientRect();
    const viewW = wrap.width, viewH = wrap.height;
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.fillStyle = "#0a0d12";
    ctx.fillRect(0, 0, viewW, viewH);

    const v = state.g.view;

    // First parse to get bounds + axis flag
    const src = document.getElementById("code-g").value;
    let probeResult = { bounds: null, axisYUp: false };
    let ops = [];
    if (src.trim()) {
      ops = DSL.parse(src);
      // pre-scan for axis directive and view
      let axisYUp = false; let vp = null;
      for (const op of ops) {
        if (op.cmd === "axis") {
          const val = (op.args[0]&&op.args[0].value||"").toLowerCase();
          axisYUp = (val === "y-up" || val === "up");
        }
        if (op.cmd === "view") {
          vp = [Number(op.args[0]&&op.args[0].value),Number(op.args[1]&&op.args[1].value),
                Number(op.args[2]&&op.args[2].value),Number(op.args[3]&&op.args[3].value)];
        }
      }
      probeResult.axisYUp = axisYUp;
      if (vp && vp.every(Number.isFinite)) {
        const minY = axisYUp ? -vp[3] : vp[1];
        const maxY = axisYUp ? -vp[1] : vp[3];
        probeResult.bounds = { minX: vp[0], maxX: vp[2], minY, maxY };
      }
    }

    // autofit: if code has view, use it; otherwise default ±10
    let bounds = probeResult.bounds;
    if (!bounds) bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    state.g.autofitBounds = bounds;

    const margin = 30;
    const sx = (viewW - margin*2) / (bounds.maxX - bounds.minX);
    const sy = (viewH - margin*2) / (bounds.maxY - bounds.minY);
    const baseMmToPx = Math.min(sx, sy);
    const mmToPx = baseMmToPx * v.zoom;

    if (!v._inited) {
      v.panX = viewW/2 - (bounds.minX + bounds.maxX)/2 * mmToPx;
      v.panY = viewH/2 - (bounds.minY + bounds.maxY)/2 * mmToPx;
      v._inited = true;
    }

    // grid
    const gridOp = +document.getElementById("grid-opacity-g").value / 100;
    drawGrid(ctx, "g", mmToPx, v.panX, v.panY, viewW, viewH, gridOp);

    // axes
    if (document.getElementById("g-show-axes").checked) {
      drawAxes(ctx, mmToPx, v.panX, v.panY, viewW, viewH, probeResult.axisYUp);
    }

    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(mmToPx, mmToPx);

    const lineWeightScale = (+document.getElementById("line-weight-g").value / 5);
    const inkAlpha = +document.getElementById("ink-opacity-g").value / 100;

    // pen color: light on dark
    let runResult = { errors: [] };
    if (ops.length) {
      // For geometry mode we want light ink
      // Temporarily monkey-patch by wrapping ctx to override default color.
      const oldFill = ctx.fillStyle, oldStroke = ctx.strokeStyle;
      runResult = DSL.execute(ops, ctx, { lineWeightScale, inkAlpha });
    }
    ctx.restore();

    drawRulerOverlay("g", mmToPx);
    setStatus("g", runResult.errors);
  }

  function drawGridOnPaper(ctx, ox, oy, paperW, paperH, mmToPx, opacity) {
    if (opacity <= 0) return;
    ctx.save();
    const step = 5;
    for (let x = 0; x <= paperW; x += step) {
      const isMajor = (x % 10 === 0);
      ctx.strokeStyle = isMajor ? `rgba(80,110,150,${0.6*opacity})`
                                 : `rgba(100,130,170,${0.3*opacity})`;
      ctx.lineWidth = isMajor ? 0.5 : 0.25;
      const px = ox + x * mmToPx;
      ctx.beginPath(); ctx.moveTo(px, oy); ctx.lineTo(px, oy + paperH * mmToPx); ctx.stroke();
    }
    for (let y = 0; y <= paperH; y += step) {
      const isMajor = (y % 10 === 0);
      ctx.strokeStyle = isMajor ? `rgba(80,110,150,${0.6*opacity})`
                                 : `rgba(100,130,170,${0.3*opacity})`;
      ctx.lineWidth = isMajor ? 0.5 : 0.25;
      const py = oy + y * mmToPx;
      ctx.beginPath(); ctx.moveTo(ox, py); ctx.lineTo(ox + paperW * mmToPx, py); ctx.stroke();
    }
    ctx.restore();
  }

  function drawRulerOverlay(side, mmToPx) {
    const s = state[side].ruler;
    if (!s) return;
    const C = (side === "d" ? dC : gC);
    const v = state[side].view;
    const ctx = C.ctx;
    ctx.save();
    ctx.strokeStyle = "#ffb86b";
    ctx.fillStyle = "#ffb86b";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6,3]);
    const a = { x: s.a.x * mmToPx + v.panX, y: s.a.y * mmToPx + v.panY };
    const b = { x: s.b.x * mmToPx + v.panX, y: s.b.y * mmToPx + v.panY };
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function setStatus(side, errors) {
    const el = document.getElementById("status-" + side);
    if (!errors || !errors.length) {
      el.textContent = "Готов.";
      el.classList.remove("err"); el.classList.add("ok");
    } else {
      el.textContent = "Ошибок: " + errors.length + " — " + errors.slice(0, 3).join(" | ");
      el.classList.remove("ok"); el.classList.add("err");
    }
  }

  // ----- title block fields --------------------------------------------
  function getTitleBlockFields() {
    return {
      title: val("tb-title"),
      code: val("tb-code"),
      material: val("tb-material"),
      scale: val("tb-scale"),
      letter: val("tb-letter"),
      mass: val("tb-mass"),
      author: val("tb-author"),
      checker: val("tb-checker"),
      approver: val("tb-approver"),
      sheet: val("tb-sheet"),
      sheets: val("tb-sheets"),
      date: val("tb-date"),
      org: val("tb-org"),
    };
  }
  function val(id) { const e = document.getElementById(id); return e ? e.value : ""; }

  // ----- wire controls -------------------------------------------------
  const inputs = [
    "d-format","grid-opacity-d","line-weight-d","ink-opacity-d",
    "tb-title","tb-code","tb-material","tb-scale","tb-letter","tb-mass",
    "tb-author","tb-checker","tb-approver","tb-sheet","tb-sheets","tb-date","tb-org",
    "snap-d",
    "g-axis","g-show-axes","g-autofit","grid-opacity-g","line-weight-g","ink-opacity-g","snap-g"
  ];
  for (const id of inputs) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", () => {
      // when format changes, reset view centering
      if (id === "d-format") state.d.view._inited = false;
      schedule(id.endsWith("-g") ? "g" : "d");
    });
  }

  document.getElementById("code-d").addEventListener("input", () => schedule("d"));
  document.getElementById("code-g").addEventListener("input", () => { state.g.view._inited = false; schedule("g"); });

  // tool buttons
  function bindToolButtons(side) {
    const root = document.getElementById("page-" + (side === "d" ? "drafting" : "geometry"));
    root.querySelectorAll(".tool").forEach(btn => {
      btn.addEventListener("click", () => {
        root.querySelectorAll(".tool").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state[side].tool = btn.dataset.tool;
        if (state[side].tool !== "ruler") { state[side].ruler = null; schedule(side); }
      });
    });
  }
  bindToolButtons("d");
  bindToolButtons("g");

  // render button
  document.getElementById("btn-render").addEventListener("click", () => {
    schedule(currentSide());
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      schedule(currentSide());
    }
  });

  function currentSide() {
    const active = document.querySelector(".tab.active").dataset.tab;
    return active === "geometry" ? "g" : "d";
  }

  // clear/example
  document.getElementById("d-clear").addEventListener("click", () => {
    document.getElementById("code-d").value = ""; schedule("d");
  });
  document.getElementById("g-clear").addEventListener("click", () => {
    document.getElementById("code-g").value = ""; state.g.view._inited = false; schedule("g");
  });
  document.getElementById("d-example").addEventListener("click", () => {
    document.getElementById("code-d").value = exampleDrafting();
    schedule("d");
  });
  document.getElementById("g-example").addEventListener("click", () => {
    document.getElementById("code-g").value = exampleGeometry();
    state.g.view._inited = false; schedule("g");
  });

  // ----- export ---------------------------------------------------------
  document.getElementById("btn-export-png").addEventListener("click", () => {
    const side = currentSide();
    const canvas = document.getElementById("canvas-" + side);
    const link = document.createElement("a");
    link.download = (side === "d" ? "chertezh" : "geometry") + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
  document.getElementById("btn-export-svg").addEventListener("click", () => {
    // We render again into an SVG-like canvas: simplest approach is to redraw using a virtual context.
    // Quick path: package PNG as data URL inside an SVG wrapper.
    const side = currentSide();
    const canvas = document.getElementById("canvas-" + side);
    const w = canvas.width, h = canvas.height;
    const dataUrl = canvas.toDataURL("image/png");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <image href="${dataUrl}" width="${w}" height="${h}"/>
    </svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.download = (side === "d" ? "chertezh" : "geometry") + ".svg";
    a.href = URL.createObjectURL(blob);
    a.click();
  });

  // ----- prompts page --------------------------------------------------
  const pCat = document.getElementById("p-category");
  const pFam = document.getElementById("p-family");
  const pVar = document.getElementById("p-variants");
  const pTitle = document.getElementById("p-title");
  const pText = document.getElementById("p-text");
  const pMeta = document.getElementById("p-meta");
  const pCopy = document.getElementById("p-copy");
  const pStatus = document.getElementById("p-status");

  let currentVariant = null;
  function refreshVariants() {
    pVar.innerHTML = "";
    const cat = pCat.value;
    const fam = pFam.value;
    const list = (Prompts.VARIANTS[cat] || []).filter(v => v.family.includes(fam));
    list.forEach((v, i) => {
      const b = document.createElement("button");
      b.textContent = v.title;
      b.addEventListener("click", () => {
        for (const c of pVar.children) c.classList.remove("active");
        b.classList.add("active");
        showVariant(v);
      });
      pVar.appendChild(b);
      if (i === 0) { b.classList.add("active"); showVariant(v); }
    });
    if (!list.length) {
      pTitle.textContent = "Нет вариантов для этого сочетания";
      pText.value = "Поменяй категорию или семейство модели.";
      pMeta.textContent = "";
      currentVariant = null;
    }
  }
  function showVariant(v) {
    currentVariant = v;
    pTitle.textContent = v.title;
    pMeta.textContent = "Категория: " + pCat.options[pCat.selectedIndex].text +
                        " · Модель: " + pFam.options[pFam.selectedIndex].text;
    pText.value = v.body({ family: pFam.value });
  }
  pCat.addEventListener("change", refreshVariants);
  pFam.addEventListener("change", refreshVariants);
  pCopy.addEventListener("click", async () => {
    if (!currentVariant) return;
    try {
      await navigator.clipboard.writeText(pText.value);
      pStatus.textContent = "Скопировано! Отправь нейросети вместе с изображением задания.";
      pStatus.classList.add("ok"); pStatus.classList.remove("err");
    } catch (e) {
      pText.select();
      pStatus.textContent = "Не удалось скопировать автоматически — выдели текст и Ctrl+C.";
      pStatus.classList.add("err");
    }
  });
  refreshVariants();

  // ----- examples ------------------------------------------------------
  function exampleDrafting() {
    return `# Пример: пластина с отверстием и пазом
translate 30 20
layer axis
line 90 30 90 -5
line 90 30 90 65
line -5 30 195 30
# контур
layer main
polyline 0,0 180,0 180,60 0,60 0,0
# отверстие
circle 60 30 12
dim-d 60 30 12 angle=30 text="⌀24"
# паз
rect 110 22 50 16
# размеры
dim-h 0 0 180 0 offset=12 text="180"
dim-v 180 0 180 60 offset=12 text="60"
dim-h 110 38 160 38 offset=22 text="50"
dim-v 110 22 110 38 offset=-12 text="16"
text 90 -8 "Пластина" size=4 align=center
`;
  }
  function exampleGeometry() {
    return `# Пример: прямоугольный треугольник ABC с высотой к гипотенузе
axis y-up
view -2 -2 10 8

mark 0 0 "A"
mark 8 0 "B"
mark 0 6 "C"

polygon 0,0 8,0 0,6

# прямой угол при A
right-angle 0 0 1 0 size=0.8

# высота CH к гипотенузе BC (здесь — медиана от прямого угла, для иллюстрации)
mark 2.88 2.16 "H"
layer construction
line 0 0 2.88 2.16

# размеры катетов и гипотенузы
dim-h 0 0 8 0 offset=-1.2 text="8"
dim-v 0 0 0 6 offset=-1.2 text="6"
dim-l 8 0 0 6 offset=0.8 text="10"

# подпись угла при B
dim-a 0 0 8 0 0 6 radius=1.5
`;
  }

  // initial render
  schedule("d");

})();
