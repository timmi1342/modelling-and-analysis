// Визуализация: созвездие, векторная и глазковая диаграммы, спектр, временные графики (раздел 2.3 ТЗ)

export function palette(el) {
  const s = getComputedStyle(el.isConnected ? el : document.documentElement);
  const v = (name, fallback) => (s.getPropertyValue(name) || fallback).trim();
  return {
    panel: v('--plot-panel', '#ffffff'),
    grid: v('--plot-grid', '#e2e8f0'),
    axis: v('--plot-axis', '#94a3b8'),
    text: v('--plot-text', '#1e293b'),
    muted: v('--plot-muted', '#64748b'),
    trace: v('--plot-trace', '#2563eb'),
    trace2: v('--plot-trace2', '#ea580c'),
    ref: v('--plot-ref', '#dc2626'),
    mask: v('--plot-mask', 'rgba(37,99,235,0.10)'),
    maskAdj: v('--plot-mask-adj', 'rgba(220,38,38,0.10)'),
  };
}

function prepare(canvas) {
  const inDoc = canvas.isConnected;
  const dpr = inDoc ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const rect = inDoc
    ? canvas.getBoundingClientRect()
    : { width: +canvas.dataset.w || 1000, height: +canvas.dataset.h || 400 };

  const w = Math.max(Math.round(rect.width), 220);
  const h = Math.max(Math.round(rect.height), 170);

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, pal: palette(canvas) };
}

function niceTicks(min, max, target = 5) {
  const span = max - min;
  if (!(span > 0)) return [min];

  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;

  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return out;
}

