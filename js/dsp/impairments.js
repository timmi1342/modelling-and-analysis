// Модель искажений тракта: I/Q, DC, фазовый шум, УМ, AWGN (раздел 2.2 ТЗ)

import { rng, gaussian } from './source.js';

export const PA_MODELS = {
  saleh: { name: 'Модель Салеха (ЛБВ)', hasAmPm: true },
  rapp:  { name: 'Модель Раппа (транзисторный УМ)', hasAmPm: false },
};

export function iqImbalance(I, Q, gainDb, phaseDeg) {
  const aI = Math.pow(10, gainDb / 40);
  const aQ = Math.pow(10, -gainDb / 40);
  const th = (phaseDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);

  for (let i = 0; i < I.length; i++) {
    const i0 = I[i];
    const q0 = Q[i];
    I[i] = aI * i0;
    Q[i] = aQ * (q0 * c + i0 * s);
  }
}

export function dcOffset(I, Q, dcIPct, dcQPct) {
  let power = 0;
  for (let i = 0; i < I.length; i++) power += I[i] * I[i] + Q[i] * Q[i];
  const rms = Math.sqrt(power / I.length);

  const dI = (dcIPct / 100) * rms;
  const dQ = (dcQPct / 100) * rms;

  for (let i = 0; i < I.length; i++) {
    I[i] += dI;
    Q[i] += dQ;
  }
}

export function phaseNoise(I, Q, levelDbc, offsetHz, fs, seed, loopBwHz = 1e4) {
  const lLin = Math.pow(10, levelDbc / 10);
  const variance = (lLin * 4 * Math.PI * Math.PI * offsetHz * offsetHz) / fs;
  const sigma = Math.sqrt(Math.max(variance, 0));
  const rho = Math.exp((-2 * Math.PI * Math.min(loopBwHz, fs / 4)) / fs);

  const rand = rng(seed);
  let phase = 0;

  for (let i = 0; i < I.length; i++) {
    phase = rho * phase + sigma * gaussian(rand)[0];

    const c = Math.cos(phase);
    const s = Math.sin(phase);
    const i0 = I[i];
    const q0 = Q[i];
    I[i] = i0 * c - q0 * s;
    Q[i] = i0 * s + q0 * c;
  }
}

export function amplifier(I, Q, p) {
  const n = I.length;

  let power = 0;
  for (let i = 0; i < n; i++) power += I[i] * I[i] + Q[i] * Q[i];
  const rms = Math.sqrt(power / n) || 1e-12;
  const gIn = Math.pow(10, -p.backoffDb / 20) / rms;

  const alphaA = 2.0;
  const betaA = 1.0;
  const alphaP = Math.PI / 3;
  const betaP = 1.0;
  const sharp = Math.max(p.smoothness ?? 2, 0.5);

  for (let i = 0; i < n; i++) {
    const iIn = I[i] * gIn;
    const qIn = Q[i] * gIn;
    const r = Math.hypot(iIn, qIn);
    if (r < 1e-12) {
      I[i] = 0;
      Q[i] = 0;
      continue;
    }

    let amp;
    let dPhase;
    if (p.model === 'rapp') {
      amp = r / Math.pow(1 + Math.pow(r, 2 * sharp), 1 / (2 * sharp));
      dPhase = 0;
    } else {
      amp = (alphaA * r) / (1 + betaA * r * r);
      dPhase = (alphaP * r * r) / (1 + betaP * r * r);
    }

    const g = amp / r;
    const c = Math.cos(dPhase);
    const s = Math.sin(dPhase);
    I[i] = g * (iIn * c - qIn * s);
    Q[i] = g * (iIn * s + qIn * c);
  }

  let outPower = 0;
  for (let i = 0; i < n; i++) outPower += I[i] * I[i] + Q[i] * Q[i];
  const gOut = rms / (Math.sqrt(outPower / n) || 1e-12);
  for (let i = 0; i < n; i++) {
    I[i] *= gOut;
    Q[i] *= gOut;
  }
}

export function awgn(I, Q, snrDb, seed, bwFactor = 1) {
  const n = I.length;

  let power = 0;
  for (let i = 0; i < n; i++) power += I[i] * I[i] + Q[i] * Q[i];

  const noisePower = ((power / n) * bwFactor) / Math.pow(10, snrDb / 10);
  const sigma = Math.sqrt(noisePower / 2);
  const rand = rng(seed);

  for (let i = 0; i < n; i++) {
    const [gI, gQ] = gaussian(rand);
    I[i] += sigma * gI;
    Q[i] += sigma * gQ;
  }
}

export function applyImpairments(I, Q, p, fs) {
  if (p.iq.on) iqImbalance(I, Q, p.iq.gainDb, p.iq.phaseDeg);
  if (p.dc.on) dcOffset(I, Q, p.dc.iPct, p.dc.qPct);
  if (p.pn.on) {
    phaseNoise(I, Q, p.pn.levelDbc, p.pn.offsetHz, fs, p.seed + 1, p.pn.loopBwHz);
  }
  if (p.pa.on) amplifier(I, Q, p.pa);
  if (p.awgn.on) awgn(I, Q, p.awgn.snrDb, p.seed + 2, p.sps);
}

export function paCurve(p, points = 128) {
  const r = new Float64Array(points);
  const amAm = new Float64Array(points);
  const amPm = new Float64Array(points);
  const sharp = Math.max(p.smoothness ?? 2, 0.5);

  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2;
    r[i] = x;
    if (p.model === 'rapp') {
      amAm[i] = x / Math.pow(1 + Math.pow(x, 2 * sharp), 1 / (2 * sharp));
      amPm[i] = 0;
    } else {
      amAm[i] = (2 * x) / (1 + x * x);
      amPm[i] = ((Math.PI / 3) * x * x) / (1 + x * x) * (180 / Math.PI);
    }
  }
  return { r, amAm, amPm };
}
