/* Размеры бумаги по ГОСТ 2.301, мм. Указана пара (короткая, длинная). */
const PAPER_SIZES = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189]
};

/* Поля рамки ГОСТ 2.301: слева 20 мм (для подшивки), остальные 5 мм. */
const FRAME_MARGINS = { left: 20, top: 5, right: 5, bottom: 5 };

/* Размеры основной надписи ГОСТ 2.104, форма 1 — 185×55 мм. */
const STAMP_W = 185;
const STAMP_H = 55;

function paperSize(format, orientation) {
  const [a, b] = PAPER_SIZES[format] || PAPER_SIZES.A3;
  return orientation === "landscape" ? { w: b, h: a } : { w: a, h: b };
}

function buildFormat(svgNS, parent, opts) {
  const { w, h } = paperSize(opts.format, opts.orientation);
  const ml = FRAME_MARGINS.left, mt = FRAME_MARGINS.top, mr = FRAME_MARGINS.right, mb = FRAME_MARGINS.bottom;

  // Фон листа
  const bg = document.createElementNS(svgNS, "rect");
  bg.setAttribute("x", 0); bg.setAttribute("y", 0);
  bg.setAttribute("width", w); bg.setAttribute("height", h);
  bg.setAttribute("class", "paper-bg");
  parent.appendChild(bg);

  // Внешняя тонкая граница листа (обрезной край)
  const outer = document.createElementNS(svgNS, "rect");
  outer.setAttribute("x", 0); outer.setAttribute("y", 0);
  outer.setAttribute("width", w); outer.setAttribute("height", h);
  outer.setAttribute("class", "gost-line");
  outer.setAttribute("stroke-width", "0.18");
  outer.setAttribute("fill", "none");
  parent.appendChild(outer);

  // Рамка чертежа
  if (opts.frame) {
    const frame = document.createElementNS(svgNS, "rect");
    frame.setAttribute("x", ml); frame.setAttribute("y", mt);
    frame.setAttribute("width", w - ml - mr); frame.setAttribute("height", h - mt - mb);
    frame.setAttribute("class", "gost-line");
    frame.setAttribute("stroke-width", "0.7");
    frame.setAttribute("fill", "none");
    parent.appendChild(frame);
  }

  // Штамп — размещаем в нижнем правом углу рабочей области рамки
  if (opts.stamp) {
    const sx = w - mr - STAMP_W;
    const sy = h - mb - STAMP_H;
    drawStamp(svgNS, parent, sx, sy, opts.title || {});
  }

  return {
    paper: { w, h },
    work: {
      x: ml, y: mt,
      w: w - ml - mr,
      h: h - mt - mb - (opts.stamp ? STAMP_H : 0)
    }
  };
}

/* =================================================================
 *  Штамп ГОСТ 2.104, форма 1 — упрощённая, аккуратная реализация.
 *  Габарит: 185 × 55 мм.
 *  Левая часть (65 мм) — таблица изменений (сверху) + графы должностей (снизу).
 *  Правая часть (120 мм) — наименование, обозначение, материал, литера/масса/масштаб, лист/листов, школа.
 * =================================================================*/