function makeAxes(ctx, w, h, pal, cfg) {
  const pad = Object.assign({ l: 58, r: 14, t: 28, b: 38 }, cfg.pad);
  let box = { x0: pad.l, y0: pad.t, x1: w - pad.r, y1: h - pad.b };

  if (cfg.square) {
    const side = Math.min(box.x1 - box.x0, box.y1 - box.y0);
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    box = { x0: cx - side / 2, x1: cx + side / 2, y0: cy - side / 2, y1: cy + side / 2 };
  }

  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;

  ctx.fillStyle = pal.panel;
  ctx.fillRect(0, 0, w, h);

  const X = (v) => box.x0 + ((v - cfg.xMin) / (cfg.xMax - cfg.xMin)) * bw;
  const Y = (v) => box.y1 - ((v - cfg.yMin) / (cfg.yMax - cfg.yMin)) * bh;

  const xt = cfg.xTicks || niceTicks(cfg.xMin, cfg.xMax, cfg.xTickCount || 5);
  const yt = cfg.yTicks || niceTicks(cfg.yMin, cfg.yMax, cfg.yTickCount || 5);

  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.grid;
  ctx.beginPath();
  for (const t of xt) {
    const x = Math.round(X(t)) + 0.5;
    ctx.moveTo(x, box.y0);
    ctx.lineTo(x, box.y1);
  }
  for (const t of yt) {
    const y = Math.round(Y(t)) + 0.5;
    ctx.moveTo(box.x0, y);
    ctx.lineTo(box.x1, y);
  }
  ctx.stroke();

  if (cfg.zeroAxes) {
    ctx.strokeStyle = pal.axis;
    ctx.beginPath();
    if (cfg.xMin < 0 && cfg.xMax > 0) {
      const x = Math.round(X(0)) + 0.5;
      ctx.moveTo(x, box.y0);
      ctx.lineTo(x, box.y1);
    }
    if (cfg.yMin < 0 && cfg.yMax > 0) {
      const y = Math.round(Y(0)) + 0.5;
      ctx.moveTo(box.x0, y);
      ctx.lineTo(box.x1, y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = pal.axis;
  ctx.strokeRect(box.x0 + 0.5, box.y0 + 0.5, bw, bh);

  const fmtX = cfg.xFormat || ((v) => String(+v.toFixed(3)));
  const fmtY = cfg.yFormat || ((v) => String(+v.toFixed(3)));

  ctx.fillStyle = pal.muted;
  ctx.font = '11px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of xt) ctx.fillText(fmtX(t), X(t), box.y1 + 7);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yt) ctx.fillText(fmtY(t), box.x0 - 8, Y(t));

  if (cfg.title) {
    ctx.fillStyle = pal.text;
    ctx.font = '600 12px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(cfg.title, pad.l, 8);
  }

  ctx.fillStyle = pal.muted;
  ctx.font = '11px system-ui, "Segoe UI", sans-serif';
  if (cfg.xLabel) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(cfg.xLabel, box.x1, h - 3);
  }
  if (cfg.yLabel) {
    ctx.save();
    ctx.translate(13, (box.y0 + box.y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(cfg.yLabel, 0, 0);
    ctx.restore();
  }

  const clip = () => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x0, box.y0, bw, bh);
    ctx.clip();
  };

  return { box, X, Y, clip, unclip: () => ctx.restore() };
}

function legend(ctx, box, pal, items) {
  ctx.font = '11px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let x = box.x0 + 8;
  const y = box.y0 + 12;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(x, y - 4, 16, 3);
    ctx.fillStyle = pal.muted;
    ctx.fillText(it.label, x + 22, y);
    x += 30 + ctx.measureText(it.label).width;
  }
}

function polyline(ctx, xs, ys, X, Y, color, width, alpha = 1) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const px = X(xs[i]);
    const py = Y(ys[i]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawConstellation(canvas, data) {
  const { ctx, w, h, pal } = prepare(canvas);

  let lim = 0;
  for (let i = 0; i < data.I.length; i++) {
    lim = Math.max(lim, Math.abs(data.I[i]), Math.abs(data.Q[i]));
  }
  for (let i = 0; i < data.refI.length; i++) {
    lim = Math.max(lim, Math.abs(data.refI[i]), Math.abs(data.refQ[i]));
  }
  lim = Math.max(lim * 1.12, 0.5);

  const ax = makeAxes(ctx, w, h, pal, {
    xMin: -lim, xMax: lim, yMin: -lim, yMax: lim,
    square: true, zeroAxes: true,
    title: data.title || 'Диаграмма созвездия',
    xLabel: 'I, отн. ед.', yLabel: 'Q, отн. ед.',
    xFormat: (v) => v.toFixed(1), yFormat: (v) => v.toFixed(1),
  });

  ax.clip();

  const n = data.I.length;
  const size = n > 6000 ? 1 : n > 2000 ? 1.6 : 2.2;
  ctx.fillStyle = pal.trace;
  ctx.globalAlpha = n > 4000 ? 0.35 : n > 1200 ? 0.55 : 0.8;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(ax.X(data.I[i]), ax.Y(data.Q[i]), size, 0, 6.2832);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = pal.ref;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < data.refI.length; i++) {
    const x = ax.X(data.refI[i]);
    const y = ax.Y(data.refQ[i]);
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
  }

  ax.unclip();
  legend(ctx, ax.box, pal, [
    { label: 'принятые символы', color: pal.trace },
    { label: 'опорное созвездие', color: pal.ref },
  ]);
}

export function drawVector(canvas, data) {
  const { ctx, w, h, pal } = prepare(canvas);

  const step = Math.max(1, Math.ceil(data.I.length / 4000));
  let lim = 0;
  for (let i = 0; i < data.I.length; i += step) {
    lim = Math.max(lim, Math.abs(data.I[i]), Math.abs(data.Q[i]));
  }
  lim = Math.max(lim * 1.1, 0.5);

  const ax = makeAxes(ctx, w, h, pal, {
    xMin: -lim, xMax: lim, yMin: -lim, yMax: lim,
    square: true, zeroAxes: true,
    title: 'Векторная диаграмма',
    xLabel: 'I, отн. ед.', yLabel: 'Q, отн. ед.',
    xFormat: (v) => v.toFixed(1), yFormat: (v) => v.toFixed(1),
  });

  ax.clip();

  ctx.strokeStyle = pal.trace;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0, k = 0; i < data.I.length; i += step, k++) {
    const px = ax.X(data.I[i]);
    const py = ax.Y(data.Q[i]);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (data.symI) {
    ctx.fillStyle = pal.ref;
    const count = Math.min(data.symI.length, 400);
    for (let i = 0; i < count; i++) {
      ctx.beginPath();
      ctx.arc(ax.X(data.symI[i]), ax.Y(data.symQ[i]), 1.8, 0, 6.2832);
      ctx.fill();
    }
  }

  ax.unclip();
}

export function drawEye(canvas, data) {
  const { ctx, w, h, pal } = prepare(canvas);

  let lim = 0;
  for (const tr of data.tracesI) {
    for (let i = 0; i < tr.length; i++) lim = Math.max(lim, Math.abs(tr[i]));
  }
  lim = Math.max(lim * 1.12, 0.5);

  const ax = makeAxes(ctx, w, h, pal, {
    xMin: -1, xMax: 1, yMin: -lim, yMax: lim,
    zeroAxes: true,
    title: 'Глазковая диаграмма',
    xLabel: 'время, символьные интервалы', yLabel: 'амплитуда, отн. ед.',
    xTicks: [-1, -0.5, 0, 0.5, 1],
    xFormat: (v) => v.toFixed(1), yFormat: (v) => v.toFixed(1),
  });

  ax.clip();

  const span = data.span;
  const xs = new Float64Array(span);
  for (let i = 0; i < span; i++) xs[i] = -1 + (2 * i) / (span - 1);

  const alpha = Math.min(0.5, 12 / Math.max(data.tracesI.length, 1));
  for (const tr of data.tracesI) {
    if (tr.length < span) continue;
    polyline(ctx, xs, tr, ax.X, ax.Y, pal.trace, 1, alpha);
  }
  if (data.showQ) {
    for (const tr of data.tracesQ) {
      if (tr.length < span) continue;
      polyline(ctx, xs, tr, ax.X, ax.Y, pal.trace2, 1, alpha);
    }
  }

  ax.unclip();
  legend(ctx, ax.box, pal, data.showQ
    ? [{ label: 'I(t)', color: pal.trace }, { label: 'Q(t)', color: pal.trace2 }]
    : [{ label: 'I(t)', color: pal.trace }]);
}

export function drawSpectrum(canvas, data) {
  const { ctx, w, h, pal } = prepare(canvas);

  const spec = data.spec;
  let peak = -Infinity;
  for (let i = 0; i < spec.psdDb.length; i++) peak = Math.max(peak, spec.psdDb[i]);

  const fMax = spec.freq[spec.freq.length - 1] / 1e6;
  const fMin = spec.freq[0] / 1e6;

  const ax = makeAxes(ctx, w, h, pal, {
    xMin: fMin, xMax: fMax, yMin: -90, yMax: 6,
    title: 'Спектр сигнала',
    xLabel: data.carrierHz
      ? `отстройка от несущей ${(data.carrierHz / 1e6).toFixed(1)} МГц, МГц`
      : 'частота, МГц',
    yLabel: 'уровень, дБ отн. пика',
    xFormat: (v) => v.toFixed(1),
    yFormat: (v) => v.toFixed(0),
  });

  ax.clip();

  if (data.chanBw) {
    const half = data.chanBw / 2e6;
    const sp = data.chanSpacing / 1e6;

    ctx.fillStyle = pal.mask;
    ctx.fillRect(ax.X(-half), ax.box.y0, ax.X(half) - ax.X(-half), ax.box.y1 - ax.box.y0);

    ctx.fillStyle = pal.maskAdj;
    for (const c of [-sp, sp]) {
      ctx.fillRect(ax.X(c - half), ax.box.y0,
        ax.X(c + half) - ax.X(c - half), ax.box.y1 - ax.box.y0);
    }
  }

  const xs = new Float64Array(spec.freq.length);
  const ys = new Float64Array(spec.psdDb.length);
  for (let i = 0; i < xs.length; i++) {
    xs[i] = spec.freq[i] / 1e6;
    ys[i] = spec.psdDb[i] - peak;
  }
  polyline(ctx, xs, ys, ax.X, ax.Y, pal.trace, 1.2);

  ax.unclip();
  if (data.chanBw) {
    legend(ctx, ax.box, pal, [
      { label: 'основной канал', color: pal.mask.replace(/[\d.]+\)$/, '0.6)') },
      { label: 'соседние каналы', color: pal.maskAdj.replace(/[\d.]+\)$/, '0.6)') },
    ]);
  }
}

