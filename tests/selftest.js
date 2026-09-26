// Проверка вычислительного ядра: сверка результатов с теоретическими значениями

import { prbs, PRBS_TYPES } from '../js/dsp/source.js';
import { constellation, MODULATIONS, grayDecode } from '../js/dsp/mapper.js';
import { rrcTaps } from '../js/dsp/rrc.js';
import { buildSignal, papr } from '../js/dsp/chain.js';
import { measureAll } from '../js/dsp/measure.js';
import { defaultParams, derive, validate, applyPreset } from '../js/params.js';

const results = [];

function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail });
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function baseParams(over = {}) {
  const p = defaultParams();
  p.nSymbols = 2048;
  p.iq.on = false;
  p.dc.on = false;
  p.pn.on = false;
  p.pa.on = false;
  p.awgn.on = false;
  Object.assign(p, over);
  return derive(p);
}

function run() {
  for (const name of ['PRBS7', 'PRBS9', 'PRBS11', 'PRBS15']) {
    const period = Math.pow(2, PRBS_TYPES[name].len) - 1;
    const seq = prbs(name, 2 * period, 1);

    let periodOk = true;
    let ones = 0;
    for (let i = 0; i < period; i++) {
      if (seq[i] !== seq[i + period]) periodOk = false;
      ones += seq[i];
    }
    check(`Период ${name} равен ${period} бит`, periodOk);
    check(`Баланс нулей и единиц ${name}`,
      ones === (period + 1) / 2, `единиц ${ones} из ${period}`);
  }

  check('Код Грея декодируется верно',
    grayDecode(0) === 0 && grayDecode(1) === 1 && grayDecode(3) === 2 && grayDecode(2) === 3);

  for (const mod of Object.keys(MODULATIONS)) {
    const c = constellation(mod);
    let p = 0;
    for (let i = 0; i < c.I.length; i++) p += c.I[i] * c.I[i] + c.Q[i] * c.Q[i];
    p /= c.I.length;
    check(`Средняя мощность созвездия ${mod} равна 1`, near(p, 1, 1e-9), p.toFixed(6));
  }

  const taps = rrcTaps(0.35, 8, 8);
  let energy = 0;
  for (const t of taps) energy += t * t;
  check('Энергия характеристики RRC нормирована', near(energy, 1, 1e-9), energy.toFixed(8));

  let symmetric = true;
  for (let i = 0; i < taps.length; i++) {
    if (!near(taps[i], taps[taps.length - 1 - i], 1e-12)) symmetric = false;
  }
  check('Характеристика RRC симметрична', symmetric);

  const tapsA1 = rrcTaps(1, 8, 8);
  check('RRC при alpha = 1 рассчитывается без особенностей',
    tapsA1.every(Number.isFinite));

  for (const mod of ['QPSK', '16QAM', '64QAM']) {
    const p = baseParams({ modulation: mod });
    const m = measureAll(buildSignal(p), p);
    check(`Идеальный тракт ${mod}: EVM близка к нулю`,
      m.evmRmsPct < 0.6, `${m.evmRmsPct.toFixed(4)} %`);
  }

  for (const snr of [15, 20, 25, 30]) {
    const p = baseParams({ modulation: '16QAM' });
    p.awgn.on = true;
    p.awgn.snrDb = snr;
    const m = measureAll(buildSignal(p), p);

    const theoryEvm = 100 / Math.sqrt(Math.pow(10, snr / 10));
    check(`AWGN ${snr} дБ: MER совпадает с заданным SNR`,
      near(m.merDb, snr, 1.2), `MER ${m.merDb.toFixed(2)} дБ`);
    check(`AWGN ${snr} дБ: EVM согласуется с теорией`,
      near(m.evmRmsPct, theoryEvm, theoryEvm * 0.1),
      `расчёт ${m.evmRmsPct.toFixed(2)} %, теория ${theoryEvm.toFixed(2)} %`);
  }

  const isiBySpan = [4, 8, 12, 24].map((span) => {
    const p = baseParams({ span });
    return { span, evm: measureAll(buildSignal(p), p).evmRmsPct };
  });
  check('Увеличение длительности характеристики фильтра снижает межсимвольную помеху',
    isiBySpan[0].evm > isiBySpan[1].evm && isiBySpan[1].evm > isiBySpan[3].evm,
    isiBySpan.map((r) => `span ${r.span}: ${r.evm.toFixed(3)} %`).join('; '));

  const pIq = baseParams();
  pIq.iq.on = true;
  pIq.iq.gainDb = 1;
  pIq.iq.phaseDeg = 5;
  const mIq = measureAll(buildSignal(pIq), pIq);
  check('Рассогласование I/Q увеличивает EVM',
    mIq.evmRmsPct > 2, `${mIq.evmRmsPct.toFixed(2)} %`);

  const pDc = baseParams();
  pDc.dc.on = true;
  pDc.dc.iPct = 10;
  pDc.dc.qPct = 0;
  const mDc = measureAll(buildSignal(pDc), pDc);
  check('Смещение нуля увеличивает EVM',
    mDc.evmRmsPct > 2, `${mDc.evmRmsPct.toFixed(2)} %`);

  const pPn = baseParams();
  pPn.pn.on = true;
  pPn.pn.levelDbc = -80;
  const mPn = measureAll(buildSignal(pPn), pPn);
  check('Фазовый шум увеличивает EVM',
    mPn.evmRmsPct > 0.5, `${mPn.evmRmsPct.toFixed(2)} %`);

  const acprByBackoff = [3, 8, 15].map((backoffDb) => {
    const p = baseParams();
    p.pa.on = true;
    p.pa.model = 'saleh';
    p.pa.backoffDb = backoffDb;
    const m = measureAll(buildSignal(p), p);
    return { backoffDb, acpr: m.acpr.worstDb, evm: m.evmRmsPct };
  });
  check('Рост отступа от насыщения улучшает ACPR',
    acprByBackoff[0].acpr > acprByBackoff[1].acpr &&
    acprByBackoff[1].acpr > acprByBackoff[2].acpr,
    acprByBackoff.map((r) => `${r.backoffDb} дБ: ${r.acpr.toFixed(1)} дБн`).join('; '));
  check('Рост отступа от насыщения улучшает EVM',
    acprByBackoff[0].evm > acprByBackoff[2].evm,
    acprByBackoff.map((r) => `${r.backoffDb} дБ: ${r.evm.toFixed(2)} %`).join('; '));

  const pQpsk = baseParams({ modulation: 'QPSK' });
  const p64 = baseParams({ modulation: '64QAM' });
  check('Пик-фактор 64-QAM выше, чем у QPSK',
    papr(buildSignal(p64)) > papr(buildSignal(pQpsk)),
    `QPSK ${papr(buildSignal(pQpsk)).toFixed(2)} дБ, 64-QAM ${papr(buildSignal(p64)).toFixed(2)} дБ`);

  const pRep1 = baseParams();
  const pRep2 = baseParams();
  pRep1.awgn.on = true;
  pRep2.awgn.on = true;
  const r1 = measureAll(buildSignal(pRep1), pRep1);
  const r2 = measureAll(buildSignal(pRep2), pRep2);
  check('Результат воспроизводим при одинаковых параметрах',
    r1.evmRmsPct === r2.evmRmsPct, `${r1.evmRmsPct.toFixed(6)} %`);

  const pSeed = baseParams();
  pSeed.awgn.on = true;
  pSeed.seed = 777;
  const rSeed = measureAll(buildSignal(pSeed), pSeed);
  check('Изменение зерна меняет реализацию шума',
    rSeed.evmRmsPct !== r1.evmRmsPct);

  const bad = defaultParams();
  bad.symbolRate = -1;
  bad.alpha = 2;
  bad.awgn.snrDb = 999;
  const v = validate(bad);
  check('Проверка ввода выявляет недопустимые значения',
    !v.ok && v.errors.symbolRate && v.errors.alpha && v.errors['awgn.snrDb'],
    Object.keys(v.errors).join(', '));

  check('Корректные параметры проходят проверку', validate(defaultParams()).ok);

  const preset = applyPreset(defaultParams(), 'lte64');
  check('Предустановка применяется целиком',
    preset.modulation === '64QAM' && preset.limits.evmPct === 8 && preset.alpha === 0.22);

  const decP = baseParams({ modulation: '16QAM', evmMode: 'decision' });
  decP.awgn.on = true;
  decP.awgn.snrDb = 30;
  const decM = measureAll(buildSignal(decP), decP);
  check('Режим измерения по решению даёт близкий результат',
    near(decM.merDb, 30, 2), `MER ${decM.merDb.toFixed(2)} дБ`);

  return results;
}

export { run };
