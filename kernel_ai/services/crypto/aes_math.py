"""Real AES-128 internals for educational visualisation.

This module computes the *actual* mathematics of the AES block cipher on
demonstration vectors (a fixed demo key + plaintext that we choose ourselves).
Nothing here touches the production server's secret keys or live traffic -- it is
the cryptographic equivalent of visualising a neural network's layer activations
on a sample input.

What is computed (all real, deterministic):
  * AES S-box and its Linear Approximation Table (LAT) via a fast Walsh-Hadamard
    transform -> real bias values (AES S-box max |bias| = 16/256 = 0.0625).
  * Difference Distribution Table (DDT) -> real differential probabilities
    (AES S-box max = 4/256).
  * Avalanche / diffusion: flip one plaintext bit, run the real AES-128 rounds and
    measure how the 128-bit state diverges round by round (-> ~50% after ~2 rounds).
  * A per-round bit-dependency map (which input byte influences which output byte).
  * A self-contained single-S-box linear key-recovery demo on a key we own, showing
    the true key emerging as rank #1 (analogous to a training-convergence curve).

Verified against FIPS-197: key 000102..0f, pt 00112233..eeff -> 69c4e0d8..c55a.
"""

from __future__ import annotations

DEMO_KEY_HEX = "000102030405060708090a0b0c0d0e0f"
DEMO_PT_HEX = "00112233445566778899aabbccddeeff"
DEMO_SECRET_KEY_BYTE = 0x53

# ---------------------------------------------------------------------------
# AES S-box (FIPS-197)
# ---------------------------------------------------------------------------
SBOX = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]

RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]

_POPCOUNT = [bin(i).count("1") for i in range(256)]


def _parity(v):
    return _POPCOUNT[v & 0xFF] & 1


def _xtime(a):
    a <<= 1
    if a & 0x100:
        a ^= 0x11B
    return a & 0xFF


def _gmul(a, b):
    result = 0
    for _ in range(8):
        if b & 1:
            result ^= a
        b >>= 1
        a = _xtime(a)
    return result & 0xFF