function drawStamp(ns, parent, x, y, t) {
  const g = document.createElementNS(ns, "g");
  g.setAttribute("transform", `translate(${x}, ${y})`);
  parent.appendChild(g);

  const W = STAMP_W, H = STAMP_H;
  const SPLIT = 65;           // граница левой/правой части
  const THICK = 0.7;          // толстые линии
  const THIN = 0.3;           // тонкие линии

  // Внешний контур и главная вертикаль
  rect(g, ns, 0, 0, W, H, THICK);
  line(g, ns, SPLIT, 0, SPLIT, H, THICK);

  /* ---------- ЛЕВАЯ ЧАСТЬ (0..65) ---------- */
  // Верхняя секция (0..30, таблица изменений): 5 колонок 7+10+23+15+10
  // Нижняя секция (30..55, должности 5 строк): 4 колонки 7+10+23+15+10 → объединяем первые две в "Должность" 17 мм, далее "Фамилия" 23, "Подпись" 15, "Дата" 10.
  const lcols = [0, 7, 17, 40, 55, 65];

  // Горизонтали слева, строки по 5 мм
  for (let i = 1; i < 11; i++) {
    const w = (i === 6) ? THICK : THIN;  // строка 6 разделяет блоки изменений и должностей
    line(g, ns, 0, i * 5, SPLIT, i * 5, w);
  }
  // Вертикали в верхней секции (изменения) — 4 разделителя
  for (let i = 1; i < 5; i++) {
    line(g, ns, lcols[i], 0, lcols[i], 30, THIN);
  }
  // Вертикали в нижней секции (должности): "Должность"(17)|"Фамилия"(23)|"Подпись"(15)|"Дата"(10)
  line(g, ns, 17, 30, 17, H, THIN);
  line(g, ns, 40, 30, 40, H, THIN);
  line(g, ns, 55, 30, 55, H, THIN);

  // Заголовки таблицы изменений (строка 1, сверху по серёдке каждой колонки)
  text(g, ns, lcols[0] + 3.5,  3.6, "Изм.",     2.0, "middle");
  text(g, ns, lcols[1] + 5,    3.6, "Лист",     2.0, "middle");
  text(g, ns, lcols[2] + 11.5, 3.6, "№ докум.", 2.0, "middle");
  text(g, ns, lcols[3] + 7.5,  3.6, "Подп.",    2.0, "middle");
  text(g, ns, lcols[4] + 5,    3.6, "Дата",     2.0, "middle");

  // Должности (5 строк по 5 мм, с y=30 до y=55)
  const roles = ["Разраб.", "Пров.", "Т.контр.", "Н.контр.", "Утв."];
  for (let i = 0; i < 5; i++) {
    text(g, ns, 1.5, 30 + i * 5 + 3.6, roles[i], 2.3, "start");
  }
  // ФИО разработчика и проверяющего — в колонке "Фамилия" (17..40)
  const fioMid = (17 + 40) / 2;
  if (t.author)  text(g, ns, fioMid, 30 + 0 * 5 + 3.6, fitText(t.author,  21), 2.3, "middle");
  if (t.checker) text(g, ns, fioMid, 30 + 1 * 5 + 3.6, fitText(t.checker, 21), 2.3, "middle");

  /* ---------- ПРАВАЯ ЧАСТЬ (65..185) ---------- */
  // Структура (сверху вниз):
  //   y 0..30 — НАИМЕНОВАНИЕ изделия (большая ячейка, шрифт 5 мм)
  //   y 30..40 — слева 70 мм: ОБОЗНАЧЕНИЕ (шифр), справа 50 мм: «Лит. | Масса | Масштаб» (метки 30..35, значения 35..40), доп. вертикали 20+20+10
  //   y 40..55 — слева 70 мм: МАТЕРИАЛ + УЧЕБНОЕ ЗАВЕДЕНИЕ, справа 50 мм: «Лист | Листов» (метки 40..45, значения 45..55), горизонтальная вертикаль по середине (25+25)
  const RX = SPLIT;             // 65
  const RW = W - RX;            // 120
  const colA = RX + 70;         // граница "70/50"

  // Главные горизонтали
  line(g, ns, RX, 30, W,    30, THICK);   // под наименованием
  line(g, ns, RX, 40, W,    40, THIN);    // между обозначением и материалом
  line(g, ns, RX, 35, colA + 50, 35, 0); // (зарезерв.)

  // Левая колонка правой части (70 мм)
  line(g, ns, colA, 30, colA, H, THIN);   // граница 70/50

  // Линии в левой подколонке (обозначение / материал / школа)
  line(g, ns, RX, 50, colA, 50, THIN);    // под материалом — отделяем школу

  // Правая 50 мм — таблица Лит/Масса/Масштаб + Лист/Листов
  const b1 = colA + 20;  // конец «Лит.»
  const b2 = colA + 40;  // конец «Масса»; конец «Лист» в нижнем ряду — colA+25
  line(g, ns, b1, 30, b1, 40, THIN);
  line(g, ns, b2, 30, b2, 40, THIN);
  line(g, ns, colA, 35, W, 35, THIN);    // подзаголовок (значения ниже)

  // Нижняя строка 40..55 справа — Лист/Листов: ширины 25/25
  const b3 = colA + 25;
  line(g, ns, b3, 40, b3, H, THIN);
  line(g, ns, colA, 45, W, 45, THIN);    // подписи 40..45, значения 45..55

  // НАИМЕНОВАНИЕ (центр большой ячейки)
  if (t.name) text(g, ns, RX + RW / 2, 20, fitText(t.name, 110), 5.0, "middle");

  // ОБОЗНАЧЕНИЕ (центр ячейки 65..135, y 30..40)
  if (t.designation) text(g, ns, RX + 35, 37, fitText(t.designation, 65), 4.5, "middle");

  // МАТЕРИАЛ (центр ячейки 65..135, y 40..50)
  if (t.material) text(g, ns, RX + 35, 47, fitText(t.material, 65), 3.2, "middle");

  // ШКОЛА / литера (узкая полоска внизу левой подколонки 65..135, y 50..55)
  if (t.school) text(g, ns, RX + 35, 53.5, fitText(t.school, 65), 2.8, "middle");

  // Подписи правой таблицы (Лит / Масса / Масштаб) — y 30..35
  text(g, ns, colA + 10, 33.5, "Лит.",   2.0, "middle", "#666");
  text(g, ns, colA + 30, 33.5, "Масса",  2.0, "middle", "#666");
  text(g, ns, colA + 45, 33.5, "Масштаб", 2.0, "middle", "#666");

  // Значения Лит / Масса / Масштаб — y 35..40
  text(g, ns, colA + 10, 38.5, "У", 3.0, "middle");      // литера: учебная
  if (t.mass)  text(g, ns, colA + 30, 38.5, fitText(t.mass, 18), 2.8, "middle");
  text(g, ns, colA + 45, 38.5, fitText(t.scale || "1:1", 9), 3.0, "middle");

  // Подписи Лист / Листов — y 40..45
  text(g, ns, colA + 12.5, 43.5, "Лист",   2.0, "middle", "#666");
  text(g, ns, colA + 37.5, 43.5, "Листов", 2.0, "middle", "#666");

  // Значения Лист / Листов — y 45..55
  text(g, ns, colA + 12.5, 51, "1", 3.5, "middle");
  text(g, ns, colA + 37.5, 51, "1", 3.5, "middle");
}

