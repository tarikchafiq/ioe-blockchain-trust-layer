"""Edge-layer cryptographic micro-benchmarks (gateway-class CPU).
Measures per-reading signing/verification cost for classical and post-quantum (FIPS 204/205)
signatures, hashing, and Merkle-batch construction. Output: results/crypto.json
"""
import json, os, platform, statistics, time, hashlib, hmac
from cryptography.hazmat.primitives.asymmetric import ed25519, ec
from cryptography.hazmat.primitives import hashes
from Crypto.Hash import keccak
import pqcrypto

def timeit(fn, reps):
    ts = []
    for _ in range(reps):
        t0 = time.perf_counter_ns(); fn(); ts.append(time.perf_counter_ns() - t0)
    ts.sort()
    return {"median_us": statistics.median(ts) / 1e3, "p95_us": ts[int(0.95 * len(ts)) - 1] / 1e3, "reps": reps}

MSG = b"did:ioe:meter-000123|ts=1760520000|Wh=001234567|seq=00000042"  # 64-byte canonical reading
out = {"env": {"python": platform.python_version(), "cpu": platform.processor() or "x86_64", "machine": platform.machine(),
               "cryptography": __import__("cryptography").__version__, "pqcrypto": getattr(pqcrypto, "__version__", "1.0.0")},
       "signatures": {}, "hash": {}, "merkle": []}

# Classical
sk = ed25519.Ed25519PrivateKey.generate(); pk = sk.public_key(); sig = sk.sign(MSG)
out["signatures"]["Ed25519"] = {"sign": timeit(lambda: sk.sign(MSG), 3000), "verify": timeit(lambda: pk.verify(sig, MSG), 3000),
                                "pk_bytes": 32, "sig_bytes": len(sig), "nist_level": "classical (~128-bit)", "pq_secure": False}
esk = ec.generate_private_key(ec.SECP256R1()); epk = esk.public_key(); esig = esk.sign(MSG, ec.ECDSA(hashes.SHA256()))
out["signatures"]["ECDSA P-256"] = {"sign": timeit(lambda: esk.sign(MSG, ec.ECDSA(hashes.SHA256())), 3000),
                                    "verify": timeit(lambda: epk.verify(esig, MSG, ec.ECDSA(hashes.SHA256())), 3000),
                                    "pk_bytes": 64, "sig_bytes": 64, "sig_bytes_der": len(esig), "nist_level": "classical (~128-bit)", "pq_secure": False}
# Symmetric baseline for constrained devices (pre-shared key with gateway)
key = os.urandom(32)
out["signatures"]["HMAC-SHA256 (symmetric)"] = {"sign": timeit(lambda: hmac.new(key, MSG, hashlib.sha256).digest(), 5000),
                                                "verify": timeit(lambda: hmac.compare_digest(hmac.new(key, MSG, hashlib.sha256).digest(), b"0"*32), 5000),
                                                "pk_bytes": 0, "sig_bytes": 32, "nist_level": "symmetric 256-bit key", "pq_secure": True}
# Post-quantum (FIPS 204 ML-DSA, FIPS 205 SLH-DSA)
import importlib
for name, mod, reps, lvl in [("ML-DSA-44", "ml_dsa_44", 1000, 2), ("ML-DSA-65", "ml_dsa_65", 1000, 3), ("ML-DSA-87", "ml_dsa_87", 600, 5),
                             ("SLH-DSA-SHA2-128f", "slh_dsa_sha2_128f", 60, 1), ("SLH-DSA-SHA2-128s", "slh_dsa_sha2_128s", 10, 1)]:
    m = importlib.import_module("pqcrypto.sign." + mod)
    p, s = m.keygen(); sg = m.sign(s, MSG)
    out["signatures"][name] = {"sign": timeit(lambda: m.sign(s, MSG), reps), "verify": timeit(lambda: m.verify(p, MSG, sg), max(reps, 200)),
                               "pk_bytes": len(p), "sig_bytes": len(sg), "nist_level": lvl, "pq_secure": True}

# Hashing per reading
out["hash"]["SHA-256"] = timeit(lambda: hashlib.sha256(MSG).digest(), 20000)
out["hash"]["SHA3-256"] = timeit(lambda: hashlib.sha3_256(MSG).digest(), 20000)
out["hash"]["Keccak-256"] = timeit(lambda: keccak.new(digest_bits=256, data=MSG).digest(), 20000)

# Gateway-side Merkle batch construction (sorted-pair Keccak-256, as on-chain)
def kh(b): return keccak.new(digest_bits=256, data=b).digest()
def build(leaves):
    layer = leaves
    while len(layer) > 1:
        nxt = []
        for i in range(0, len(layer), 2):
            if i + 1 < len(layer):
                a, b = layer[i], layer[i + 1]
                nxt.append(kh(a + b) if a < b else kh(b + a))
            else:
                nxt.append(layer[i])
        layer = nxt
    return layer[0]
for n in [256, 1024, 4096, 16384, 65536]:
    leaves = [kh(MSG + i.to_bytes(4, "big")) for i in range(n)]
    reps = 7 if n <= 4096 else 3
    r = timeit(lambda: build(leaves), reps)
    out["merkle"].append({"leaves": n, "build_ms": r["median_us"] / 1e3})

os.makedirs("results", exist_ok=True)
json.dump(out, open("results/crypto.json", "w"), indent=2)
for k, v in out["signatures"].items():
    print(f"{k:26s} sign {v['sign']['median_us']:9.1f} us  verify {v['verify']['median_us']:8.1f} us  pk {v['pk_bytes']:5d} B  sig {v['sig_bytes']:6d} B")
print(out["hash"]); print(out["merkle"])
