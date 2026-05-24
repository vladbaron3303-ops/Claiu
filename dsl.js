// dsl.js — парсер и исполнитель команд чертёжного DSL.
// Все координаты в миллиметрах. Y по умолчанию вниз; axis y-up инвертирует.

(function (global) {
  "use strict";

  const LAYERS = {
    main:         { color: "#111", width: 0.7, dash: "solid" },
    thin:         { color: "#111", width: 0.3, dash: "solid" },
    axis:         { color: "#a02020", width: 0.3, dash: "center" },
    hidden:       { color: "#111", width: 0.5, dash: "dashed" },
    dim:          { color: "#444", width: 0.25, dash: "solid" },
    construction: { color: "#5a8acb", width: 0.2, dash: "dashed" },
  };

  const DASH_PATTERNS = {
    solid:   [],
    dashed:  [4, 2],
    dotted:  [1, 2],
    dashdot: [6, 2, 1, 2],
    center:  [8, 2, 1, 2],
    phantom: [10, 2, 1, 2, 1, 2],
  };

  // --- tokenizer ----------------------------------------------------------
  // Split a line into tokens. Supports "quoted strings", x,y pairs, and key=value.
  function tokenize(line) {
    const out = [];
    let i = 0, n = line.length;
    while (i < n) {
      const c = line[i];
      if (c === " " || c === "\t") { i++; continue; }
      if (c === "\"") {
        let j = i + 1, s = "";
        while (j < n && line[j] !== "\"") {
          if (line[j] === "\\" && j + 1 < n) { s += line[j+1]; j += 2; continue; }
          s += line[j++];
        }
        out.push({ kind: "str", value: s });
        i = j + 1;
      } else {
        let j = i;
        while (j < n && line[j] !== " " && line[j] !== "\t") j++;
        out.push({ kind: "raw", value: line.slice(i, j) });
        i = j;
      }
    }
    return out;
  }

  function parsePairs(args, startIdx) {
    // returns {points:[{x,y},...], rest:[token,...]} from positional args
    // Used for polyline/polygon: tokens are "x,y" or pair of numbers.
    const points = [];
    let i = startIdx;
    while (i < args.length) {
      const t = args[i];
      if (t.kind !== "raw") break;
      if (t.value.includes(",")) {
        const [a, b] = t.value.split(",");
        const x = Number(a), y = Number(b);
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        points.push({ x, y });
        i++;
      } else if (t.value.includes("=")) {
        break;
      } else {
        // numeric pair (two separate tokens)
        const next = args[i + 1];
        const x = Number(t.value);
        const y = next ? Number(next.value) : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        points.push({ x, y });
        i += 2;
      }
    }
    return { points, rest: args.slice(i) };
  }

  function parseOptions(tokens) {
    const opts = {};
    for (const t of tokens) {
      if (t.kind === "str") { opts._text = t.value; continue; }
      const m = /^([a-zA-Z_-]+)=(.*)$/.exec(t.value);
      if (!m) continue;
      const key = m[1].toLowerCase();
      let val = m[2];
      if (val.startsWith("\"") && val.endsWith("\"")) val = val.slice(1, -1);
      const num = Number(val);
      opts[key] = Number.isFinite(num) && /^[-0-9.]/.test(val) && val !== "" ? num : val;
    }
    return opts;
  }

  function num(token) { return token ? Number(token.value) : NaN; }

  // --- main parser --------------------------------------------------------
  function parse(src) {
    const ops = [];
    const lines = src.split(/\r?\n/);
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      let raw = lines[lineNo];
      const hashIdx = indexOfUnquoted(raw, "#");
      if (hashIdx >= 0) raw = raw.slice(0, hashIdx);
      raw = raw.trim();
      if (!raw) continue;
      const tokens = tokenize(raw);
      if (!tokens.length) continue;
      const cmd = tokens[0].value.toLowerCase();
      const args = tokens.slice(1);
      ops.push({ cmd, args, lineNo: lineNo + 1, raw: lines[lineNo] });
    }
    return ops;
  }

  function indexOfUnquoted(s, ch) {
    let inQ = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\"") inQ = !inQ;
      else if (!inQ && s[i] === ch) return i;
    }
    return -1;
  }

  // --- coordinate frame ---------------------------------------------------
  // Bounds tracker for auto-fit (geometry mode).
  function makeBounds() {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
      add(x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
        if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y; },
      addCircle(cx, cy, r) { this.add(cx-r, cy-r); this.add(cx+r, cy+r); },
      isEmpty() { return !Number.isFinite(this.minX); },
      pad(p) { this.minX-=p; this.minY-=p; this.maxX+=p; this.maxY+=p; },
    };
  }

  // --- runtime state ------------------------------------------------------
  function makeState() {
    return {
      style: { color: "#111", width: 0.5, dash: "solid", fill: null, fillAlpha: 1 },
      transformStack: [{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }],
      styleStack: [],
      axisYUp: false,
      viewport: null,            // [xmin, ymin, xmax, ymax] for geometry
      errors: [],
    };
  }

  function curT(s) { return s.transformStack[s.transformStack.length - 1]; }
  function mul(t1, t2) {
    return {
      a: t1.a*t2.a + t1.c*t2.b,
      b: t1.b*t2.a + t1.d*t2.b,
      c: t1.a*t2.c + t1.c*t2.d,
      d: t1.b*t2.c + t1.d*t2.d,
      e: t1.a*t2.e + t1.c*t2.f + t1.e,
      f: t1.b*t2.e + t1.d*t2.f + t1.f,
    };
  }
  function applyT(t, x, y) { return { x: t.a*x + t.c*y + t.e, y: t.b*x + t.d*y + t.f }; }

  // --- execute (two passes: bounds, then render) --------------------------

  function execute(ops, ctx, opts) {
    const s = makeState();
    const bounds = makeBounds();
    // First pass: gather bounds + execute everything to ctx.
    // We do a single pass but record bounds while drawing.
    // For viewport setup (axis, view) we just record state.

    const lineWeightScale = opts.lineWeightScale || 1.0;
    const inkAlpha = opts.inkAlpha != null ? opts.inkAlpha : 1.0;

    function setStroke() {
      ctx.strokeStyle = s.style.color;
      ctx.lineWidth = Math.max(0.05, s.style.width * lineWeightScale);
      const dash = DASH_PATTERNS[s.style.dash] || [];
      ctx.setLineDash(dash.map(v => v * lineWeightScale));
      ctx.globalAlpha = inkAlpha;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    function setFill() {
      ctx.fillStyle = s.style.fill || s.style.color;
      ctx.globalAlpha = inkAlpha * (s.style.fillAlpha != null ? s.style.fillAlpha : 1);
    }

    function pt(x, y) {
      let yy = s.axisYUp ? -y : y;
      const t = curT(s);
      return applyT(t, x, yy);
    }
    function trackBounds(x, y) { bounds.add(x, s.axisYUp ? -y : y); }

    function moveTo(x, y) { const p = pt(x, y); ctx.moveTo(p.x, p.y); trackBounds(x, y); }
    function lineTo(x, y) { const p = pt(x, y); ctx.lineTo(p.x, p.y); trackBounds(x, y); }

    function err(op, msg) {
      s.errors.push(`строка ${op.lineNo}: ${msg} (${op.raw.trim()})`);
    }

    function applyLayer(name) {
      const L = LAYERS[name];
      if (!L) return false;
      s.style.color = L.color;
      s.style.width = L.width;
      s.style.dash = L.dash;
      return true;
    }

    for (const op of ops) {
      try { dispatch(op); }
      catch (e) { err(op, e.message); }
    }

    return { bounds, errors: s.errors };

    function dispatch(op) {
      const a = op.args;
      switch (op.cmd) {
        // === directives ===
        case "axis": {
          const v = (a[0] && a[0].value || "").toLowerCase();
          s.axisYUp = (v === "y-up" || v === "up");
          break;
        }
        case "view": {
          s.viewport = [num(a[0]), num(a[1]), num(a[2]), num(a[3])];
          bounds.add(s.viewport[0], s.viewport[1]);
          bounds.add(s.viewport[2], s.viewport[3]);
          break;
        }
        case "layer": {
          const name = (a[0] && a[0].value || "").toLowerCase();
          if (!applyLayer(name)) err(op, `неизвестный слой: ${name}`);
          break;
        }
        case "style": {
          const opts = parseOptions(a);
          if (opts.color != null) s.style.color = String(opts.color);
          if (opts.width != null) s.style.width = Number(opts.width);
          if (opts.dash != null)  s.style.dash  = String(opts.dash);
          break;
        }
        case "fill": {
          const opts = parseOptions(a);
          s.style.fill = opts.color != null ? String(opts.color) : (s.style.color);
          s.style.fillAlpha = opts.alpha != null ? Number(opts.alpha) : 1;
          break;
        }
        case "nofill": { s.style.fill = null; break; }

        case "push": { s.styleStack.push(JSON.parse(JSON.stringify(s.style)));
                       s.transformStack.push(Object.assign({}, curT(s))); break; }
        case "pop":  { if (s.styleStack.length) s.style = s.styleStack.pop();
                       if (s.transformStack.length > 1) s.transformStack.pop(); break; }
        case "reset": { s.style = { color: "#111", width: 0.5, dash: "solid", fill: null, fillAlpha: 1 };
                       s.transformStack = [{ a:1,b:0,c:0,d:1,e:0,f:0 }]; break; }

        case "translate": {
          const dx = num(a[0]), dy = num(a[1]);
          const t = curT(s);
          s.transformStack[s.transformStack.length-1] = mul(t, {a:1,b:0,c:0,d:1,e:dx,f:dy});
          break;
        }
        case "rotate": {
          const ang = num(a[0]) * Math.PI / 180;
          const cx = a[1] ? num(a[1]) : 0, cy = a[2] ? num(a[2]) : 0;
          let t = curT(s);
          if (cx || cy) t = mul(t, {a:1,b:0,c:0,d:1,e:cx,f:cy});
          t = mul(t, {a:Math.cos(ang), b:Math.sin(ang), c:-Math.sin(ang), d:Math.cos(ang), e:0, f:0});
          if (cx || cy) t = mul(t, {a:1,b:0,c:0,d:1,e:-cx,f:-cy});
          s.transformStack[s.transformStack.length-1] = t;
          break;
        }
        case "scale": {
          const sx = num(a[0]); const sy = a[1] ? num(a[1]) : sx;
          const t = curT(s);
          s.transformStack[s.transformStack.length-1] = mul(t, {a:sx,b:0,c:0,d:sy,e:0,f:0});
          break;
        }

        // === primitives ===
        case "line": {
          const x1=num(a[0]), y1=num(a[1]), x2=num(a[2]), y2=num(a[3]);
          setStroke(); ctx.beginPath(); moveTo(x1,y1); lineTo(x2,y2); ctx.stroke();
          break;
        }
        case "polyline":
        case "polygon": {
          const { points } = parsePairs(a, 0);
          if (points.length < 2) { err(op, "нужно ≥2 точек"); break; }
          setStroke(); ctx.beginPath();
          moveTo(points[0].x, points[0].y);
          for (let i=1;i<points.length;i++) lineTo(points[i].x, points[i].y);
          if (op.cmd === "polygon") ctx.closePath();
          if (s.style.fill && op.cmd === "polygon") { setFill(); ctx.fill(); setStroke(); }
          ctx.stroke();
          break;
        }
        case "rect": {
          const x=num(a[0]), y=num(a[1]), w=num(a[2]), h=num(a[3]);
          setStroke(); ctx.beginPath();
          moveTo(x,y); lineTo(x+w,y); lineTo(x+w,y+h); lineTo(x,y+h); ctx.closePath();
          if (s.style.fill) { setFill(); ctx.fill(); setStroke(); }
          ctx.stroke();
          break;
        }
        case "circle": {
          const cx=num(a[0]), cy=num(a[1]), r=num(a[2]);
          drawEllipseArc(cx, cy, r, r, 0, 0, 360);
          if (s.style.fill) {
            setFill();
            ctx.beginPath();
            drawEllipsePathOnly(cx,cy,r,r,0,0,360);
            ctx.fill();
          }
          break;
        }
        case "ellipse": {
          const cx=num(a[0]), cy=num(a[1]), rx=num(a[2]), ry=num(a[3]);
          const ang = a[4] ? num(a[4]) : 0;
          drawEllipseArc(cx, cy, rx, ry, ang, 0, 360);
          break;
        }
        case "arc": {
          const cx=num(a[0]), cy=num(a[1]), r=num(a[2]), s1=num(a[3]), s2=num(a[4]);
          drawEllipseArc(cx, cy, r, r, 0, s1, s2);
          break;
        }
        case "point": {
          const x=num(a[0]), y=num(a[1]);
          const p = pt(x, y);
          setFill();
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, 1.0*lineWeightScale), 0, Math.PI*2); ctx.fill();
          trackBounds(x, y);
          break;
        }
        case "text": {
          const x=num(a[0]), y=num(a[1]);
          const strTok = a.find(t=>t.kind==="str");
          const opts = parseOptions(a.slice(2));
          const text = strTok ? strTok.value : (opts._text || "");
          drawText(x, y, text, opts);
          break;
        }
        case "mark": {
          // mark x y "A" — точка с подписью большой буквой
          const x=num(a[0]), y=num(a[1]);
          const strTok = a.find(t=>t.kind==="str");
          const p = pt(x, y);
          setFill();
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.2*lineWeightScale, 0, Math.PI*2); ctx.fill();
          if (strTok) {
            drawText(x, y, strTok.value, { size: 3.5, _offsetPx: { dx: 4, dy: -4 } });
          }
          trackBounds(x, y);
          break;
        }
        case "right-angle": {
          // right-angle x y dx dy [size=2]
          const x=num(a[0]), y=num(a[1]), dx=num(a[2]), dy=num(a[3]);
          const opts = parseOptions(a.slice(4));
          const sz = opts.size != null ? Number(opts.size) : 2.5;
          // dx,dy is the direction along one side from corner
          const L = Math.hypot(dx,dy) || 1;
          const ux = dx/L, uy = dy/L;
          const vx = -uy, vy = ux;
          const p0 = { x: x + ux*sz, y: y + uy*sz };
          const p1 = { x: p0.x + vx*sz, y: p0.y + vy*sz };
          const p2 = { x: x + vx*sz, y: y + vy*sz };
          setStroke(); ctx.beginPath();
          moveTo(p0.x, p0.y); lineTo(p1.x, p1.y); lineTo(p2.x, p2.y); ctx.stroke();
          break;
        }
        case "tick":
        case "tick2":
        case "tick3": {
          const n = op.cmd === "tick" ? 1 : op.cmd === "tick2" ? 2 : 3;
          const x1=num(a[0]), y1=num(a[1]), x2=num(a[2]), y2=num(a[3]);
          drawTicks(x1,y1,x2,y2,n);
          break;
        }

        // === dimensions ===
        case "dim-h": dimLinear(a, "h"); break;
        case "dim-v": dimLinear(a, "v"); break;
        case "dim-l": dimLinear(a, "l"); break;
        case "dim-r": dimRadial(a, false); break;
        case "dim-d": dimRadial(a, true); break;
        case "dim-a": dimAngular(a); break;

        case "hatch-rect": {
          const x=num(a[0]), y=num(a[1]), w=num(a[2]), h=num(a[3]);
          const opts = parseOptions(a.slice(4));
          drawHatchRect(x, y, w, h, opts);
          break;
        }
        case "hatch-poly": {
          const { points, rest } = parsePairs(a, 0);
          const opts = parseOptions(rest);
          drawHatchPoly(points, opts);
          break;
        }

        default:
          err(op, `неизвестная команда: ${op.cmd}`);
      }
    }

    // --- helpers ----------------------------------------------------------

    function drawEllipsePathOnly(cx, cy, rx, ry, ang, s1, s2) {
      const c = pt(cx, cy);
      const angR = (ang||0) * Math.PI/180;
      const sgn = s.axisYUp ? -1 : 1;
      const a1 = s1 * Math.PI / 180;
      const a2 = s2 * Math.PI / 180;
      // canvas ellipse handles arc nicely
      // ctx orientation: ccw=false means clockwise (standard math counter-clockwise mapped onto screen Y-down).
      const ccw = sgn < 0;
      ctx.ellipse(c.x, c.y, Math.abs(rx)*absScale().sx, Math.abs(ry)*absScale().sy,
        angR * sgn, sgn*a1, sgn*a2, ccw);
    }
    function drawEllipseArc(cx, cy, rx, ry, ang, s1, s2) {
      setStroke();
      ctx.beginPath();
      drawEllipsePathOnly(cx, cy, rx, ry, ang, s1, s2);
      ctx.stroke();
      bounds.add(cx-rx, (s.axisYUp?-1:1)*(cy-ry));
      bounds.add(cx+rx, (s.axisYUp?-1:1)*(cy+ry));
    }
    function absScale() {
      const t = curT(s);
      return { sx: Math.hypot(t.a, t.b), sy: Math.hypot(t.c, t.d) };
    }

    function drawText(x, y, text, opts) {
      const size = (opts && opts.size != null) ? Number(opts.size) : 3.5;
      const align = (opts && opts.align) || "left";
      const baseline = (opts && opts.baseline) || "alphabetic";
      const angle = (opts && opts.angle != null) ? Number(opts.angle) : 0;
      const p = pt(x, y);
      ctx.save();
      ctx.fillStyle = s.style.color;
      ctx.globalAlpha = inkAlpha;
      ctx.translate(p.x, p.y);
      if (opts && opts._offsetPx) ctx.translate(opts._offsetPx.dx, opts._offsetPx.dy);
      if (angle) ctx.rotate(-angle * Math.PI/180 * (s.axisYUp ? 1 : 1));
      // size in mm -> px via transform; use a canvas font sized in px and scale.
      const pxSize = size * absScale().sx;
      ctx.font = `${pxSize.toFixed(2)}px "Times New Roman", "Liberation Serif", serif`;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.fillText(text, 0, 0);
      ctx.restore();
      trackBounds(x, y);
    }

    function drawTicks(x1, y1, x2, y2, n) {
      const mx = (x1+x2)/2, my = (y1+y2)/2;
      const dx = x2-x1, dy = y2-y1;
      const L = Math.hypot(dx,dy)||1;
      const ux = dx/L, uy = dy/L;     // along segment
      const vx = -uy, vy = ux;        // perpendicular
      const half = 1.5;               // tick length in mm
      const gap = 0.8;                // gap between ticks
      setStroke();
      for (let i=0;i<n;i++) {
        const offset = (i - (n-1)/2) * gap;
        const cx = mx + ux*offset, cy = my + uy*offset;
        ctx.beginPath();
        moveTo(cx - vx*half, cy - vy*half);
        lineTo(cx + vx*half, cy + vy*half);
        ctx.stroke();
      }
    }

    function dimLinear(a, kind) {
      const x1=num(a[0]), y1=num(a[1]), x2=num(a[2]), y2=num(a[3]);
      const opts = parseOptions(a.slice(4));
      const off = opts.offset != null ? Number(opts.offset) : 10;
      const ext = 1.5;
      const arrow = 2;
      const saveLayer = { ...s.style };
      applyLayer("dim");

      let p1, p2, dimText;
      if (kind === "h") {
        const yLine = Math.max(y1, y2) + off; // ниже точек
        p1 = { x: x1, y: yLine };
        p2 = { x: x2, y: yLine };
        dimText = opts._text || `${Math.abs(x2-x1).toFixed(opts.precision||0)}`;
        // extension lines
        drawSimpleLine(x1, y1 + Math.sign(yLine - y1)*ext, x1, yLine + Math.sign(yLine-y1)*ext);
        drawSimpleLine(x2, y2 + Math.sign(yLine - y2)*ext, x2, yLine + Math.sign(yLine-y2)*ext);
      } else if (kind === "v") {
        const xLine = Math.max(x1, x2) + off;
        p1 = { x: xLine, y: y1 };
        p2 = { x: xLine, y: y2 };
        dimText = opts._text || `${Math.abs(y2-y1).toFixed(opts.precision||0)}`;
        drawSimpleLine(x1 + Math.sign(xLine-x1)*ext, y1, xLine + Math.sign(xLine-x1)*ext, y1);
        drawSimpleLine(x2 + Math.sign(xLine-x2)*ext, y2, xLine + Math.sign(xLine-x2)*ext, y2);
      } else {
        // aligned: parallel offset to segment direction
        const dx = x2-x1, dy = y2-y1, L=Math.hypot(dx,dy)||1;
        const ux = dx/L, uy = dy/L; const vx = -uy, vy = ux;
        p1 = { x: x1 + vx*off, y: y1 + vy*off };
        p2 = { x: x2 + vx*off, y: y2 + vy*off };
        dimText = opts._text || `${L.toFixed(opts.precision||0)}`;
        drawSimpleLine(x1 + vx*ext, y1 + vy*ext, p1.x + vx*ext, p1.y + vy*ext);
        drawSimpleLine(x2 + vx*ext, y2 + vy*ext, p2.x + vx*ext, p2.y + vy*ext);
      }
      // dimension line
      drawSimpleLine(p1.x, p1.y, p2.x, p2.y);
      // arrows
      drawArrow(p2.x, p2.y, p1.x, p1.y, arrow);
      drawArrow(p1.x, p1.y, p2.x, p2.y, arrow);
      // text in mm above the line
      const mx = (p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
      const ddx = p2.x-p1.x, ddy=p2.y-p1.y, LL=Math.hypot(ddx,ddy)||1;
      const ang = Math.atan2(ddy, ddx) * 180/Math.PI;
      const tx = mx + (-ddy/LL)*1.5;
      const ty = my + (ddx/LL)*1.5;
      drawText(tx, ty, dimText, { size: 3.0, align: "center", baseline: "bottom",
        angle: Math.abs(ang)>90 ? ang+180 : ang });

      s.style = saveLayer;
    }

    function dimRadial(a, isDiameter) {
      const cx=num(a[0]), cy=num(a[1]), r=num(a[2]);
      const opts = parseOptions(a.slice(3));
      const ang = opts.angle != null ? Number(opts.angle) : 45;
      const aR = ang * Math.PI/180;
      // angle is a world/math angle: cos→world X, sin→world Y
      const px = cx + r*Math.cos(aR);
      const py = cy + r*Math.sin(aR);
      const out = 6;
      const ox = cx + (r+out)*Math.cos(aR);
      const oy = cy + (r+out)*Math.sin(aR);
      const saveLayer = { ...s.style };
      applyLayer("dim");
      drawSimpleLine(cx, cy, ox, oy);
      drawArrow(ox, oy, px, py, 2);
      const prefix = isDiameter ? "⌀" : "R";
      const value = isDiameter ? (2*r) : r;
      const text = opts._text || `${prefix}${value.toFixed(opts.precision||0)}`;
      drawText(ox + 2*Math.cos(aR), oy + 2*Math.sin(aR), text, { size: 3.0, baseline: "middle" });
      s.style = saveLayer;
    }

    function dimAngular(a) {
      const x1=num(a[0]), y1=num(a[1]), cx=num(a[2]), cy=num(a[3]), x2=num(a[4]), y2=num(a[5]);
      const opts = parseOptions(a.slice(6));
      const r = opts.radius != null ? Number(opts.radius) : 12;
      // world (math) angles of the two rays
      const a1 = Math.atan2(y1-cy, x1-cx);
      const a2 = Math.atan2(y2-cy, x2-cx);
      let aa1 = a1, aa2 = a2;
      while (aa2 < aa1) aa2 += 2*Math.PI;
      if (aa2 - aa1 > Math.PI) { const tmp = aa1; aa1 = aa2; aa2 = tmp + 2*Math.PI; }
      const saveLayer = { ...s.style }; applyLayer("dim");
      const startDeg = aa1*180/Math.PI;
      const endDeg = aa2*180/Math.PI;
      drawEllipseArc(cx, cy, r, r, 0, startDeg, endDeg);
      const mid = (aa1+aa2)/2;
      const tx = cx + (r+3)*Math.cos(mid);
      const ty = cy + (r+3)*Math.sin(mid);
      const degVal = Math.abs((aa2-aa1)*180/Math.PI);
      const text = opts._text || `${degVal.toFixed(opts.precision||0)}°`;
      drawText(tx, ty, text, { size: 3.0, align: "center", baseline: "middle" });
      s.style = saveLayer;
    }

    function drawSimpleLine(x1,y1,x2,y2) {
      setStroke();
      ctx.beginPath(); moveTo(x1,y1); lineTo(x2,y2); ctx.stroke();
    }

    function drawArrow(fromX, fromY, toX, toY, size) {
      // arrowhead at (toX,toY), pointing along (to - from)
      const p1 = pt(fromX, fromY), p2 = pt(toX, toY);
      const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy) || 1;
      const sc = absScale().sx;
      const head = size * sc;
      const ux = dx/L, uy = dy/L;
      const vx = -uy, vy = ux;
      ctx.save();
      ctx.fillStyle = s.style.color;
      ctx.globalAlpha = inkAlpha;
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - ux*head + vx*head*0.35, p2.y - uy*head + vy*head*0.35);
      ctx.lineTo(p2.x - ux*head - vx*head*0.35, p2.y - uy*head - vy*head*0.35);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawHatchRect(x, y, w, h, opts) {
      const ang = (opts.angle != null ? Number(opts.angle) : 45) * Math.PI/180;
      const sp = opts.spacing != null ? Number(opts.spacing) : 2.0;
      const saveLayer = { ...s.style }; applyLayer("thin");
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      // project corners onto perpendicular to hatch direction.
      const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
      let minP = Infinity, maxP = -Infinity;
      for (const [cx,cy] of corners) {
        const p = -sinA*cx + cosA*cy;
        if (p < minP) minP = p; if (p > maxP) maxP = p;
      }
      const startK = Math.ceil(minP / sp);
      const endK = Math.floor(maxP / sp);
      for (let k = startK; k <= endK; k++) {
        const c = k * sp;
        // line: -sinA * X + cosA * Y = c, parametric over hatch direction
        // find intersections with rect
        const segs = clipLineToRect(-sinA, cosA, c, x, y, x+w, y+h);
        for (const [p,q] of segs) drawSimpleLine(p.x, p.y, q.x, q.y);
      }
      s.style = saveLayer;
    }
    function drawHatchPoly(points, opts) {
      if (points.length < 3) return;
      const ang = (opts.angle != null ? Number(opts.angle) : 45) * Math.PI/180;
      const sp = opts.spacing != null ? Number(opts.spacing) : 2.0;
      const saveLayer = { ...s.style }; applyLayer("thin");
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      let minP = Infinity, maxP = -Infinity;
      for (const p of points) {
        const proj = -sinA*p.x + cosA*p.y;
        if (proj < minP) minP = proj; if (proj > maxP) maxP = proj;
      }
      const startK = Math.ceil(minP / sp);
      const endK = Math.floor(maxP / sp);
      for (let k = startK; k <= endK; k++) {
        const c = k * sp;
        const segs = clipLineToPoly(-sinA, cosA, c, points);
        for (const [p,q] of segs) drawSimpleLine(p.x, p.y, q.x, q.y);
      }
      s.style = saveLayer;
    }
  }

  // Helpers used by hatch — pure (no closure on state).
  function clipLineToRect(A, B, C, x1, y1, x2, y2) {
    // A*X + B*Y = C
    const pts = [];
    // top y=y1
    if (Math.abs(A) > 1e-9) {
      const x = (C - B*y1)/A; if (x >= x1 && x <= x2) pts.push({x, y:y1});
      const x2v = (C - B*y2)/A; if (x2v >= x1 && x2v <= x2) pts.push({x:x2v, y:y2});
    }
    if (Math.abs(B) > 1e-9) {
      const y = (C - A*x1)/B; if (y >= y1 && y <= y2) pts.push({x:x1, y});
      const yv = (C - A*x2)/B; if (yv >= y1 && yv <= y2) pts.push({x:x2, y:yv});
    }
    if (pts.length < 2) return [];
    // pick min-max
    pts.sort((a,b) => a.x === b.x ? a.y-b.y : a.x-b.x);
    return [[pts[0], pts[pts.length-1]]];
  }
  function clipLineToPoly(A, B, C, poly) {
    // Find intersections with each edge; pair them into segments inside.
    const xs = [];
    for (let i=0;i<poly.length;i++) {
      const p = poly[i], q = poly[(i+1)%poly.length];
      const f1 = A*p.x + B*p.y - C;
      const f2 = A*q.x + B*q.y - C;
      if (f1 === 0) xs.push({x:p.x, y:p.y, t:0});
      if ((f1 < 0 && f2 > 0) || (f1 > 0 && f2 < 0)) {
        const t = f1 / (f1 - f2);
        xs.push({ x: p.x + t*(q.x-p.x), y: p.y + t*(q.y-p.y), t });
      }
    }
    // sort by direction along the hatch line (perpendicular to (A,B))
    const dx = B, dy = -A;
    xs.sort((u,v) => (u.x*dx + u.y*dy) - (v.x*dx + v.y*dy));
    const segs = [];
    for (let i=0;i<xs.length-1;i+=2) segs.push([xs[i], xs[i+1]]);
    return segs;
  }

  global.DSL = { parse, execute, LAYERS, DASH_PATTERNS };
})(window);
