// titleblock.js — форматы листов и основная надпись по ГОСТ 2.104 (упрощённо).

(function (global) {
  "use strict";

  const FORMATS = {
    A4P: { w: 210, h: 297 },
    A4L: { w: 297, h: 210 },
    A3P: { w: 297, h: 420 },
    A3L: { w: 420, h: 297 },
    A2L: { w: 594, h: 420 },
    A1L: { w: 841, h: 594 },
  };

  function getFormat(name) { return FORMATS[name] || FORMATS.A4L; }

  // Рисует рамку формата и основную надпись.
  // ctx — Canvas 2D context, уже трансформированный (1 ед = 1 мм).
  // fields — объект с полями надписи.
  function drawSheet(ctx, formatName, fields, opts) {
    const F = getFormat(formatName);
    ctx.save();
    ctx.strokeStyle = "#15161a";
    ctx.lineWidth = 0.7;
    ctx.fillStyle = "#15161a";
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // Внешняя граница листа (тонкая)
    ctx.lineWidth = 0.2;
    ctx.strokeRect(0, 0, F.w, F.h);

    // Рамка чертежа: слева 20 мм, остальные 5 мм
    const L = 20, R = 5, T = 5, B = 5;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(L, T, F.w - L - R, F.h - T - B);

    // Основная надпись: 185 × 55 мм в правом нижнем углу (полная)
    const TBW = 185, TBH = 55;
    const tbX = F.w - R - TBW;
    const tbY = F.h - B - TBH;
    drawTitleBlock(ctx, tbX, tbY, TBW, TBH, fields, opts);

    ctx.restore();
  }

  function drawTitleBlock(ctx, X, Y, W, H, f, opts) {
    f = f || {};
    ctx.save();
    ctx.translate(X, Y);
    ctx.lineWidth = 0.4;
    ctx.strokeStyle = "#15161a";
    ctx.fillStyle = "#15161a";

    // Внешний контур
    ctx.lineWidth = 0.7;
    ctx.strokeRect(0, 0, W, H);

    // Сетка штампа: упрощённая структура, близкая к ГОСТ 2.104 форма 1.
    // Координаты в мм относительно левого верхнего угла штампа.
    ctx.lineWidth = 0.3;

    // Левая часть — графы (1)…(9): 65 мм шириной, 8 строк по 5 мм + изм/лист/№док/подп/дата.
    const leftW = 65;
    const rightStart = leftW; // правее — графы основная (10..18) и обозначение.
    // 8 строк по 5 мм для нижних граф (всего 50 мм + 5 шапка над "Изм Лист..." уже не нужна — упрощаем)
    // Делим левую часть: верхняя 7 строк по 5 мм (изм/лист/№док/подп/дата стопкой) — упростим, оставим горизонтальные линии каждые 5 мм по всей высоте.
    for (let i = 1; i < H/5; i++) {
      line(0, i*5, leftW, i*5);
    }

    // Колонки в левой части: 7, 10, 23, 15, 10 (по ГОСТ для формы 1)
    const cols = [7, 10, 23, 15, 10];
    let cx = 0;
    for (let i = 0; i < cols.length - 1; i++) {
      cx += cols[i];
      line(cx, 0, cx, H);
    }

    // Правая часть: разделим на две колонки — обозначение (большое поле) сверху и подписи под ним.
    // Делаем: вся правая часть 185-65=120 мм.
    // Верх (35 мм): обозначение, название и т.п.
    // Низ (20 мм): материал, масштаб, лист, листов.
    line(leftW, 25, W, 25);                     // горизонтальная между верхом и низом
    line(leftW, 40, W, 40);                     // выделим под "лист" 15
    // Колонки в правой части
    line(leftW + 70, 25, leftW + 70, H);        // правое поле: ~50 мм (литера, масса, масштаб, лист, листов)
    line(leftW + 70 + 15, 40, leftW + 70 + 15, H);
    line(leftW + 70 + 30, 40, leftW + 70 + 30, H);
    // Внутри блока литеры — три ячейки по 5 мм шириной
    line(leftW + 70 + 5, 25, leftW + 70 + 5, 40);
    line(leftW + 70 + 10, 25, leftW + 70 + 10, 40);

    // Подписи в левой нижней части — это просто графы для печати; в наше упрощение
    // оставим следующие поля сверху вниз:
    const leftLabels = [
      "Изм.","Лист","№ докум.","Подп.","Дата"
    ];
    // Подпишем заголовки колонок чуть сверху (внутри 1-й строки)
    text("Изм.",  3.5, 2.5, "left", "middle", 2.0);
    text("Лист",  10, 2.5, "center", "middle", 2.0);
    text("№ док.",27, 2.5, "center", "middle", 2.0);
    text("Подп.", 50, 2.5, "center", "middle", 2.0);
    text("Дата",  60, 2.5, "center", "middle", 2.0);

    // Левая колонка надписей в нижних строках
    const roles = [
      { y: 35, label: "Разраб.", who: f.author || "" },
      { y: 30, label: "Пров.",    who: f.checker || "" },
      { y: 25, label: "Т. контр.", who: "" },
      { y: 15, label: "Н. контр.", who: "" },
      { y: 10, label: "Утв.",     who: f.approver || "" },
    ];
    // Поправим: размечу строки графов 5..1 по ГОСТ — снизу вверх
    // Строки от верха штампа (мм): графа 14 — 5, 13 — 10, 12 — 15, 11 — 20, ...
    // Здесь упростим: нижняя половина — 5 строк по 5 мм (всего 25), верхняя половина — 6 строк по 5 мм.
    // Используем правый блок для штампа должностей:
    const dutyRows = [
      { yMid: 27.5, label: "Разраб." },
      { yMid: 32.5, label: "Пров." },
      { yMid: 37.5, label: "Т.контр." },
      { yMid: 47.5, label: "Н.контр." },
      { yMid: 52.5, label: "Утв." },
    ];
    for (const r of dutyRows) {
      text(r.label, 3, r.yMid, "left", "middle", 2.5);
    }
    // Имена в графе "Фамилия" (колонка после 17мм от начала)
    if (f.author)   text(f.author,   18, 27.5, "left", "middle", 2.6);
    if (f.checker)  text(f.checker,  18, 32.5, "left", "middle", 2.6);
    if (f.approver) text(f.approver, 18, 52.5, "left", "middle", 2.6);
    // Подпись/дата — оставим пустыми

    // Дата
    if (f.date) {
      text(f.date, 56, 27.5, "center", "middle", 2.6);
      text(f.date, 56, 32.5, "center", "middle", 2.6);
    }

    // Правая часть — обозначение и название
    if (f.code)  text(f.code,  leftW + 35, 12, "center", "middle", 5.5);
    if (f.title) text(f.title, leftW + 35, 32, "center", "middle", 5.5);
    if (f.material) text(f.material, leftW + 35, 50, "center", "middle", 3.0);

    // Литера / Масса / Масштаб
    text("Лит.",  leftW + 70 + 2.5, 27.5, "center", "middle", 2.2);
    text("Масса", leftW + 70 + 7.5, 27.5, "center", "middle", 2.2);
    text("Масштаб", leftW + 70 + 12.5, 27.5, "center", "middle", 2.2);
    if (f.letter)  text(f.letter,  leftW + 70 + 2.5, 35, "center", "middle", 3.5);
    if (f.mass)    text(f.mass,    leftW + 70 + 7.5, 35, "center", "middle", 3.0);
    if (f.scale)   text(f.scale,   leftW + 70 + 12.5, 35, "center", "middle", 3.0);

    // Лист / Листов
    text("Лист", leftW + 70 + 22.5, 42.5, "center", "middle", 2.2);
    text("Листов", leftW + 70 + 37.5, 42.5, "center", "middle", 2.2);
    if (f.sheet)  text(f.sheet,  leftW + 70 + 22.5, 47.5, "center", "middle", 3.0);
    if (f.sheets) text(f.sheets, leftW + 70 + 37.5, 47.5, "center", "middle", 3.0);

    // Школа/группа — крупно внизу правой части
    if (f.org) text(f.org, leftW + 100, 50, "center", "middle", 3.0);

    ctx.restore();

    function line(x1,y1,x2,y2){ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
    function text(s, x, y, align, baseline, size) {
      if (!s) return;
      ctx.save();
      const px = size * (opts && opts.mmToPx ? opts.mmToPx : 1);
      // Используем размер шрифта в мм относительно текущего масштаба ctx.
      ctx.font = `${size}px "Times New Roman","Liberation Serif",serif`;
      ctx.textAlign = align; ctx.textBaseline = baseline;
      ctx.fillText(String(s), x, y);
      ctx.restore();
    }
  }

  // Возвращает рабочую область внутри рамки: где AI может рисовать
  // (origin внутри рамки, без штампа).
  function workArea(formatName) {
    const F = getFormat(formatName);
    const L = 20, R = 5, T = 5, B = 5;
    const TBW = 185, TBH = 55;
    return {
      x: L, y: T,
      w: F.w - L - R,
      h: F.h - T - B - TBH - 2,   // оставляем 2 мм над штампом
      sheetW: F.w, sheetH: F.h,
      tb: { x: F.w - R - TBW, y: F.h - B - TBH, w: TBW, h: TBH },
    };
  }

  global.Sheet = { FORMATS, getFormat, drawSheet, workArea };
})(window);