export function drawTime(canvas, data) {
  const { ctx, w, h, pal } = prepare(canvas);

  const sps = data.sps;
  const count = Math.min(data.nSymbols * sps, data.I.length);

  let lim = 0;
  for (let i = 0; i < count; i++) {
    lim = Math.max(lim, Math.abs(data.I[i]), Math.abs(data.Q[i]));
  }
  lim = Math.max(lim * 1.12, 0.5);

  const ax = makeAxes(ctx, w, h, pal, {
    xMin: 0, xMax: count / sps, yMin: -lim, yMax: lim,
    zeroAxes: true,
    title: 'Временные диаграммы I(t) и Q(t)',
    xLabel: 'время, символьные интервалы', yLabel: 'амплитуда, отн. ед.',
    xFormat: (v) => v.toFixed(0), yFormat: (v) => v.toFixed(1),
  });

  ax.clip();

  const xs = new Float64Array(count);
  for (let i = 0; i < count; i++) xs[i] = i / sps;

  polyline(ctx, xs, data.I.subarray(0, count), ax.X, ax.Y, pal.trace, 1.3);
  polyline(ctx, xs, data.Q.subarray(0, count), ax.X, ax.Y, pal.trace2, 1.3);

  ctx.fillStyle = pal.ref;
  for (let s = 0; s <= count / sps; s++) {
    const k = s * sps;
    if (k >= count) break;
    ctx.beginPath();
    ctx.arc(ax.X(s), ax.Y(data.I[k]), 2, 0, 6.2832);
    ctx.fill();
  }

  ax.unclip();
  legend(ctx, ax.box, pal, [
    { label: 'I(t)', color: pal.trace },
    { label: 'Q(t)', color: pal.trace2 },
    { label: 'точки отсчёта', color: pal.ref },
  ]);
}

