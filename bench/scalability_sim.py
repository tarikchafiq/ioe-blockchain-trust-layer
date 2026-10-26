"""Scalability and latency evaluation of per-reading on-chain logging vs. edge-batched Merkle anchoring.
Gas figures are taken from results/gas.json (measured on the EVM); Merkle build cost from results/crypto.json.
Network/consensus parameters are explicit assumptions (see PARAMS) and are varied in sensitivity runs.
Output: results/scalability.json
"""
import json, math, numpy as np

gas = json.load(open("results/gas.json"))
cr = json.load(open("results/crypto.json"))
S = gas["summary"]
G_STORE = S["naive store (per reading)"]["mean"]
G_LOG = S["naive event log (per reading)"]["mean"]
G_ANCHOR = gas["anchorVsBatch"][-1]["gas"]           # steady-state anchor cost (independent of batch size)

# Merkle build time per leaf (gateway), linear fit of measured Python/pycryptodome Keccak values (conservative)
mk = cr["merkle"]; per_leaf_ms = np.polyfit([m["leaves"] for m in mk], [m["build_ms"] for m in mk], 1)[0]

PARAMS = dict(block_gas_limit=30_000_000, block_time_s=2.0, fan_in=1000, net_median_s=0.05, net_sigma=0.6)

def capacity_gas_per_s(p=PARAMS): return p["block_gas_limit"] / p["block_time_s"]

def onchain_rate(N, delta, mode, T=None, p=PARAMS):
    if mode == "store": return N / delta * G_STORE
    if mode == "log": return N / delta * G_LOG
    G = math.ceil(N / p["fan_in"]); return G / T * G_ANCHOR

def max_devices(delta, mode, T=None, p=PARAMS):
    cap = capacity_gas_per_s(p)
    if mode == "store": return cap * delta / G_STORE
    if mode == "log": return cap * delta / G_LOG
    return cap * T / G_ANCHOR * p["fan_in"]

def block_sim(lam_tx_s, gas_per_tx, horizon_s=3600, p=PARAMS, rng=None):
    """Block-level FIFO simulation; returns latency samples (s) of txs submitted in the 2nd half of the horizon."""
    rng = rng or np.random.default_rng(1)
    B = p["block_time_s"]; cap = int(p["block_gas_limit"] // gas_per_tx)
    nblocks = int(horizon_s / B); queue = []  # list of [t_arrival_array]
    lat = []; backlog = 0; pending = np.empty(0)
    for b in range(nblocks):
        t0 = b * B
        k = rng.poisson(lam_tx_s * B)
        arr = t0 + np.sort(rng.uniform(0, B, k)) + rng.lognormal(math.log(p["net_median_s"]), p["net_sigma"], k)
        pending = np.concatenate([pending, arr])
        t_block = t0 + B
        ready = pending[pending <= t_block]; notready = pending[pending > t_block]
        take = ready[:cap]; rest = ready[cap:]
        if t0 >= horizon_s / 2: lat.extend((t_block - take).tolist())
        pending = np.concatenate([rest, notready])
    return np.array(lat), len(pending)

def anchored_latency(T, delta, n=200_000, p=PARAMS, rng=None):
    """Reading-to-finality latency of the integrity proof under batching."""
    rng = rng or np.random.default_rng(2)
    leaves = p["fan_in"] * T / delta
    build = per_leaf_ms * leaves / 1e3
    W = rng.uniform(0, T, n)
    net = rng.lognormal(math.log(p["net_median_s"]), p["net_sigma"], n)
    incl = rng.uniform(0, p["block_time_s"], n)
    return W + build + net + incl

out = {"inputs": {"G_store": G_STORE, "G_log": G_LOG, "G_anchor": G_ANCHOR, "merkle_ms_per_leaf": per_leaf_ms, **PARAMS},
       "max_devices": {}, "utilisation": [], "latency": {}, "block_sim": [], "sensitivity": []}

for delta in (900, 60):
    out["max_devices"][str(delta)] = {"store": max_devices(delta, "store"), "log": max_devices(delta, "log"),
                                      **{f"anchor_T{T}": max_devices(delta, "anchor", T) for T in (60, 300, 900)}}

cap = capacity_gas_per_s()
for N in [1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6, 3e6, 1e7]:
    row = {"N": N}
    for delta in (900, 60):
        row[f"store_{delta}"] = onchain_rate(N, delta, "store") / cap
        row[f"log_{delta}"] = onchain_rate(N, delta, "log") / cap
        row[f"anchor300_{delta}"] = onchain_rate(N, delta, "anchor", 300) / cap
    out["utilisation"].append(row)

for T in (60, 300, 900):
    L = anchored_latency(T, 900)
    out["latency"][f"anchor_T{T}"] = {"median": float(np.median(L)), "p95": float(np.percentile(L, 95)), "p99": float(np.percentile(L, 99)),
                                      "cdf_x": np.percentile(L, np.linspace(0, 100, 101)).tolist()}

# Confirmation latency vs. N under per-reading on-chain logging (block-level queueing), delta = 900 s
for N in [1e4, 1e5, 2e5, 4e5, 5e5, 6e5, 1e6]:
    lam = N / 900
    Ls, backlog = block_sim(lam, G_LOG)
    Lst, backlog_s = block_sim(lam, G_STORE)
    G = math.ceil(N / PARAMS["fan_in"])
    La, backlog_a = block_sim(G / 300, G_ANCHOR)
    out["block_sim"].append({"N": N,
        "log_median": float(np.median(Ls)) if len(Ls) else None, "log_p95": float(np.percentile(Ls, 95)) if len(Ls) else None, "log_backlog": backlog,
        "store_median": float(np.median(Lst)) if len(Lst) else None, "store_p95": float(np.percentile(Lst, 95)) if len(Lst) else None, "store_backlog": backlog_s,
        "anchor_tx_median": float(np.median(La)) if len(La) else None, "anchor_tx_p95": float(np.percentile(La, 95)) if len(La) else None, "anchor_backlog": backlog_a})

# Sensitivity: block time and fan-in
for bt in (1.0, 2.0, 5.0, 12.0):
    for fan in (100, 1000, 5000):
        p = dict(PARAMS, block_time_s=bt, fan_in=fan)
        out["sensitivity"].append({"block_time_s": bt, "fan_in": fan,
            "max_devices_log_900": max_devices(900, "log", p=p), "max_devices_anchor300_900": max_devices(900, "anchor", 300, p=p)})

json.dump(out, open("results/scalability.json", "w"), indent=2)
print(json.dumps(out["inputs"], indent=1))
print(json.dumps(out["max_devices"], indent=1))
for k, v in out["latency"].items(): print(k, {a: round(b, 1) for a, b in v.items() if a != "cdf_x"})
for r in out["block_sim"]: print({k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()})
