/* Размеры бумаги по ГОСТ 2.301, мм. Сначала указана короткая сторона (книжная). */
const PAPER_SIZES = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189]
};

/* Поля рамки ГОСТ 2.301: слева 20 мм (для подшивки), остальные 5 мм. */
const FRAME_MARGINS = { left: 20, top: 5, right: 5, bottom: 5 };

/* Размеры основной надписи ГОСТ 2.104 (форма 1, конструкторская). */
const STAMP_W = 185;
const STAMP_H = 55;

/**
 * Вернёт {w,h} листа с учётом ориентации.
 */
function paperSize(format, orientation) {
  const [a, b] = PAPER_SIZES[format] || PAPER_SIZES.A3;
  return orientation === "landscape" ? { w: b, h: a } : { w: a, h: b };
}

/**
 * Построить SVG-разметку формата (рамка + штамп) и добавить в группу <g>.
 * Возвращает прямоугольник «рабочего поля» внутри рамки.
 */
function buildFormat(svgNS, parent, opts) {
  const { w, h } = paperSize(opts.format, opts.orientation);
  const ml = FRAME_MARGINS.left, mt = FRAME_MARGINS.top, mr = FRAME_MARGINS.right, mb = FRAME_MARGINS.bottom;

  // Фон листа
  const bg = document.createElementNS(svgNS, "rect");
  bg.setAttribute("x", 0); bg.setAttribute("y", 0);
  bg.setAttribute("width", w); bg.setAttribute("height", h);
  bg.setAttribute("class", "paper-bg");
  parent.appendChild(bg);

  // Внешняя тонкая граница листа
  const outer = document.createElementNS(svgNS, "rect");
  outer.setAttribute("x", 0); outer.setAttribute("y", 0);
  outer.setAttribute("width", w); outer.setAttribute("height", h);
  outer.setAttribute("class", "gost-line");
  outer.setAttribute("stroke-width", "0.18");
  outer.setAttribute("fill", "none");
  parent.appendChild(outer);

  // Внутренняя рамка чертежа
  if (opts.frame) {
    const frame = document.createElementNS(svgNS, "rect");
    frame.setAttribute("x", ml); frame.setAttribute("y", mt);
    frame.setAttribute("width", w - ml - mr); frame.setAttribute("height", h - mt - mb);
    frame.setAttribute("class", "gost-line");
    frame.setAttribute("stroke-width", "0.7");
    parent.appendChild(frame);
  }

  // Штамп
  if (opts.stamp) {
    drawStamp(svgNS, parent, w - mr - STAMP_W, h - mb - STAMP_H, opts.title || {});
  }

  return {
    paper: { w, h },
    work: { x: ml, y: mt, w: w - ml - mr, h: h - mt - mb - (opts.stamp ? STAMP_H : 0) }
  };
}

/**
 * Штамп ГОСТ 2.104 (упрощённая форма 1: 11 строк по 5 мм, левая графа имён, правая графа реквизитов).
 *  Сетка клеток:
 *  - столбцы (слева→направо): 7, 10, 23, 15, 10, 110 (итого 185 — реквизитная часть = 70 мм слева, графа 110 мм справа)
 *  - строки 5 мм; высота 55 мм.
 *  Реализуем визуально близко к ГОСТ.
 */
