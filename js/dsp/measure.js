// Измерения: EVM, MER, SNR, ACPR, таблица годности (раздел 2.4 ТЗ)

import { rrcTaps, convolve } from './rrc.js';
import { welchPsd, bandPower } from './fft.js';
import { hardDecision } from './mapper.js';

export function receive(sI, sQ, sps, alpha, span) {
  const taps = rrcTaps(alpha, span, sps);
  const delay = (taps.length - 1) / 2;

  const fI = convolve(sI, taps);
  const fQ = convolve(sQ, taps);

  const n = Math.floor(sI.length / sps);
  const I = new Float64Array(n);
  const Q = new Float64Array(n);
  const g = 1 / Math.sqrt(sps);

  for (let s = 0; s < n; s++) {
    const k = s * sps + delay;
    if (k >= fI.length) break;
    I[s] = fI[k] * g;
    Q[s] = fQ[k] * g;
  }
  return { I, Q, n };
}

export function evm(rI, rQ, refI, refQ, skip = 8) {
  const n = Math.min(rI.length, refI.length);
  const from = Math.min(skip, Math.floor(n / 4));
  const to = n - from;
  const count = to - from;
  if (count <= 0) throw new Error('Недостаточно символов для измерения');

  let numRe = 0;
  let numIm = 0;
  let den = 0;
  for (let s = from; s < to; s++) {
    numRe += rI[s] * refI[s] + rQ[s] * refQ[s];
    numIm += rQ[s] * refI[s] - rI[s] * refQ[s];
    den += refI[s] * refI[s] + refQ[s] * refQ[s];
  }
  const aRe = numRe / den;
  const aIm = numIm / den;
  const aMag = aRe * aRe + aIm * aIm || 1e-30;

  const normI = new Float64Array(count);
  const normQ = new Float64Array(count);

  let errPower = 0;
  let refPower = 0;
  let peakErr = 0;

  for (let s = from; s < to; s++) {
    const cI = (rI[s] * aRe + rQ[s] * aIm) / aMag;
    const cQ = (rQ[s] * aRe - rI[s] * aIm) / aMag;
    normI[s - from] = cI;
    normQ[s - from] = cQ;

    const dI = cI - refI[s];
    const dQ = cQ - refQ[s];
    const e = dI * dI + dQ * dQ;

    errPower += e;
    refPower += refI[s] * refI[s] + refQ[s] * refQ[s];
    if (e > peakErr) peakErr = e;
  }

  const meanRef = refPower / count;
  const evmRms = Math.sqrt(errPower / refPower);
  const evmPeak = Math.sqrt(peakErr / meanRef);
  const merDb = 10 * Math.log10(refPower / Math.max(errPower, 1e-30));

  return {
    evmRmsPct: evmRms * 100,
    evmRmsDb: 20 * Math.log10(Math.max(evmRms, 1e-12)),
    evmPeakPct: evmPeak * 100,
    evmPeakDb: 20 * Math.log10(Math.max(evmPeak, 1e-12)),
    merDb,
    snrDb: merDb,
    normI,
    normQ,
    count,
  };
}

export function acpr(sI, sQ, fs, chanBw, spacing, nfft = 2048) {
  const spec = welchPsd(sI, sQ, fs, nfft);
  const half = chanBw / 2;

  const main = bandPower(spec, -half, half);
  const lower = bandPower(spec, -spacing - half, -spacing + half);
  const upper = bandPower(spec, spacing - half, spacing + half);

  const ratioDb = (p) =>
    10 * Math.log10(Math.max(p, 1e-30) / Math.max(main, 1e-30));

  const lowerDb = ratioDb(lower);
  const upperDb = ratioDb(upper);

  return {
    mainPower: main,
    lowerDb,
    upperDb,
    worstDb: Math.max(lowerDb, upperDb),
    spec,
  };
}

export function measureAll(sig, p) {
  const { I: rI, Q: rQ } = receive(sig.I, sig.Q, p.sps, p.alpha, p.span);

  let refI = sig.symI;
  let refQ = sig.symQ;
  if (p.evmMode === 'decision') {
    const d = hardDecision(rI, rQ, p.modulation);
    refI = d.I;
    refQ = d.Q;
  }

  const e = evm(rI, rQ, refI, refQ, p.span);
  const a = acpr(sig.I, sig.Q, p.fs, p.chanBw, p.chanSpacing);

  return { ...e, acpr: a, rxI: rI, rxQ: rQ };
}

export function verdictTable(m, limits) {
  return [
    {
      name: 'EVM (среднеквадратическое)',
      value: m.evmRmsPct,
      unit: '%',
      extra: `${m.evmRmsDb.toFixed(2)} дБ`,
      limit: limits.evmPct,
      cmp: 'не более',
      pass: m.evmRmsPct <= limits.evmPct,
    },
    {
      name: 'EVM (пиковое)',
      value: m.evmPeakPct,
      unit: '%',
      extra: `${m.evmPeakDb.toFixed(2)} дБ`,
      limit: limits.evmPeakPct,
      cmp: 'не более',
      pass: m.evmPeakPct <= limits.evmPeakPct,
    },
    {
      name: 'MER',
      value: m.merDb,
      unit: 'дБ',
      extra: '',
      limit: limits.merDb,
      cmp: 'не менее',
      pass: m.merDb >= limits.merDb,
    },
    {
      name: 'SNR (измеренное)',
      value: m.snrDb,
      unit: 'дБ',
      extra: '',
      limit: limits.snrDb,
      cmp: 'не менее',
      pass: m.snrDb >= limits.snrDb,
    },
    {
      name: 'ACPR (худший соседний канал)',
      value: m.acpr.worstDb,
      unit: 'дБн',
      extra: `нижний ${m.acpr.lowerDb.toFixed(1)}, верхний ${m.acpr.upperDb.toFixed(1)}`,
      limit: limits.acprDb,
      cmp: 'не более',
      pass: m.acpr.worstDb <= limits.acprDb,
    },
  ];
}
