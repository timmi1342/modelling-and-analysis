// Управление: связывание параметров с модулями, пересчёт, отрисовка, экспорт (разделы 2.6, 4 ТЗ)

import { defaultParams, derive, validate, applyPreset, PRESETS } from './params.js';
import { PRBS_TYPES } from './dsp/source.js';
import { MODULATIONS, constellation } from './dsp/mapper.js';
import { buildSignal, eyeTraces, papr } from './dsp/chain.js';
import { measureAll, verdictTable } from './dsp/measure.js';
import { paCurve } from './dsp/impairments.js';
import * as plots from './ui/plots.js';
import * as out from './ui/export.js';

const PLOTS = [
  { key: 'constellation', label: 'Созвездие', canvas: 'cvConstellation', file: 'sozvezdie' },
  { key: 'spectrum', label: 'Спектр', canvas: 'cvSpectrum', file: 'spektr' },
  { key: 'vector', label: 'Векторная диаграмма', canvas: 'cvVector', file: 'vektornaya' },
  { key: 'eye', label: 'Глазковая диаграмма', canvas: 'cvEye', file: 'glazkovaya' },
  { key: 'time', label: 'I(t) и Q(t)', canvas: 'cvTime', file: 'vremennye' },
  { key: 'pa', label: 'Характеристики УМ', canvas: 'cvPa', file: 'usilitel' },
];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let state = defaultParams();
let visible = new Set(PLOTS.map((p) => p.key));
let last = null;
let timer = 0;
let autoRun = true;
let eyeQ = false;
let freqScale = 1e6;

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const leaf = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[leaf] = value;
}

function mergeParams(saved) {
  const base = defaultParams();
  for (const key of Object.keys(base)) {
    if (saved?.[key] === undefined) continue;
    if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      base[key] = { ...base[key], ...saved[key] };
    } else {
      base[key] = saved[key];
    }
  }
  return base;
}

function persist() {
  try {
    localStorage.setItem('vsg.state', JSON.stringify({
      params: state,
      visible: Array.from(visible),
      autoRun, eyeQ, freqScale,
    }));
  } catch (e) { /* хранилище может быть недоступно */ }
}

function restore() {
  try {
    const raw = localStorage.getItem('vsg.state');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.params) state = mergeParams(data.params);
    if (Array.isArray(data.visible) && data.visible.length) visible = new Set(data.visible);
    if (typeof data.autoRun === 'boolean') autoRun = data.autoRun;
    if (typeof data.eyeQ === 'boolean') eyeQ = data.eyeQ;
    if (data.freqScale) freqScale = Number(data.freqScale);
  } catch (e) { /* повреждённые данные игнорируются */ }
}

function syncInputs(except) {
  for (const el of $$('[data-bind]')) {
    if (el === except) continue;
    const value = getPath(state, el.dataset.bind);
    const kind = el.dataset.kind;

    if (kind === 'bool') {
      el.checked = !!value;
    } else if (kind === 'string') {
      el.value = value ?? '';
    } else {
      const scale = el.dataset.scale ? Number(el.dataset.scale) : 1;
      const scaled = value / scale;
      el.value = Number.isFinite(scaled) ? String(+scaled.toFixed(6)) : '';
    }
  }
}

function updateVisibility() {
  for (const el of $$('[data-when]')) {
    el.style.display = el.dataset.when === state.source ? '' : 'none';
  }
  const paSharp = $('#paSharp')?.closest('.field');
  if (paSharp) paSharp.style.display = state.pa.model === 'rapp' ? '' : 'none';
}

function showErrors(errors) {
  for (const el of $$('[data-bind]')) {
    const field = el.closest('.field');
    if (!field) continue;
    field.classList.remove('invalid');
    const box = field.querySelector('.error');
    if (box) box.textContent = '';
  }

  const keys = Object.keys(errors);
  for (const key of keys) {
    for (const el of $$(`[data-bind="${key}"]`)) {
      const field = el.closest('.field');
      if (!field) continue;
      field.classList.add('invalid');
      const box = field.querySelector('.error');
      if (box) box.textContent = errors[key];
    }
  }

  const banner = $('#banner');
  if (keys.length) {
    banner.hidden = false;
    banner.textContent = `Расчёт заблокирован, ошибок: ${keys.length}. ${Object.values(errors)[0]}`;
  } else {
    banner.hidden = true;
  }
  $('#runBtn').disabled = keys.length > 0;
}

