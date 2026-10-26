"""Publication figures (300 dpi PNG) from measured results."""
import json, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#6b6a66", "axes.labelcolor": "#0b0b0b", "xtick.color": "#52514e", "ytick.color": "#52514e",
                     "axes.grid": True, "grid.color": "#e6e5e0", "grid.linewidth": 0.6, "axes.axisbelow": True,
                     "legend.frameon": False, "savefig.dpi": 300, "savefig.bbox": "tight"})
C1, C2, C3, C4, GR = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#8a8984"
gas = json.load(open("results/gas.json")); cr = json.load(open("results/crypto.json")); sc = json.load(open("results/scalability.json"))
OUT = "figs/"
import os; os.makedirs(OUT, exist_ok=True)

# ---------- Fig: gas per operation ----------
S = gas["summary"]
groups = [("Identity", C1, ["registerDevice", "rotateKey", "revokeDevice"]),
          ("Access control", C2, ["grantPolicy", "revokePolicy", "requestAccess (granted)", "requestAccess (denied)"]),
          ("Provenance", C3, ["anchor"]),
          ("P2P market", C4, ["createOffer", "acceptOffer (escrow)", "settle (full)", "settle (partial+refund)", "refundExpired", "withdraw"]),
          ("Per-reading baseline", GR, ["naive store (per reading)", "naive event log (per reading)"])]
labels, vals, cols = [], [], []
for g, c, ks in groups:
    for k in ks: labels.append(k); vals.append(S[k]["mean"]); cols.append(c)
fig, ax = plt.subplots(figsize=(6.3, 4.2))
y = np.arange(len(labels))[::-1]
ax.barh(y, [v / 1000 for v in vals], color=cols, height=0.62, edgecolor="white", linewidth=1)
for yi, v in zip(y, vals): ax.text(v / 1000 + 1.5, yi, f"{v/1000:.1f}k", va="center", fontsize=7.5, color="#52514e")
ax.set_yticks(y); ax.set_yticklabels(labels, fontsize=8)
ax.set_xlabel("Gas per transaction (thousands, mean of n runs)"); ax.grid(axis="y", visible=False)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color=c, label=g) for g, c, _ in groups], loc="lower right", fontsize=7.5)
ax.set_xlim(0, 145)
fig.savefig(OUT + "fig_gas_ops.png"); plt.close(fig)

# ---------- Fig: amortised cost & dispute ----------
fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.9))
av = gas["anchorVsBatch"]; n = [r["leaves"] for r in av]; per = [r["gas"] / r["leaves"] for r in av]
a.loglog(n, per, "-o", color=C1, lw=2, ms=4.5, label="Edge-batched Merkle anchoring")
a.axhline(S["naive store (per reading)"]["mean"], color=C2, lw=2, ls="--"); a.text(18, S["naive store (per reading)"]["mean"] * 1.25, "Per-reading on-chain storage", color="#0b0b0b", fontsize=7.5)
a.axhline(S["naive event log (per reading)"]["mean"], color=C3, lw=2, ls=":"); a.text(18, S["naive event log (per reading)"]["mean"] * 0.55, "Per-reading on-chain event log", color="#0b0b0b", fontsize=7.5)
a.text(n[-1]*1.2, per[-1]*0.42, f"{per[-1]:.2f} gas/reading at 2$^{{16}}$ readings", ha="right", fontsize=7.5); a.set_ylim(0.3, 2e5)
a.set_xlabel("Readings per anchored batch"); a.set_ylabel("On-chain gas per reading"); a.set_title("(a) Amortised integrity cost", fontsize=9, loc="left")
a.text(20, 4, "Edge-batched Merkle anchoring\n(this work, measured)", color="#0b0b0b", fontsize=7.5)
dv = gas["disputeVsDepth"]
b.plot([r["depth"] for r in dv], [r["gas"] / 1000 for r in dv], "-o", color=C1, lw=2, ms=4.5)
b2x = [r["depth"] for r in dv]
b.set_xticks(b2x); b.set_xticklabels([f"{d}\n(2$^{{{d}}}$)" if d in (4, 10, 16, 20) else f"{d}" for d in b2x], fontsize=7)
b.set_xlabel("Merkle tree depth (batch size)"); b.set_ylabel("Gas per on-chain dispute check (k)"); b.set_title("(b) On-chain inclusion-proof verification", fontsize=9, loc="left")
b.set_ylim(0, 50)
fig.tight_layout(); fig.savefig(OUT + "fig_amortised.png"); plt.close(fig)

