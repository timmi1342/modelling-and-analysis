# Эталонная модель тракта на Python: сверка вычислительного ядра веб-версии (раздел 6 ТЗ)

import json
import math
import sys

import numpy as np

M32 = 0xFFFFFFFF


def to_u32(x):
    return x & M32


def to_i32(x):
    x &= M32
    return x - 0x100000000 if x >= 0x80000000 else x


def imul(a, b):
    return to_i32((to_i32(a) * to_i32(b)) & M32)


class Mulberry32:
    def __init__(self, seed):
        self.a = to_u32(seed)

    def next(self):
        self.a = to_u32(self.a + 0x6D2B79F5)
        t = self.a
        t = imul(t ^ (t >> 15), t | 1)
        t = to_i32(t ^ to_i32(t + imul(t ^ (to_u32(t) >> 7), t | 61)))
        return to_u32(t ^ (to_u32(t) >> 14)) / 4294967296.0

    def gaussian(self):
        u1 = max(self.next(), 1e-12)
        u2 = self.next()
        mag = math.sqrt(-2 * math.log(u1))
        return mag * math.cos(2 * math.pi * u2), mag * math.sin(2 * math.pi * u2)


PRBS_TYPES = {
    "PRBS7": (7, 6, 0),
    "PRBS9": (9, 5, 0),
    "PRBS11": (11, 9, 0),
    "PRBS15": (15, 14, 0),
    "PRBS23": (23, 18, 0),
    "PRBS31": (31, 28, 0),
}

MODULATIONS = {
    "BPSK": (1, "psk"),
    "QPSK": (2, "psk"),
    "8PSK": (3, "psk"),
    "16QAM": (4, "qam"),
    "64QAM": (6, "qam"),
}


def prbs(name, n_bits, seed=1):
    length, t1, t2 = PRBS_TYPES[name]
    mask = 0x7FFFFFFF if length >= 31 else (1 << length) - 1
    reg = (imul(to_u32(seed) or 1, 0x9E3779B1) & M32) >> (32 - length) & mask
    if reg == 0:
        reg = mask

    out = np.zeros(n_bits, dtype=np.uint8)
    for i in range(n_bits):
        feedback = ((reg >> t1) ^ (reg >> t2)) & 1
        out[i] = reg & 1
        reg = ((reg >> 1) | (feedback << (length - 1))) & mask
    return out


def gray_decode(g):
    b = g
    while g > 0:
        g >>= 1
        b ^= g
    return b


def constellation(mod):
    bps, kind = MODULATIONS[mod]
    M = 1 << bps
    pts = np.zeros(M, dtype=complex)

    if kind == "psk":
        for s in range(M):
            phase = 2 * math.pi * gray_decode(s) / M
            pts[s] = complex(math.cos(phase), math.sin(phase))
    else:
        half = bps // 2
        levels = 1 << half
        mask = levels - 1
        for s in range(M):
            i = 2 * gray_decode((s >> half) & mask) - (levels - 1)
            q = 2 * gray_decode(s & mask) - (levels - 1)
            pts[s] = complex(i, q)

    power = np.mean(np.abs(pts) ** 2)
    return pts * math.sqrt(1.0 / power)


def map_symbols(bits, mod):
    bps, _ = MODULATIONS[mod]
    pts = constellation(mod)
    n = len(bits) // bps

    idx = np.zeros(n, dtype=int)
    for s in range(n):
        v = 0
        for b in range(bps):
            v = (v << 1) | int(bits[s * bps + b])
        idx[s] = v
    return pts[idx], idx


def rrc_taps(alpha, span, sps):
    a = min(max(alpha, 0.0), 1.0)
    N = span * sps
    taps = np.zeros(N + 1)
    eps = 1e-8

    for i in range(N + 1):
        t = (i - N / 2) / sps
        if abs(t) < eps:
            h = 1 + a * (4 / math.pi - 1)
        elif a > eps and abs(abs(t) - 1 / (4 * a)) < eps:
            x = math.pi / (4 * a)
            h = (a / math.sqrt(2)) * (
                (1 + 2 / math.pi) * math.sin(x) + (1 - 2 / math.pi) * math.cos(x)
            )
        else:
            pt = math.pi * t
            num = math.sin(pt * (1 - a)) + 4 * a * t * math.cos(pt * (1 + a))
            den = pt * (1 - (4 * a * t) ** 2)
            h = num / den
        taps[i] = h

    return taps / math.sqrt(np.sum(taps ** 2))