function schedule() {
  const check = validate(state);
  showErrors(check.errors);
  persist();
  if (!check.ok || !autoRun) return;

  clearTimeout(timer);
  timer = setTimeout(run, 250);
}

function run() {
  const check = validate(state);
  showErrors(check.errors);
  if (!check.ok) return;

  const p = derive(state);
  const started = performance.now();

  try {
    const sig = buildSignal(p);
    const meas = measureAll(sig, p);
    last = { sig, meas, p };
    renderMetrics(performance.now() - started);
    renderPlots();
  } catch (err) {
    const banner = $('#banner');
    banner.hidden = false;
    banner.textContent = `Ошибка расчёта: ${err.message}`;
  }
}

function renderMetrics(elapsedMs) {
  const { sig, meas, p } = last;
  const rows = verdictTable(meas, p.limits);
  const body = $('#resultsBody');
  body.textContent = '';

  let allPass = true;
  for (const r of rows) {
    if (!r.pass) allPass = false;
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${r.name}</td>` +
      `<td class="num">${r.value.toFixed(2)} ${r.unit}</td>` +
      `<td class="extra">${r.extra || ''}</td>` +
      `<td class="extra">${r.cmp} ${r.limit} ${r.unit}</td>` +
      `<td class="mark ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'годен' : 'не годен'}</td>`;
    body.appendChild(tr);
  }

  const badge = $('#verdict');
  badge.textContent = allPass ? 'годен' : 'не годен';
  badge.className = `verdict ${allPass ? 'pass' : 'fail'}`;

  $('#signalInfo').textContent =
    `${MODULATIONS[p.modulation].name}, ${(p.symbolRate / 1e6).toFixed(3)} МСимв/с, ` +
    `полоса ${(p.chanBw / 1e6).toFixed(3)} МГц, пик-фактор ${papr(sig).toFixed(2)} дБ`;

  $('#status').textContent =
    `${p.nSymbols} симв. · ${sig.I.length} отсч. · ${elapsedMs.toFixed(0)} мс`;
}

function symbolSamples(sig, sps) {
  const n = Math.floor(sig.I.length / sps);
  const I = new Float64Array(n);
  const Q = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    I[s] = sig.I[s * sps];
    Q[s] = sig.Q[s * sps];
  }
  return { I, Q };
}

function drawTask(key) {
  const { sig, meas, p } = last;

  if (key === 'constellation') {
    const ref = constellation(p.modulation);
    return (canvas) => plots.drawConstellation(canvas, {
      I: meas.normI, Q: meas.normQ,
      refI: ref.I, refQ: ref.Q,
      title: `Диаграмма созвездия, ${MODULATIONS[p.modulation].name}`,
    });
  }

  if (key === 'spectrum') {
    return (canvas) => plots.drawSpectrum(canvas, {
      spec: meas.acpr.spec,
      chanBw: p.chanBw,
      chanSpacing: p.chanSpacing,
      carrierHz: p.carrierHz,
    });
  }

  if (key === 'vector') {
    const pts = symbolSamples(sig, p.sps);
    return (canvas) => plots.drawVector(canvas, {
      I: sig.I, Q: sig.Q, symI: pts.I, symQ: pts.Q,
    });
  }

  if (key === 'eye') {
    const eye = eyeTraces(sig, p);
    return (canvas) => plots.drawEye(canvas, { ...eye, showQ: eyeQ });
  }

  if (key === 'time') {
    return (canvas) => plots.drawTime(canvas, {
      I: sig.I, Q: sig.Q, sps: p.sps, nSymbols: 12,
    });
  }

  const curve = paCurve(p.pa);
  return (canvas) => plots.drawPaCurve(canvas, { ...curve, backoffDb: p.pa.backoffDb });
}

function renderPlots() {
  if (!last) return;
  for (const pl of PLOTS) {
    if (!visible.has(pl.key)) continue;
    const canvas = document.getElementById(pl.canvas);
    if (!canvas) continue;
    drawTask(pl.key)(canvas);
  }
}

function applyPlotVisibility() {
  for (const pl of PLOTS) {
    const section = document.querySelector(`.plot[data-plot="${pl.key}"]`);
    if (section) section.hidden = !visible.has(pl.key);
  }
}