# ---------- Fig: scalability ----------
fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.9))
U = sc["utilisation"]; N = [r["N"] for r in U]
a.loglog(N, [r["store_900"] for r in U], "--", color=C2, lw=2, label="Per-reading storage")
a.loglog(N, [r["log_900"] for r in U], ":", color=C3, lw=2.2, label="Per-reading event log")
a.loglog(N, [r["anchor300_900"] for r in U], "-", color=C1, lw=2, label="Anchoring (T = 300 s)")
a.axhline(1, color="#0b0b0b", lw=1); a.text(3e6, 1.4, "capacity", fontsize=7.5, ha="center")
a.set_xlabel("Number of IoE devices (15-min readings)"); a.set_ylabel("Ledger utilisation (demand / capacity)")
a.set_title("(a) Ledger load", fontsize=9, loc="left"); a.legend(fontsize=7.5, loc="lower right")
B = sc["block_sim"]; NB = [r["N"] for r in B]
b.semilogy(NB, [r["store_median"] for r in B], "--o", color=C2, lw=2, ms=4, label="Per-reading storage")
b.semilogy(NB, [r["log_median"] for r in B], ":o", color=C3, lw=2.2, ms=4, label="Per-reading event log")
b.semilogy(NB, [r["anchor_tx_median"] for r in B], "-o", color=C1, lw=2, ms=4, label="Anchor transactions")
b.set_xscale("log"); b.set_xlabel("Number of IoE devices"); b.set_ylabel("Median confirmation latency (s)")
b.set_title("(b) Queueing at the ledger (1 h simulation)", fontsize=9, loc="left"); b.legend(fontsize=7.5, loc="upper left")
fig.tight_layout(); fig.savefig(OUT + "fig_scalability.png"); plt.close(fig)

# ---------- Fig: latency CDF ----------
fig, ax = plt.subplots(figsize=(4.6, 2.9))
for (k, c, ls) in [("anchor_T60", C1, "-"), ("anchor_T300", C2, "--"), ("anchor_T900", C3, ":")]:
    x = sc["latency"][k]["cdf_x"]; ax.plot(np.array(x), np.linspace(0, 1, 101), ls, color=c, lw=2, label=f"T = {k.split('T')[1]} s (median {sc['latency'][k]['median']:.0f} s)")
ax.set_xlim(0, 920); ax.set_ylim(0, 1.02); ax.set_xlabel("Reading-to-finality latency of the integrity proof (s)"); ax.set_ylabel("Cumulative fraction")
ax.legend(fontsize=7.5, loc="lower right"); fig.savefig(OUT + "fig_latency.png"); plt.close(fig)

# ---------- Fig: PQC ----------
c = cr["c_level"]; names = ["ECDSA P-256", "Ed25519", "ML-DSA-44", "ML-DSA-65", "ML-DSA-87", "SPHINCS+-SHA2-128f-simple"]
short = ["ECDSA\nP-256", "Ed25519", "ML-DSA\n-44", "ML-DSA\n-65", "ML-DSA\n-87", "SLH-DSA\n128f"]
fig, (a, b) = plt.subplots(1, 2, figsize=(7.0, 2.9))
x = np.arange(len(names)); w = 0.38
a.bar(x - w / 2 - 0.01, [c[k]["sign_us"] for k in names], w, color=C1, label="Sign")
a.bar(x + w / 2 + 0.01, [c[k]["verify_us"] for k in names], w, color=C2, label="Verify")
a.set_yscale("log"); a.set_xticks(x); a.set_xticklabels(short, fontsize=7); a.set_ylabel("Time per operation (µs, log)")
a.set_title("(a) Computation (gateway-class CPU)", fontsize=9, loc="left"); a.legend(fontsize=7.5); a.grid(axis="x", visible=False)
b.bar(x - w / 2 - 0.01, [c[k]["sig_bytes"] for k in names], w, color=C1, label="Signature")
b.bar(x + w / 2 + 0.01, [max(c[k]["pk_bytes"], 1) for k in names], w, color=C3, label="Public key")
b.set_yscale("log"); b.set_xticks(x); b.set_xticklabels(short, fontsize=7); b.set_ylabel("Size (bytes, log)")
b.set_title("(b) Communication / storage overhead", fontsize=9, loc="left"); b.legend(fontsize=7.5); b.grid(axis="x", visible=False)
fig.tight_layout(); fig.savefig(OUT + "fig_pqc.png"); plt.close(fig)
print("ok")
