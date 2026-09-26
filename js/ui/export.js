// Экспорт результатов: PNG, PDF, CSV, WAV, отчёт, конфигурация (раздел 2.5 ТЗ)

import { palette } from './plots.js';

const DPI = 150;

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function dateText() {
  return new Date().toLocaleString('ru-RU');
}

function blobFrom(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function savePng(canvas, name) {
  const blob = await blobFrom(canvas, 'image/png');
  download(blob, `${name}_${stamp()}.png`);
}

function latin1(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

async function canvasJpeg(canvas, quality = 0.93) {
  const blob = await blobFrom(canvas, 'image/jpeg', quality);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function makePdf(canvases) {
  const images = [];
  for (const c of canvases) {
    images.push({ data: await canvasJpeg(c), w: c.width, h: c.height });
  }

  const chunks = [];
  const offsets = [];
  let pos = 0;

  const write = (d) => {
    const u8 = typeof d === 'string' ? latin1(d) : d;
    chunks.push(u8);
    pos += u8.length;
  };
  const obj = (num, body) => {
    offsets[num] = pos;
    write(`${num} 0 obj\n${body}\nendobj\n`);
  };

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const n = images.length;
  const pageIds = [];
  for (let i = 0; i < n; i++) pageIds.push(3 + i * 3);

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`);

  for (let i = 0; i < n; i++) {
    const img = images[i];
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imgId = pageId + 2;

    const W = ((img.w * 72) / DPI).toFixed(2);
    const H = ((img.h * 72) / DPI).toFixed(2);

    obj(pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);

    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`;
    obj(contentId, `<< /Length ${content.length} >>\nstream\n${content}endstream`);

    offsets[imgId] = pos;
    write(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${img.data.length} >>\nstream\n`);
    write(img.data);
    write('\nendstream\nendobj\n');
  }

  const xrefPos = pos;
  const maxObj = 2 + n * 3;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxObj; i++) {
    xref += String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
  }
  write(xref);
  write(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.dataset.w = String(w);
  c.dataset.h = String(h);
  return c;
}

export function renderPlotsPages(drawTasks) {
  const pageW = 1754;
  const pageH = 1240;
  const plotW = 1654;
  const plotH = 545;
  const pages = [];

  for (let i = 0; i < drawTasks.length; i += 2) {
    const page = document.createElement('canvas');
    page.width = pageW;
    page.height = pageH;
    const ctx = page.getContext('2d');
    const pal = palette(page);

    ctx.fillStyle = pal.panel;
    ctx.fillRect(0, 0, pageW, pageH);

    for (let k = 0; k < 2; k++) {
      const task = drawTasks[i + k];
      if (!task) break;
      const c = offscreen(plotW, plotH);
      task(c);
      ctx.drawImage(c, 50, 45 + k * 600, plotW, plotH);
    }

    ctx.fillStyle = pal.muted;
    ctx.font = '20px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`VSG Simulator — ${dateText()}`, pageW - 50, pageH - 22);
    pages.push(page);
  }
  return pages;
}

export function renderReportPage(info) {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d');
  const pal = palette(canvas);

  const M = 90;
  let y = M;

  ctx.fillStyle = pal.panel;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = pal.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = '700 34px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Отчёт о параметрах и результатах измерений', M, y);
  y += 34;

  ctx.font = '19px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = pal.muted;
  ctx.fillText(`Программный комплекс «VSG Simulator». Дата формирования: ${dateText()}`, M, y);
  y += 46;

  const section = (title) => {
    ctx.fillStyle = pal.text;
    ctx.font = '700 23px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(title, M, y);
    y += 12;
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(canvas.width - M, y);
    ctx.stroke();
    y += 30;
  };

  const row = (left, right, bold = false) => {
    ctx.font = `${bold ? '600 ' : ''}19px system-ui, "Segoe UI", sans-serif`;
    ctx.fillStyle = pal.muted;
    ctx.textAlign = 'left';
    ctx.fillText(left, M, y);
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'right';
    ctx.fillText(right, canvas.width - M, y);
    y += 30;
  };

  section('1. Параметры сигнала');
  for (const [k, v] of info.signalRows) row(k, v);
  y += 16;

  section('2. Модель искажений');
  for (const [k, v] of info.impairRows) row(k, v);
  y += 16;

  section('3. Результаты измерений');

  ctx.font = '600 17px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = pal.muted;
  ctx.textAlign = 'left';
  ctx.fillText('Параметр', M, y);
  ctx.fillText('Значение', M + 470, y);
  ctx.fillText('Норма', M + 690, y);
  ctx.fillText('Заключение', M + 880, y);
  y += 26;

  for (const r of info.resultRows) {
    ctx.font = '19px system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'left';
    ctx.fillText(r.name, M, y);
    ctx.fillText(`${r.value.toFixed(2)} ${r.unit}`, M + 470, y);
    ctx.fillStyle = pal.muted;
    ctx.fillText(`${r.cmp} ${r.limit}`, M + 690, y);
    ctx.fillStyle = r.pass ? pal.trace : pal.ref;
    ctx.font = '700 19px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(r.pass ? 'годен' : 'не годен', M + 880, y);
    y += 29;

    if (r.extra) {
      ctx.font = '16px system-ui, "Segoe UI", sans-serif';
      ctx.fillStyle = pal.muted;
      ctx.fillText(r.extra, M + 16, y);
      y += 26;
    }
  }

  y += 22;
  ctx.font = '700 23px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = info.verdict ? pal.trace : pal.ref;
  ctx.textAlign = 'left';
  ctx.fillText(
    info.verdict
      ? 'Итоговое заключение: сигнал соответствует заданным порогам'
      : 'Итоговое заключение: сигнал не соответствует заданным порогам',
    M, y);
  y += 44;

  if (info.notes?.length) {
    section('4. Примечания');
    ctx.font = '17px system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = pal.muted;
    ctx.textAlign = 'left';
    for (const note of info.notes) {
      ctx.fillText(note, M, y);
      y += 25;
    }
  }

  return canvas;
}

export function makeCsv(sig, p) {
  const lines = [
    '# VSG Simulator — экспорт квадратурных составляющих сигнала',
    `# Дата: ${dateText()}`,
    `# Схема модуляции: ${p.modulation}`,
    `# Несущая частота, Гц: ${p.carrierHz}`,
    `# Символьная скорость, Гц: ${p.symbolRate}`,
    `# Отсчётов на символ: ${p.sps}`,
    `# Частота дискретизации, Гц: ${p.fs}`,
    `# Коэффициент сглаживания RRC: ${p.alpha}`,
    `# Число символов: ${p.nSymbols}`,
    'n,t_s,I,Q',
  ];

  const dt = 1 / p.fs;
  for (let i = 0; i < sig.I.length; i++) {
    lines.push(`${i},${(i * dt).toExponential(9)},${sig.I[i].toFixed(6)},${sig.Q[i].toFixed(6)}`);
  }
  return new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
}

export function makeWav(I, Q, fs) {
  const n = I.length;

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(I[i]), Math.abs(Q[i]));
  const g = peak > 0 ? (0.9 * 32767) / peak : 0;

  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const ascii = (off, s) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  const clamp = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));

  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, Math.round(fs), true);
  dv.setUint32(28, Math.round(fs) * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, n * 4, true);

  let o = 44;
  for (let i = 0; i < n; i++) {
    dv.setInt16(o, clamp(I[i] * g), true);
    o += 2;
    dv.setInt16(o, clamp(Q[i] * g), true);
    o += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function saveConfig(p) {
  const copy = structuredClone(p);
  delete copy.fs;
  delete copy.chanBw;
  delete copy.chanSpacing;

  const blob = new Blob([JSON.stringify({ app: 'VSG Simulator', version: 1, params: copy }, null, 2)],
    { type: 'application/json' });
  download(blob, `vsg_config_${stamp()}.json`);
}

export async function loadConfig(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.params) {
    throw new Error('Файл не содержит конфигурацию программы');
  }
  return data.params;
}