function buildChips() {
  const box = $('#chips');
  for (const pl of PLOTS) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    btn.textContent = pl.label;
    btn.setAttribute('aria-pressed', visible.has(pl.key) ? 'true' : 'false');

    btn.addEventListener('click', () => {
      if (visible.has(pl.key)) visible.delete(pl.key);
      else visible.add(pl.key);
      btn.setAttribute('aria-pressed', visible.has(pl.key) ? 'true' : 'false');
      applyPlotVisibility();
      renderPlots();
      persist();
    });
    box.appendChild(btn);
  }
}

function buildPresets() {
  const sel = $('#preset');
  sel.innerHTML = '<option value="">— не выбрана —</option>';
  for (const [key, preset] of Object.entries(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = preset.label;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    state = applyPreset(state, sel.value);
    syncInputs();
    updateVisibility();
    run();
    persist();
  });
}

function buildPrbsOptions() {
  const sel = $('#prbsType');
  for (const [key, spec] of Object.entries(PRBS_TYPES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${key} — ${spec.poly}, период ${Math.pow(2, spec.len) - 1}`;
    sel.appendChild(opt);
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme').value = theme;
  $('#themeBtn').textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  try { localStorage.setItem('vsg.theme', theme); } catch (e) { /* игнорируется */ }
  renderPlots();
}

function sourceText(p) {
  if (p.source === 'prbs') return `${p.prbsType}, ${PRBS_TYPES[p.prbsType].poly}`;
  if (p.source === 'random') return `случайные биты, зерно ${p.seed}`;
  return `пользовательский набор (${p.userFormat})`;
}

function reportInfo() {
  const { sig, meas, p } = last;
  const rows = verdictTable(meas, p.limits);
  const paName = p.pa.model === 'saleh' ? 'модель Салеха' : 'модель Раппа';

  return {
    signalRows: [
      ['Схема модуляции', MODULATIONS[p.modulation].name],
      ['Несущая частота', `${(p.carrierHz / 1e6).toFixed(3)} МГц`],
      ['Уровень выходной мощности', `${p.powerDbm} дБм`],
      ['Символьная скорость', `${(p.symbolRate / 1e6).toFixed(3)} МСимв/с`],
      ['Источник данных', sourceText(p)],
      ['Формирующий фильтр', `RRC, α = ${p.alpha}, длительность ${p.span} симв.`],
      ['Отсчётов на символ', String(p.sps)],
      ['Частота дискретизации', `${(p.fs / 1e6).toFixed(3)} МГц`],
      ['Число символов', String(p.nSymbols)],
      ['Занимаемая полоса', `${(p.chanBw / 1e6).toFixed(3)} МГц`],
      ['Пик-фактор сигнала', `${papr(sig).toFixed(2)} дБ`],
      ['Зерно генератора', String(p.seed)],
    ],
    impairRows: [
      ['Рассогласование I/Q', p.iq.on ? `${p.iq.gainDb} дБ, ${p.iq.phaseDeg}°` : 'отключено'],
      ['Смещение нуля', p.dc.on ? `I ${p.dc.iPct} %, Q ${p.dc.qPct} %` : 'отключено'],
      ['Фазовый шум', p.pn.on
        ? `${p.pn.levelDbc} дБн/Гц на отстройке ${(p.pn.offsetHz / 1e3).toFixed(0)} кГц`
        : 'отключено'],
      ['Нелинейность усилителя', p.pa.on
        ? `${paName}, отступ ${p.pa.backoffDb} дБ`
        : 'отключено'],
      ['Аддитивный шум', p.awgn.on ? `SNR ${p.awgn.snrDb} дБ` : 'отключено'],
    ],
    resultRows: rows,
    verdict: rows.every((r) => r.pass),
    notes: [
      'Отношение сигнал/шум задано в полосе символьной скорости.',
      'EVM рассчитана после устранения общего комплексного коэффициента передачи.',
      `Опорное созвездие: ${p.evmMode === 'reference'
        ? 'переданные символы' : 'результат жёсткого решения'}.`,
      'ACPR ограничена уровнем моделируемого шума в полосе анализа.',
      'Расчёт воспроизводим: при тех же параметрах и зерне результат совпадает.',
    ],
  };
}

function activeDrawTasks() {
  return PLOTS.filter((pl) => visible.has(pl.key)).map((pl) => drawTask(pl.key));
}

function busy(btn, fn) {
  return async () => {
    if (!last) return;
    const text = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Подождите…';
    try {
      await fn();
    } catch (err) {
      const banner = $('#banner');
      banner.hidden = false;
      banner.textContent = `Ошибка экспорта: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = text;
    }
  };
}

