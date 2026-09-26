// Спектральный анализ: БПФ и метод Уэлча (разделы 2.3, 2.4 ТЗ)

export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error('Длина преобразования должна быть степенью двойки');
  }

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;

    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;

        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;

        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

export function fftShift(x) {
  const n = x.length;
  const half = n >> 1;
  const out = new Float64Array(n);
  for (let i = 0; i < half; i++) {
    out[i] = x[i + half];
    out[i + half] = x[i];
  }
  return out;
}

export function welchPsd(sI, sQ, fs, nfft = 1024) {
  const n = sI.length;
  const size = Math.min(nfft, 1 << Math.floor(Math.log2(Math.max(n, 2))));
  const hop = size >> 1;
  const win = hann(size);

  let winPower = 0;
  for (let i = 0; i < size; i++) winPower += win[i] * win[i];
  const norm = 1 / (fs * winPower);

  const acc = new Float64Array(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let segments = 0;

  for (let start = 0; start + size <= n; start += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = sI[start + i] * win[i];
      im[i] = sQ[start + i] * win[i];
    }
    fft(re, im);
    for (let i = 0; i < size; i++) {
      acc[i] += (re[i] * re[i] + im[i] * im[i]) * norm;
    }
    segments++;
  }

  if (segments === 0) segments = 1;
  for (let i = 0; i < size; i++) acc[i] /= segments;

  const psd = fftShift(acc);
  const freq = new Float64Array(size);
  const df = fs / size;
  for (let i = 0; i < size; i++) freq[i] = (i - size / 2) * df;

  const psdDb = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    psdDb[i] = 10 * Math.log10(Math.max(psd[i], 1e-30));
  }
  return { freq, psd, psdDb, df };
}

export function bandPower(spec, fLow, fHigh) {
  let sum = 0;
  for (let i = 0; i < spec.freq.length; i++) {
    if (spec.freq[i] >= fLow && spec.freq[i] < fHigh) sum += spec.psd[i];
  }
  return sum * spec.df;
}