function drawStamp(svgNS, parent, x, y, t) {
  const g = document.createElementNS(svgNS, "g");
  g.setAttribute("transform", `translate(${x}, ${y})`);

  const W = STAMP_W, H = STAMP_H;

  // внешний прямоугольник
  rect(g, svgNS, 0, 0, W, H, 0.7);

  // вертикальное деление: левая часть (имена) 65 мм, правая (наименование) 120 мм
  // Сделаем по ГОСТ: 65 + 120 = 185
  const splitX = 65;
  line(g, svgNS, splitX, 0, splitX, H, 0.7);

  // Левая часть: 5 столбцов: 7, 10, 23, 15, 10  (итого 65)
  const colsL = [7, 10, 23, 15, 10];
  let cx = 0;
  const colXs = [0];
  colsL.forEach(c => { cx += c; colXs.push(cx); line(g, svgNS, cx, 0, cx, H, 0.35); });

  // Горизонтальные линии каждые 5 мм для левой части (11 строк)
  for (let i = 1; i < 11; i++) {
    line(g, svgNS, 0, i * 5, splitX, i * 5, 0.35);
  }

  // Заголовки строк левой части (графы №): Изм | Лист | № докум. | Подп. | Дата
  const headers = ["Изм.", "Лист", "№ докум.", "Подп.", "Дата"];
  for (let i = 0; i < 5; i++) {
    text(g, svgNS, colXs[i] + colsL[i] / 2, 5 - 1.3, headers[i], 2.5, "middle");
  }

  // Должностная графа: Разраб., Пров., Т.контр., (пусто), Н.контр., Утв.
  // По ГОСТ строки 6..11 (после трёх строк заголовков) — но мы используем строки 3..8
  const roles = [
    { row: 2, text: "Разраб." },
    { row: 3, text: "Пров." },
    { row: 4, text: "Т.контр." },
    { row: 6, text: "Н.контр." },
    { row: 7, text: "Утв." }
  ];
  roles.forEach(r => {
    text(g, svgNS, 1, r.row * 5 + 3.4, r.text, 2.5, "start");
  });

  // ФИО Разработал/Проверил в столбце 23 мм (3-й столбец)
  if (t.author) text(g, svgNS, colXs[2] + colsL[2] / 2, 2 * 5 + 3.4, t.author, 2.5, "middle");
  if (t.checker) text(g, svgNS, colXs[2] + colsL[2] / 2, 3 * 5 + 3.4, t.checker, 2.5, "middle");

  // Правая часть (наименование и реквизиты)
  // Деление правой части: верх 30 мм — наименование, ниже строки реквизитов
  // Подразделим: верхняя клетка 30×120 — наименование изделия
  // Ниже: масштаб | лист | листов на одной строке (15 мм)
  // Ниже: материал и т.п.
  const RX = splitX;
  // Горизонтали правой части
  line(g, svgNS, RX, 30, W, 30, 0.7);          // под наименованием
  line(g, svgNS, RX, 35, W, 35, 0.35);         // строка обозначения чертежа
  line(g, svgNS, RX, 40, W, 40, 0.35);
  line(g, svgNS, RX, 45, W, 45, 0.35);
  line(g, svgNS, RX, 50, W, 50, 0.35);

  // Вертикали правой части: после splitX делим на колонки
  // Колонки: 70 (обозначение/наименование) + 50 (литера/масса/масштаб/лист) = 120
  const c1 = splitX + 70;
  line(g, svgNS, c1, 30, c1, H, 0.35);

  // Подколонки в правой нижней: 50 мм поделим на Лит(20) Масса(20) Масштаб(10)
  // По ГОСТ: Лит(20) — три клетки литеры; Масса(20); Масштаб(10).
  // Упростим:
  const c2 = c1 + 20;       // конец «Лит.»
  const c3 = c2 + 20;       // конец «Масса»
  // c3 + 10 = W
  line(g, svgNS, c2, 30, c2, 45, 0.35);
  line(g, svgNS, c3, 30, c3, 45, 0.35);

  // Подписи маленькие
  text(g, svgNS, splitX + 1, 30 + 2.2, "Обозначение", 1.8, "start", "#777");
  text(g, svgNS, splitX + 1, 36.5, t.designation || "", 3.5, "start");

  // Литера / Масса / Масштаб подписи
  text(g, svgNS, splitX + 1, 35 + 2.2, "Лит.", 1.8, "start", "#777"); // не точно по ГОСТ, но информативно
  text(g, svgNS, c1 + 10, 30 + 3.5, "Лит.", 2.2, "middle", "#777");
  text(g, svgNS, c1 + 30, 30 + 3.5, "Масса", 2.2, "middle", "#777");
  text(g, svgNS, c1 + 45, 30 + 3.5, "Масштаб", 2.2, "middle", "#777");

  // значения
  text(g, svgNS, c1 + 30, 40, t.mass || "", 3, "middle");
  text(g, svgNS, c1 + 45, 40, t.scale || "1:1", 3.5, "middle");

  // Наименование (большая ячейка 30×70)
  text(g, svgNS, splitX + 35, 18, t.name || "", 5, "middle");

  // Лист / Листов
  text(g, svgNS, c1 + 10, 49, "Лист", 2.2, "middle", "#777");
  text(g, svgNS, c1 + 30, 49, "Листов", 2.2, "middle", "#777");
  text(g, svgNS, c1 + 10, 53, "1", 3, "middle");
  text(g, svgNS, c1 + 30, 53, "1", 3, "middle");

  // Учебное заведение / литера (под наименованием — правее)
  text(g, svgNS, c1 + 45, 53, t.school || "", 3, "middle");

  // Материал и т.п. можно положить в нижние строки наименования
  if (t.material) text(g, svgNS, splitX + 35, 27, t.material, 3, "middle");

  parent.appendChild(g);
}

/* Утилиты для штампа */
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
