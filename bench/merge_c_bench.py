"""Merge C-level benchmarks (OpenSSL 3.0.13 `openssl speed`, liboqs 0.14.0 `speed_sig`) into results/crypto.json."""
import json, re
cr = json.load(open("results/crypto.json"))
c = {}
# OpenSSL speed -seconds 3 (sign/s, verify/s) recorded from the run log
c["ECDSA P-256"] = {"sign_us": 1e6/36467.9, "verify_us": 1e6/12085.5, "pk_bytes": 64, "sig_bytes": 64, "level": "classical", "pq": False}
c["Ed25519"] = {"sign_us": 1e6/14948.1, "verify_us": 1e6/7487.2, "pk_bytes": 32, "sig_bytes": 64, "level": "classical", "pq": False}
sizes = {"ML-DSA-44": (1312, 2420, 2), "ML-DSA-65": (1952, 3309, 3), "ML-DSA-87": (2592, 4627, 5), "SPHINCS+-SHA2-128f-simple": (32, 17088, 1)}
cur = None
for line in open("results/liboqs_speed.txt"):
    if line.startswith("== "): cur = line[3:].strip(); c[cur] = {}; continue
    parts = [x.strip() for x in line.split("|")]
    if len(parts) >= 5 and parts[0] in ("keypair", "sign", "verify"):
        c[cur][parts[0] + "_us"] = float(parts[3]); c[cur][parts[0] + "_us_sd"] = float(parts[4])
for k, (pk, sg, lvl) in sizes.items(): c[k].update(pk_bytes=pk, sig_bytes=sg, level=f"NIST level {lvl}", pq=True)
cr["c_level"] = c
cr["c_level_env"] = {"openssl": "3.0.13", "liboqs": "0.14.0 (AVX2/AVX-512 SHA-3 enabled)", "cpu": "Intel Xeon @ 2.80 GHz, 2 vCPU, 8 GB RAM (cloud VM)"}
json.dump(cr, open("results/crypto.json", "w"), indent=2)
for k, v in c.items(): print(k, {a: round(b, 1) if isinstance(b, float) else b for a, b in v.items()})