function bindActions() {
  $('#runBtn').addEventListener('click', run);

  $('#themeBtn').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  $('#theme').addEventListener('change', (e) => applyTheme(e.target.value));

  $('#autoRun').checked = autoRun;
  $('#autoRun').addEventListener('change', (e) => {
    autoRun = e.target.checked;
    persist();
    if (autoRun) run();
  });

  $('#eyeQ').checked = eyeQ;
  $('#eyeQ').addEventListener('change', (e) => {
    eyeQ = e.target.checked;
    persist();
    renderPlots();
  });

  const unit = $('#freqUnit');
  unit.value = String(freqScale);
  unit.addEventListener('change', (e) => {
    freqScale = Number(e.target.value);
    const el = $('#carrier');
    el.dataset.scale = String(freqScale);
    el.step = freqScale === 1e9 ? '0.01' : '1';
    $('#carrierLabel').textContent = `Несущая частота, ${freqScale === 1e9 ? 'ГГц' : 'МГц'}`;
    syncInputs();
    persist();
  });

  const reportBtn = $('#reportBtn');
  reportBtn.addEventListener('click', busy(reportBtn, async () => {
    const pages = [out.renderReportPage(reportInfo()), ...out.renderPlotsPages(activeDrawTasks())];
    out.download(await out.makePdf(pages), `vsg_otchet_${out.stamp()}.pdf`);
  }));

  const plotsBtn = $('#exportPlotsPdf');
  plotsBtn.addEventListener('click', busy(plotsBtn, async () => {
    out.download(await out.makePdf(out.renderPlotsPages(activeDrawTasks())),
      `vsg_grafiki_${out.stamp()}.pdf`);
  }));

  $('#exportCsv').addEventListener('click', () => {
    if (!last) return;
    out.download(out.makeCsv(last.sig, last.p), `vsg_iq_${out.stamp()}.csv`);
  });

  $('#exportWav').addEventListener('click', () => {
    if (!last) return;
    out.download(out.makeWav(last.sig.I, last.sig.Q, last.p.fs), `vsg_iq_${out.stamp()}.wav`);
  });

  for (const btn of $$('[data-png]')) {
    btn.addEventListener('click', async () => {
      const pl = PLOTS.find((x) => x.key === btn.dataset.png);
      const canvas = document.getElementById(pl.canvas);
      await out.savePng(canvas, `vsg_${pl.file}`);
    });
  }

  $('#saveCfg').addEventListener('click', () => out.saveConfig(state));

  $('#loadCfgBtn').addEventListener('click', () => $('#loadCfg').click());
  $('#loadCfg').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state = mergeParams(await out.loadConfig(file));
      syncInputs();
      updateVisibility();
      run();
      persist();
    } catch (err) {
      const banner = $('#banner');
      banner.hidden = false;
      banner.textContent = `Не удалось загрузить конфигурацию: ${err.message}`;
    } finally {
      e.target.value = '';
    }
  });

  $('#resetCfg').addEventListener('click', () => {
    state = defaultParams();
    $('#preset').value = '';
    syncInputs();
    updateVisibility();
    run();
    persist();
  });

  for (const el of $$('[data-bind]')) {
    el.addEventListener('input', () => {
      const kind = el.dataset.kind;
      let value;

      if (kind === 'bool') {
        value = el.checked;
      } else if (kind === 'string') {
        value = el.value;
      } else {
        const scale = el.dataset.scale ? Number(el.dataset.scale) : 1;
        value = Number(el.value) * scale;
      }

      setPath(state, el.dataset.bind, value);
      syncInputs(el);
      updateVisibility();
      schedule();
    });
  }

  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderPlots, 120);
  }).observe($('#plots'));
}

function init() {
  restore();
  buildPresets();
  buildPrbsOptions();
  buildChips();
  bindActions();

  const el = $('#carrier');
  el.dataset.scale = String(freqScale);
  $('#carrierLabel').textContent = `Несущая частота, ${freqScale === 1e9 ? 'ГГц' : 'МГц'}`;

  syncInputs();
  updateVisibility();
  applyPlotVisibility();

  let theme = 'light';
  try { theme = localStorage.getItem('vsg.theme') || 'light'; } catch (e) { /* игнорируется */ }
  applyTheme(theme);

  run();
}

init();