def shape(sym, taps, sps):
    delay = (len(taps) - 1) // 2
    n = len(sym) * sps

    up = np.zeros(n, dtype=complex)
    up[::sps] = sym

    full = np.convolve(up, taps)
    return full[delay:delay + n] * math.sqrt(sps)


def iq_imbalance(x, gain_db, phase_deg):
    a_i = 10 ** (gain_db / 40)
    a_q = 10 ** (-gain_db / 40)
    th = math.radians(phase_deg)
    i0 = x.real
    q0 = x.imag
    return (a_i * i0) + 1j * (a_q * (q0 * math.cos(th) + i0 * math.sin(th)))


def dc_offset(x, i_pct, q_pct):
    rms = math.sqrt(np.mean(np.abs(x) ** 2))
    return x + complex(i_pct / 100 * rms, q_pct / 100 * rms)


def phase_noise(x, level_dbc, offset_hz, fs, seed, loop_bw_hz):
    l_lin = 10 ** (level_dbc / 10)
    sigma = math.sqrt(max(l_lin * 4 * math.pi ** 2 * offset_hz ** 2 / fs, 0))
    rho = math.exp(-2 * math.pi * min(loop_bw_hz, fs / 4) / fs)

    rnd = Mulberry32(seed)
    phase = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        phase = rho * phase + sigma * rnd.gaussian()[0]
        out[i] = x[i] * complex(math.cos(phase), math.sin(phase))
    return out


def amplifier(x, model, backoff_db, smoothness):
    rms = math.sqrt(np.mean(np.abs(x) ** 2)) or 1e-12
    g_in = 10 ** (-backoff_db / 20) / rms
    sharp = max(smoothness, 0.5)

    z = x * g_in
    r = np.abs(z)
    safe = np.maximum(r, 1e-12)

    if model == "rapp":
        amp = r / np.power(1 + np.power(safe, 2 * sharp), 1 / (2 * sharp))
        dphase = np.zeros_like(r)
    else:
        amp = 2.0 * r / (1 + r ** 2)
        dphase = (math.pi / 3) * r ** 2 / (1 + r ** 2)

    out = (amp / safe) * z * np.exp(1j * dphase)
    out[r < 1e-12] = 0

    out_rms = math.sqrt(np.mean(np.abs(out) ** 2)) or 1e-12
    return out * (rms / out_rms)


def awgn(x, snr_db, seed, bw_factor):
    power = np.mean(np.abs(x) ** 2)
    noise_power = power * bw_factor / (10 ** (snr_db / 10))
    sigma = math.sqrt(noise_power / 2)

    rnd = Mulberry32(seed)
    out = x.copy()
    for i in range(len(x)):
        gi, gq = rnd.gaussian()
        out[i] += complex(sigma * gi, sigma * gq)
    return out


def hann(n):
    return 0.5 * (1 - np.cos(2 * np.pi * np.arange(n) / (n - 1)))


def welch_psd(x, fs, nfft=2048):
    n = len(x)
    size = min(nfft, 1 << int(math.floor(math.log2(max(n, 2)))))
    hop = size // 2
    win = hann(size)
    norm = 1 / (fs * np.sum(win ** 2))

    acc = np.zeros(size)
    segments = 0
    start = 0
    while start + size <= n:
        seg = np.fft.fft(x[start:start + size] * win)
        acc += (np.abs(seg) ** 2) * norm
        segments += 1
        start += hop

    acc /= max(segments, 1)
    psd = np.fft.fftshift(acc)
    df = fs / size
    freq = (np.arange(size) - size / 2) * df
    return freq, psd, df


def band_power(freq, psd, df, lo, hi):
    mask = (freq >= lo) & (freq < hi)
    return float(np.sum(psd[mask]) * df)


def receive(x, sps, alpha, span):
    taps = rrc_taps(alpha, span, sps)
    delay = (len(taps) - 1) // 2
    filt = np.convolve(x, taps)

    n = len(x) // sps
    idx = np.arange(n) * sps + delay
    idx = idx[idx < len(filt)]
    return filt[idx] / math.sqrt(sps)