export function drawPaCurve(canvas, data) {
  const { ctx, w, h, pal } = prepare(canvas);

  let maxPm = 0;
  for (let i = 0; i < data.amPm.length; i++) maxPm = Math.max(maxPm, data.amPm[i]);
  const scale = maxPm > 0.5 ? 1 / maxPm : 0;

  const ax = makeAxes(ctx, w, h, pal, {
    xMin: 0, xMax: 2, yMin: 0, yMax: 1.15,
    title: 'Характеристики усилителя AM/AM и AM/PM',
    xLabel: 'входная амплитуда, отн. ед. насыщения',
    yLabel: 'нормированный отклик',
    xFormat: (v) => v.toFixed(1), yFormat: (v) => v.toFixed(1),
  });

  ax.clip();
  polyline(ctx, data.r, data.amAm, ax.X, ax.Y, pal.trace, 1.6);

  if (scale > 0) {
    const scaled = new Float64Array(data.amPm.length);
    for (let i = 0; i < scaled.length; i++) scaled[i] = data.amPm[i] * scale;
    polyline(ctx, data.r, scaled, ax.X, ax.Y, pal.trace2, 1.6);
  }

  if (data.backoffDb !== undefined) {
    const op = Math.pow(10, -data.backoffDb / 20);
    ctx.strokeStyle = pal.ref;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ax.X(op), ax.box.y0);
    ctx.lineTo(ax.X(op), ax.box.y1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ax.unclip();
  legend(ctx, ax.box, pal, [
    { label: 'AM/AM', color: pal.trace },
    { label: scale > 0 ? `AM/PM (макс. ${maxPm.toFixed(0)}°)` : 'AM/PM отсутствует', color: pal.trace2 },
    { label: 'рабочая точка', color: pal.ref },
  ]);
}
