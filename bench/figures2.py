"""Additional figures for manuscript v2: baselines/operating points, testbed results, PQ on MCU."""
import json, numpy as np, matplotlib, collections
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#6b6a66", "xtick.color": "#52514e", "ytick.color": "#52514e", "axes.grid": True,
                     "grid.color": "#e6e5e0", "grid.linewidth": 0.6, "axes.axisbelow": True, "legend.frameon": False,
                     "savefig.dpi": 300, "savefig.bbox": "tight"})
C1, C2, C3, C4, GR = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#8a8984"
gas = json.load(open("results/gas.json")); g2 = json.load(open("results/gas2.json"))
S = gas["summary"]; GA = gas["anchorVsBatch"][-1]["gas"]

# ---------- Fig: per-reading cost vs batch size, with stronger baselines and operating points ----------
fig, (ax, bx) = plt.subplots(1, 2, figsize=(7.2, 3.3), gridspec_kw={"width_ratios": [1.7, 1]})
n = np.logspace(np.log10(16), np.log10(65536), 60)
ax.loglog(n, GA / n, "-", color=C1, lw=2.2, label="Merkle anchoring (this work)")
bh = g2["batchHashLog"]; xb = [r["leaves"] for r in bh]; yb = [r["gasPerReading"] for r in bh]
ax.loglog(xb, yb, "s--", color=C4, lw=1.8, ms=4, label="BatchHashLog (all hashes in one tx)")
dh = g2["deviceHashChains"]
# per-device chains: one gateway tx per period; per-reading cost = steady gas per device / readings per device per period
per_dev = np.mean([r["steadyPerDevice"] for r in dh[1:]])
ax.axhline(per_dev, color=GR, lw=1.8, ls="-."); ax.text(20, per_dev * 0.55, f"DeviceHashChains (≈{per_dev/1000:.1f} kgas per device update)", fontsize=7)
ax.axhline(S["naive store (per reading)"]["mean"], color=C2, lw=1.8, ls="--"); ax.text(20, S["naive store (per reading)"]["mean"] * 1.25, "Per-reading storage", fontsize=7)
ax.axhline(S["naive event log (per reading)"]["mean"], color=C3, lw=1.8, ls=":"); ax.text(20, S["naive event log (per reading)"]["mean"] * 1.12, "Per-reading event log", fontsize=7)
for leaves, lab in [(1000*60/900, "T=60 s"), (1000*300/900, "T=300 s"), (1000.0, "T=900 s")]:
    ax.plot([leaves], [GA / leaves], "o", color=C1, ms=7, mec="white", mew=1.5, zorder=5)
    ax.annotate(f"{lab}\n{GA/leaves:,.0f} gas", (leaves, GA / leaves), textcoords="offset points", xytext=(-8, -26), ha="right", fontsize=7)
ax.set_ylabel("On-chain gas per reading"); ax.set_ylim(0.5, 2e5)
ax.legend(loc="lower left", fontsize=7.2); ax.set_title("(a) Gas per reading vs. batch size", fontsize=9, loc="left")
ax.set_xlabel("Readings per batch n = k·T/Δ (markers: k = 1,000, Δ = 900 s)", fontsize=8)
dv = gas["disputeVsDepth"]
bx.plot([r["depth"] for r in dv], [r["gas"] / 1000 for r in dv], "-o", color=C1, lw=2, ms=4)
bx.set_xticks([4, 8, 12, 16, 20]); bx.set_ylim(0, 50); bx.set_xlabel("Merkle tree depth (log2 batch size)", fontsize=8)
bx.set_ylabel("Gas per on-chain dispute check (k)"); bx.set_title("(b) Dispute verification", fontsize=9, loc="left")
fig.tight_layout(); fig.savefig("figs/fig_baselines.png"); plt.close(fig)

# ---------- Fig: testbed ----------
runs = [json.loads(l) for l in open("results/besu_runs.jsonl")]
agg = collections.defaultdict(list)
for r in runs: agg[(r["mode"], r["offered_tps"])].append(r)
fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.9))
for mode, c, mk, lab in [("log", C3, "o", "Per-reading event log"), ("store", C2, "s", "Per-reading storage"), ("anchor", C1, "D", "Anchor transactions")]:
    ks = sorted(k for k in agg if k[0] == mode)
    if not ks: continue
    x = [k[1] for k in ks]
    ya = [np.mean([r["achieved_tps"] for r in agg[k]]) for k in ks]
    ea = [np.ptp([r["achieved_tps"] for r in agg[k]]) / 2 if len(agg[k]) > 1 else 0 for k in ks]
    yl = [np.mean([r["latency_median_s"] for r in agg[k]]) for k in ks]
    el = [np.ptp([r["latency_median_s"] for r in agg[k]]) / 2 if len(agg[k]) > 1 else 0 for k in ks]
    a.errorbar(x, ya, yerr=ea, fmt=mk + "-", color=c, lw=1.8, ms=4.5, capsize=2, label=lab)
    b.errorbar(x, yl, yerr=el, fmt=mk + "-", color=c, lw=1.8, ms=4.5, capsize=2, label=lab)
lim = max(k[1] for k in agg) * 1.05
a.plot([0, lim], [0, lim], color=GR, lw=1, ls=(0, (2, 2))); a.text(lim * 0.70, lim * 0.62, "achieved = offered", fontsize=7, color="#52514e", rotation=33)
a.set_xlabel("Offered load (tx/s)"); a.set_ylabel("Achieved throughput (tx/s)"); a.set_title("(a) Throughput", fontsize=9, loc="left"); a.legend(fontsize=7.2, loc="upper left")
b.set_yscale("log"); b.set_xlabel("Offered load (tx/s)"); b.set_ylabel("Median submit-to-inclusion latency (s, log)"); b.set_title("(b) Latency", fontsize=9, loc="left")
fig.tight_layout(); fig.savefig("figs/fig_testbed.png"); plt.close(fig)
print("ok")