def evm(rx, ref, skip):
    n = min(len(rx), len(ref))
    frm = min(skip, n // 4)
    to = n - frm

    r = rx[frm:to]
    s = ref[frm:to]

    a = np.sum(r * np.conj(s)) / np.sum(s * np.conj(s))
    corrected = r / a

    err = corrected - s
    err_power = float(np.sum(np.abs(err) ** 2))
    ref_power = float(np.sum(np.abs(s) ** 2))
    peak = float(np.max(np.abs(err) ** 2))
    mean_ref = ref_power / len(s)

    evm_rms = math.sqrt(err_power / ref_power)
    evm_peak = math.sqrt(peak / mean_ref)
    mer = 10 * math.log10(ref_power / max(err_power, 1e-30))

    return {
        "evmRmsPct": evm_rms * 100,
        "evmPeakPct": evm_peak * 100,
        "merDb": mer,
        "snrDb": mer,
    }


def build_and_measure(p):
    bps, _ = MODULATIONS[p["modulation"]]
    fs = p["symbolRate"] * p["sps"]

    bits = prbs(p["prbsType"], p["nSymbols"] * bps, p["seed"])
    sym, _ = map_symbols(bits, p["modulation"])

    taps = rrc_taps(p["alpha"], p["span"], p["sps"])
    x = shape(sym, taps, p["sps"])

    if p["iq"]["on"]:
        x = iq_imbalance(x, p["iq"]["gainDb"], p["iq"]["phaseDeg"])
    if p["dc"]["on"]:
        x = dc_offset(x, p["dc"]["iPct"], p["dc"]["qPct"])
    if p["pn"]["on"]:
        x = phase_noise(x, p["pn"]["levelDbc"], p["pn"]["offsetHz"], fs,
                        p["seed"] + 1, p["pn"]["loopBwHz"])
    if p["pa"]["on"]:
        x = amplifier(x, p["pa"]["model"], p["pa"]["backoffDb"], p["pa"]["smoothness"])
    if p["awgn"]["on"]:
        x = awgn(x, p["awgn"]["snrDb"], p["seed"] + 2, p["sps"])

    rx = receive(x, p["sps"], p["alpha"], p["span"])
    res = evm(rx, sym[:len(rx)], p["span"])

    chan_bw = p["symbolRate"] * (1 + p["alpha"])
    spacing = chan_bw * 1.25
    freq, psd, df = welch_psd(x, fs, 2048)

    main = band_power(freq, psd, df, -chan_bw / 2, chan_bw / 2)
    lower = band_power(freq, psd, df, -spacing - chan_bw / 2, -spacing + chan_bw / 2)
    upper = band_power(freq, psd, df, spacing - chan_bw / 2, spacing + chan_bw / 2)

    to_db = lambda v: 10 * math.log10(max(v, 1e-30) / max(main, 1e-30))
    res["acprDb"] = max(to_db(lower), to_db(upper))
    res["paprDb"] = 10 * math.log10(np.max(np.abs(x) ** 2) / np.mean(np.abs(x) ** 2))

    return res, x, rx, sym


def base_params(**over):
    p = {
        "modulation": "16QAM",
        "symbolRate": 1e6,
        "prbsType": "PRBS9",
        "seed": 1,
        "alpha": 0.35,
        "span": 12,
        "sps": 8,
        "nSymbols": 1024,
        "iq": {"on": False, "gainDb": 0.5, "phaseDeg": 3},
        "dc": {"on": False, "iPct": 2, "qPct": 2},
        "pn": {"on": False, "levelDbc": -95, "offsetHz": 1e5, "loopBwHz": 1e4},
        "pa": {"on": False, "model": "saleh", "backoffDb": 8, "smoothness": 2},
        "awgn": {"on": False, "snrDb": 35},
    }
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(p.get(key), dict):
            p[key] = {**p[key], **value}
        else:
            p[key] = value
    return p


CASES = {
    "ideal_16qam": base_params(),
    "ideal_qpsk": base_params(modulation="QPSK"),
    "ideal_64qam": base_params(modulation="64QAM"),
    "awgn_20db": base_params(awgn={"on": True, "snrDb": 20}),
    "awgn_30db": base_params(awgn={"on": True, "snrDb": 30}),
    "awgn_35db": base_params(awgn={"on": True, "snrDb": 35}),
    "iq_imbalance": base_params(iq={"on": True, "gainDb": 1.0, "phaseDeg": 5.0}),
    "dc_offset": base_params(dc={"on": True, "iPct": 10, "qPct": 0}),
    "phase_noise": base_params(pn={"on": True, "levelDbc": -90}),
    "pa_saleh_6db": base_params(pa={"on": True, "model": "saleh", "backoffDb": 6}),
    "pa_rapp_8db": base_params(pa={"on": True, "model": "rapp", "backoffDb": 8, "smoothness": 3}),
    "combined": base_params(
        iq={"on": True, "gainDb": 0.3, "phaseDeg": 2},
        pa={"on": True, "model": "rapp", "backoffDb": 8, "smoothness": 3},
        awgn={"on": True, "snrDb": 32},
    ),
}


def run_all():
    results = {}
    for name, params in CASES.items():
        res, _, _, _ = build_and_measure(params)
        results[name] = {k: round(v, 6) for k, v in res.items()}
    return results


def make_figures(out_dir="figures"):
    import os
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    os.makedirs(out_dir, exist_ok=True)
    p = base_params(awgn={"on": True, "snrDb": 30},
                    pa={"on": True, "model": "saleh", "backoffDb": 7})
    _, x, rx, sym = build_and_measure(p)
    fs = p["symbolRate"] * p["sps"]

    a = np.sum(rx * np.conj(sym[:len(rx)])) / np.sum(sym[:len(rx)] * np.conj(sym[:len(rx)]))
    norm = rx / a
    pts = constellation(p["modulation"])

    fig, ax = plt.subplots(figsize=(5.2, 5.2), dpi=150)
    ax.plot(norm.real, norm.imag, ".", ms=3, alpha=0.5, label="принятые символы")
    ax.plot(pts.real, pts.imag, "+", ms=10, mew=1.6, color="crimson", label="опорное созвездие")
    ax.set_xlabel("I, отн. ед.")
    ax.set_ylabel("Q, отн. ед.")
    ax.set_title("Диаграмма созвездия, 16-QAM")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(f"{out_dir}/constellation.png")
    plt.close(fig)

    freq, psd, _ = welch_psd(x, fs, 2048)
    psd_db = 10 * np.log10(np.maximum(psd, 1e-30))
    fig, ax = plt.subplots(figsize=(7.2, 4.2), dpi=150)
    ax.plot(freq / 1e6, psd_db - psd_db.max(), lw=1)
    ax.set_xlabel("отстройка от несущей, МГц")
    ax.set_ylabel("уровень, дБ отн. пика")
    ax.set_title("Спектр сигнала")
    ax.set_ylim(-90, 5)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(f"{out_dir}/spectrum.png")
    plt.close(fig)

    sps = p["sps"]
    start = p["span"] * sps
    fig, ax = plt.subplots(figsize=(7.2, 4.2), dpi=150)
    t = np.linspace(-1, 1, 2 * sps)
    for k in range(150):
        seg = x.real[start + k * 2 * sps: start + (k + 1) * 2 * sps]
        if len(seg) < 2 * sps:
            break
        ax.plot(t, seg, color="tab:blue", alpha=0.12, lw=1)
    ax.set_xlabel("время, символьные интервалы")
    ax.set_ylabel("амплитуда, отн. ед.")
    ax.set_title("Глазковая диаграмма, синфазный канал")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(f"{out_dir}/eye.png")
    plt.close(fig)

    return out_dir


def main():
    if "--figures" in sys.argv:
        path = make_figures()
        print(f"Рисунки сохранены в каталог {path}")
        return

    results = run_all()

    if "--json" in sys.argv:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    print(f"{'Режим':<16}{'EVM, %':>10}{'EVM пик, %':>13}{'MER, дБ':>10}"
          f"{'ACPR, дБн':>12}{'Пик-фактор':>12}")
    print("-" * 73)
    for name, r in results.items():
        print(f"{name:<16}{r['evmRmsPct']:>10.3f}{r['evmPeakPct']:>13.3f}"
              f"{r['merDb']:>10.2f}{r['acprDb']:>12.2f}{r['paprDb']:>12.2f}")

    print()
    for snr in (20, 30, 35):
        theory = 100 / math.sqrt(10 ** (snr / 10))
        got = results[f"awgn_{snr}db"]["evmRmsPct"]
        print(f"AWGN {snr} дБ: расчёт {got:.3f} %, теория {theory:.3f} %, "
              f"отклонение {abs(got - theory) / theory * 100:.2f} %")


if __name__ == "__main__":
    main()