/* ===== утилиты ===== */
function rect(parent, ns, x, y, w, h, sw) {
  const r = document.createElementNS(ns, "rect");
  r.setAttribute("x", x); r.setAttribute("y", y);
  r.setAttribute("width", w); r.setAttribute("height", h);
  r.setAttribute("class", "gost-line");
  r.setAttribute("stroke-width", sw);
  r.setAttribute("fill", "none");
  parent.appendChild(r);
}
function line(parent, ns, x1, y1, x2, y2, sw) {
  if (sw === 0) return;
  const l = document.createElementNS(ns, "line");
  l.setAttribute("x1", x1); l.setAttribute("y1", y1);
  l.setAttribute("x2", x2); l.setAttribute("y2", y2);
  l.setAttribute("class", "gost-line");
  l.setAttribute("stroke-width", sw);
  parent.appendChild(l);
}
function text(parent, ns, x, y, str, size, anchor, color) {
  const t = document.createElementNS(ns, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("class", "gost-text");
  t.setAttribute("font-size", size);
  t.setAttribute("text-anchor", anchor || "start");
  if (color) t.setAttribute("fill", color);
  t.textContent = str;
  parent.appendChild(t);
}
/* Грубое обрезание длинного текста под ширину ячейки (по символам) */
function fitText(s, maxChars) {
  if (!s) return "";
  s = String(s);
  return s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s;
}