# ---------------------------------------------------------------------------
# AES-128 key schedule + encryption with per-round state capture
# ---------------------------------------------------------------------------
def _key_expansion(key):
    """Return 11 round keys (each a list of 16 bytes)."""
    words = [list(key[4 * i:4 * i + 4]) for i in range(4)]
    for i in range(4, 44):
        temp = list(words[i - 1])
        if i % 4 == 0:
            temp = temp[1:] + temp[:1]  # RotWord
            temp = [SBOX[b] for b in temp]  # SubWord
            temp[0] ^= RCON[i // 4 - 1]
        words.append([words[i - 4][j] ^ temp[j] for j in range(4)])
    round_keys = []
    for r in range(11):
        rk = []
        for c in range(4):
            rk.extend(words[4 * r + c])
        round_keys.append(rk)
    return round_keys


def _add_round_key(state, rk):
    return [state[i] ^ rk[i] for i in range(16)]


def _sub_bytes(state):
    return [SBOX[b] for b in state]


def _shift_rows(state):
    # state index = row + 4*col ; shift row r left by r
    out = [0] * 16
    for r in range(4):
        for c in range(4):
            out[r + 4 * c] = state[r + 4 * ((c + r) % 4)]
    return out


def _mix_columns(state):
    out = [0] * 16
    for c in range(4):
        col = state[4 * c:4 * c + 4]
        out[4 * c + 0] = _gmul(col[0], 2) ^ _gmul(col[1], 3) ^ col[2] ^ col[3]
        out[4 * c + 1] = col[0] ^ _gmul(col[1], 2) ^ _gmul(col[2], 3) ^ col[3]
        out[4 * c + 2] = col[0] ^ col[1] ^ _gmul(col[2], 2) ^ _gmul(col[3], 3)
        out[4 * c + 3] = _gmul(col[0], 3) ^ col[1] ^ col[2] ^ _gmul(col[3], 2)
    return out


def _to_state(block16):
    # AES is column-major: state[r + 4c] = input[r + 4c] (input already byte order)
    return list(block16)


def encrypt_capture(pt, round_keys):
    """Encrypt a 16-byte block, returning the state after each AddRoundKey.

    Returns a list of 11 states (state[0] = after initial AddRoundKey, state[r] =
    after round r), each a list of 16 ints.
    """
    states = []
    state = _add_round_key(_to_state(pt), round_keys[0])
    states.append(list(state))
    for r in range(1, 10):
        state = _sub_bytes(state)
        state = _shift_rows(state)
        state = _mix_columns(state)
        state = _add_round_key(state, round_keys[r])
        states.append(list(state))
    state = _sub_bytes(state)
    state = _shift_rows(state)
    state = _add_round_key(state, round_keys[10])
    states.append(list(state))
    return states


def aes128_encrypt_block(pt, key):
    return bytes(encrypt_capture(list(pt), _key_expansion(list(key)))[-1])


# ---------------------------------------------------------------------------
# Linear Approximation Table (LAT) via fast Walsh-Hadamard transform
# ---------------------------------------------------------------------------
def _fwht(arr):
    n = len(arr)
    h = 1
    while h < n:
        for i in range(0, n, h * 2):
            for j in range(i, i + h):
                x = arr[j]
                y = arr[j + h]
                arr[j] = x + y
                arr[j + h] = x - y
        h *= 2
    return arr


def compute_lat():
    """Full 256x256 signed LAT of the AES S-box. LAT[a][b] in [-128, 128]."""
    lat = [[0] * 256 for _ in range(256)]
    for b in range(256):
        t = [1 - 2 * (_POPCOUNT[SBOX[x] & b] & 1) for x in range(256)]
        _fwht(t)  # t[a] = sum_x (-1)^{a.x} (-1)^{b.S(x)}
        for a in range(256):
            lat[a][b] = t[a] // 2
    return lat


def compute_ddt():
    """Full 256x256 DDT of the AES S-box. DDT[dx][dy] = count of x."""
    ddt = [[0] * 256 for _ in range(256)]
    for dx in range(256):
        for x in range(256):
            dy = SBOX[x] ^ SBOX[x ^ dx]
            ddt[dx][dy] += 1
    return ddt


# ---------------------------------------------------------------------------
# Cached static artefacts (LAT / DDT depend only on the S-box)
# ---------------------------------------------------------------------------
_CACHE = {}


def _lat():
    if "lat" not in _CACHE:
        _CACHE["lat"] = compute_lat()
    return _CACHE["lat"]


def _ddt():
    if "ddt" not in _CACHE:
        _CACHE["ddt"] = compute_ddt()
    return _CACHE["ddt"]


def _lat_summary():
    lat = _lat()
    top = []
    hist = {}
    max_abs = 0
    for a in range(1, 256):
        row = lat[a]
        for b in range(1, 256):
            v = row[b]
            av = abs(v)
            if av:
                hist[av] = hist.get(av, 0) + 1
            if av > max_abs:
                max_abs = av
            if av >= 12:
                top.append({"in_mask": a, "out_mask": b, "lat": v,
                            "bias": round(v / 256.0, 6), "correlation": round(2 * v / 256.0, 6)})
    top.sort(key=lambda r: abs(r["lat"]), reverse=True)
    # Downsample |LAT| into a 16x16 heat for the correlation panel.
    heat = [[0.0] * 16 for _ in range(16)]
    for gi in range(16):
        for gj in range(16):
            acc = 0
            for a in range(gi * 16, gi * 16 + 16):
                for b in range(gj * 16, gj * 16 + 16):
                    acc += abs(lat[a][b])
            heat[gi][gj] = round(acc / 256.0, 3)
    return {
        "max_abs_lat": max_abs,
        "max_bias": round(max_abs / 256.0, 6),
        "max_correlation": round(2 * max_abs / 256.0, 6),
        "histogram": {str(k): hist[k] for k in sorted(hist)},
        "top": top[:14],
        "heat16": heat,
    }


def _ddt_summary():
    ddt = _ddt()
    top = []
    max_prob = 0
    for dx in range(1, 256):
        for dy in range(256):
            c = ddt[dx][dy]
            if c > max_prob:
                max_prob = c
            if c >= 4:
                top.append({"in_diff": dx, "out_diff": dy, "count": c, "prob": round(c / 256.0, 6)})
    top.sort(key=lambda r: r["count"], reverse=True)
    return {
        "max_count": max_prob,
        "max_prob": round(max_prob / 256.0, 6),
        "top": top[:14],
    }


# ---------------------------------------------------------------------------
# Avalanche + per-round bit-dependency (diffusion)
# ---------------------------------------------------------------------------
def _flip_bit(block, bit_index):
    out = list(block)
    byte_i = bit_index // 8
    bit_in_byte = 7 - (bit_index % 8)
    out[byte_i] ^= (1 << bit_in_byte)
    return out


def _hamming_block(a, b):
    return sum(_POPCOUNT[a[i] ^ b[i]] for i in range(16))


def compute_diffusion(pt, key, flip_bit=0):
    round_keys = _key_expansion(list(key))
    base_states = encrypt_capture(list(pt), round_keys)  # 11 states
    n_rounds = len(base_states)

    # Single-bit avalanche trace for the chosen flip_bit.
    flipped_states = encrypt_capture(_flip_bit(pt, flip_bit), round_keys)
    curve = []
    grids = []
    for r in range(n_rounds):
        diff_bytes = [_POPCOUNT[base_states[r][i] ^ flipped_states[r][i]] for i in range(16)]
        curve.append(_hamming_block(base_states[r], flipped_states[r]))
        grids.append(diff_bytes)

    # Average diffusion over all 128 single-bit input flips + 8x8 dependency layers.
    avg_per_round = [0] * n_rounds
    # layers[r][gi][gj] = influence of input byte-group gi on output byte-group gj (8 groups of 2 bytes)
    layers = [[[0] * 8 for _ in range(8)] for _ in range(n_rounds)]
    for bit in range(128):
        fs = encrypt_capture(_flip_bit(pt, bit), round_keys)
        gi = (bit // 8) // 2  # input byte-group (0..7)
        for r in range(n_rounds):
            hd = 0
            for byte_i in range(16):
                pc = _POPCOUNT[base_states[r][byte_i] ^ fs[r][byte_i]]
                hd += pc
                if pc:
                    layers[r][gi][byte_i // 2] += pc
            avg_per_round[r] += hd

    avg_curve = [round(avg_per_round[r] / 128.0, 2) for r in range(n_rounds)]
    # Normalise layers to 0..1 per round.
    norm_layers = []
    for r in range(n_rounds):
        mx = max((max(row) for row in layers[r]), default=0) or 1
        norm_layers.append([[round(layers[r][i][j] / mx, 3) for j in range(8)] for i in range(8)])

    return {
        "flip_bit": flip_bit,
        "rounds": n_rounds,
        "avalanche_curve": curve,             # bits changed for the single demo flip
        "avalanche_grids": grids,             # per-round 16-byte diff popcounts (4x4)
        "avg_curve": avg_curve,               # avg bits changed over all 128 input flips
        "avg_curve_pct": [round(100.0 * v / 128.0, 1) for v in avg_curve],
        "dependency_layers": norm_layers,     # per-round 8x8 input->output byte-group influence
    }


# ---------------------------------------------------------------------------
# Self-contained single-S-box linear key-recovery demo (key we own)
# ---------------------------------------------------------------------------
def compute_key_recovery(secret_key_byte=DEMO_SECRET_KEY_BYTE):
    """Matsui-style last-round key recovery on a real 2-S-box toy cipher.

    Toy cipher (a cipher we define, keys we own):
        u = S(p ^ K)          # K is the secret target byte
        c = S(u ^ q)          # q is a per-message known tweak/nonce (like an IV)
    The attacker observes (p, q, c) and guesses g for K. It partially "encrypts"
    the first layer with the guess, u_g = S(p ^ g), then tests a high-bias linear
    approximation over the *second* S-box. Only the correct guess makes u_g equal
    the real intermediate, so the approximation holds with the S-box's real bias;
    wrong guesses pass through the S-box nonlinearity and, thanks to the random
    per-message q, decorrelate to mean-zero noise. With enough messages the true
    key therefore converges to rank #1 -- the genuine mechanism of linear
    cryptanalysis, shown as a convergence curve.
    """
    lat = _lat()
    # Best non-trivial linear approximation of the S-box.
    best_a = best_b = 1
    best_v = 0
    for a in range(1, 256):
        for b in range(1, 256):
            if abs(lat[a][b]) > abs(best_v):
                best_v = lat[a][b]
                best_a, best_b = a, b

    def rank_at(samples):
        counts = [0] * 256
        for p, q in samples:
            u = SBOX[p ^ secret_key_byte]
            c = SBOX[u ^ q]
            for g in range(256):
                u_g = SBOX[p ^ g]
                if (_parity(best_a & (u_g ^ q)) ^ _parity(best_b & c)) == 0:
                    counts[g] += 1
        n = len(samples)
        scored = [(g, counts[g] - n / 2.0) for g in range(256)]
        scored.sort(key=lambda t: abs(t[1]), reverse=True)
        order = [g for g, _ in scored]
        true_rank = order.index(secret_key_byte) + 1
        return scored, true_rank, n

    # Deterministic pseudo-random message stream of (plaintext, tweak) pairs.
    seed = 0x1234ABCD

    def _next_byte():
        nonlocal seed
        seed = (1103515245 * seed + 12345) & 0x7FFFFFFF
        return (seed >> 16) & 0xFF

    stream = []
    convergence = []
    schedule = (64, 128, 256, 512, 1024, 2048, 4096)
    for target_n in schedule:
        while len(stream) < target_n:
            stream.append((_next_byte(), _next_byte()))
        scored_n, rnk, _ = rank_at(stream[:target_n])
        convergence.append({"n": target_n, "true_rank": rnk})

    # Final ranking at the largest sample size (strongest signal).
    full_scored = scored_n
    n_final = schedule[-1]
    ranking = [{"guess": g, "corr": round(2 * s / n_final, 5), "score": s} for g, s in full_scored[:24]]
    full_rank = ranking and convergence[-1]["true_rank"]

    return {
        "true_key": secret_key_byte,
        "true_key_hex": f"0x{secret_key_byte:02x}",
        "mask_in": best_a,
        "mask_out": best_b,
        "approx_bias": round(best_v / 256.0, 6),
        "approx_correlation": round(2 * best_v / 256.0, 6),
        "true_rank": full_rank,
        "ranking": ranking,
        "convergence": convergence,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def build_aes_demo(pt_hex=DEMO_PT_HEX, key_hex=DEMO_KEY_HEX, flip_bit=0):
    """Assemble the full real-AES visualisation payload (cached where static)."""
    pt = bytes.fromhex(pt_hex)
    key = bytes.fromhex(key_hex)
    round_keys = _key_expansion(list(key))
    ct_states = encrypt_capture(list(pt), round_keys)
    ciphertext = bytes(ct_states[-1])

    if "lat_summary" not in _CACHE:
        _CACHE["lat_summary"] = _lat_summary()
    if "ddt_summary" not in _CACHE:
        _CACHE["ddt_summary"] = _ddt_summary()
    if "key_recovery" not in _CACHE:
        _CACHE["key_recovery"] = compute_key_recovery()

    diffusion = compute_diffusion(pt, key, flip_bit=flip_bit)

    return {
        "algorithm": "AES-128",
        "rounds": 10,
        "source": "reference-computation",
        "demo_vectors": {
            "key": key_hex,
            "plaintext": pt_hex,
            "ciphertext": ciphertext.hex(),
        },
        "sbox": SBOX,
        "round_states": [list(s) for s in ct_states],
        "lat": _CACHE["lat_summary"],
        "ddt": _CACHE["ddt_summary"],
        "diffusion": diffusion,
        "key_recovery": _CACHE["key_recovery"],
    }
