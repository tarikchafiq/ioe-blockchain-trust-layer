"""Architecture and protocol diagrams (matplotlib, 300 dpi)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

plt.rcParams.update({"font.family": "DejaVu Sans", "savefig.dpi": 300, "savefig.bbox": "tight"})
INK, MUTED = "#0b0b0b", "#52514e"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"

def box(ax, cx, cy, w, h, text, fc="white", ec=MUTED, ls="-", fs=8, bold_first=True, lw=1.0):
    ax.add_patch(FancyBboxPatch((cx - w / 2, cy - h / 2), w, h, boxstyle="round,pad=0.02,rounding_size=0.08", fc=fc, ec=ec, lw=lw, ls=ls, zorder=3))
    lines = text.split("\n")
    if bold_first:
        ax.text(cx, cy + (0.11 if len(lines) > 1 else 0), lines[0], ha="center", va="center", fontsize=fs, weight="bold", color=INK, zorder=4)
        if len(lines) > 1:
            ax.text(cx, cy - 0.13, "\n".join(lines[1:]), ha="center", va="center", fontsize=fs - 1.3, color=MUTED, zorder=4, linespacing=1.1)
    else:
        ax.text(cx, cy, text, ha="center", va="center", fontsize=fs, color=INK, zorder=4)
    return (cx, cy, w, h)

def band(ax, x0, y0, x1, y1, title, sub, fc, ec):
    ax.add_patch(FancyBboxPatch((x0, y0), x1 - x0, y1 - y0, boxstyle="round,pad=0.02,rounding_size=0.12", fc=fc, ec=ec, lw=1.3, zorder=1))
    ax.text(x0 + 0.12, y1 - 0.17, title, fontsize=8.6, weight="bold", color=INK, va="center", zorder=2)
    ax.text(x0 + 0.12 + 0.068 * len(title) + 0.25, y1 - 0.17, sub, fontsize=7.2, color=MUTED, va="center", zorder=2)

def arrow(ax, p, q, label=None, color=MUTED, lw=1.1, rad=0.0, ls="-", both=False, lpos=0.5, loff=(0.0, 0.0), fs=6.6, lcolor=None, ha="center"):
    a = FancyArrowPatch(p, q, arrowstyle="<|-|>" if both else "-|>", mutation_scale=8, color=color, lw=lw, ls=ls,
                        connectionstyle=f"arc3,rad={rad}", zorder=5, shrinkA=1, shrinkB=1)
    ax.add_patch(a)
    if label:
        x = p[0] + (q[0] - p[0]) * lpos + loff[0]; y = p[1] + (q[1] - p[1]) * lpos + loff[1]
        ax.text(x, y, label, fontsize=fs, color=lcolor or MUTED, ha=ha, va="center", zorder=6,
                bbox=dict(fc="white", ec="none", pad=0.6, alpha=0.9))

# ===================== Architecture =====================
def band(ax, x0, y0, x1, y1, title, sub, fc, ec):
    ax.add_patch(FancyBboxPatch((x0, y0), x1 - x0, y1 - y0, boxstyle="round,pad=0.02,rounding_size=0.12", fc=fc, ec=ec, lw=1.3, zorder=1))
    ax.text(x0 + 0.12, y1 - 0.18, title, fontsize=8.6, weight="bold", color=INK, va="center", zorder=7, bbox=dict(fc=fc, ec="none", pad=1.0))
    ax.text(x1 - 0.12, y1 - 0.18, sub, fontsize=7.2, color=MUTED, va="center", ha="right", zorder=7, bbox=dict(fc=fc, ec="none", pad=1.0))
fig, ax = plt.subplots(figsize=(10.5, 7.2)); ax.set_xlim(0, 12.2); ax.set_ylim(0.25, 7.75); ax.axis("off")
band(ax, 0.25, 5.75, 10.0, 7.35, "Layer 3 — Permissioned trust ledger", "consortium: DSO/TSO, aggregators, regulator · BFT finality (e.g., QBFT)", "#eaf2fc", BLUE)
band(ax, 0.25, 2.0, 10.0, 5.3, "Layer 2 — Edge / gateway", "data concentrator · substation · aggregator node", "#fdf0ea", ORANGE)
band(ax, 0.25, 0.35, 10.0, 1.6, "Layer 1 — IoE devices", "resource-constrained · keys in secure element / TPM", "#e8f7f0", AQUA)
X = [1.55, 3.95, 6.35, 8.75]; W = 2.2
REG = box(ax, X[0], 6.4, W, 0.72, "IoERegistry\nDIDs · key hashes · status")
ACL = box(ax, X[1], 6.4, W, 0.72, "AccessPolicy\ncapabilities · expiry · nonces")
ANC = box(ax, X[2], 6.4, W, 0.72, "AnchorRegistry\nsequenced Merkle roots")
MKT = box(ax, X[3], 6.4, W, 0.72, "EnergyMarketV2\nescrow · meter-attested settlement")
box(ax, X[0], 4.45, W, 0.62, "Identity agent\nenrol · rotate · revoke")
box(ax, X[1], 4.45, W, 0.62, "Policy enforcement\nmediates device commands")
box(ax, X[2], 4.45, W, 0.62, "Merkle batcher\nroot every T seconds")
box(ax, X[3], 4.45, W, 0.62, "Settlement relay\nmeter-signed attestation")
box(ax, X[1], 3.45, W, 0.62, "Anomaly detector\nFDIA / ML on verified data (opt.)", ls="--")
box(ax, X[2], 3.45, W, 0.62, "Off-chain store\nTSDB / content-addressed")
box(ax, 5.15, 2.5, 9.4, 0.55, "Ingest & signature verification\nECDSA / ML-DSA / HMAC · DID & key-hash check · sequence/replay window")
devs = ["Smart meter", "PV / battery inverter", "EV charger", "Grid sensor / PMU"]
for x, d in zip(X, devs):
    box(ax, x, 0.95, W, 0.5, d, bold_first=False, fs=7.8)
    arrow(ax, (x, 1.21), (x, 2.21), color=AQUA, lw=1.2)
ax.text(5.15, 1.8, "signed readings  (did, t, value, seq, σ)", fontsize=6.9, color=INK, ha="center", bbox=dict(fc="white", ec="none", pad=0.8))
AUD = box(ax, 11.15, 3.45, 1.85, 1.0, "Auditor / regulator\nbilling party\n(dispute resolution)", fc="#f4f3ef")
arrow(ax, (X[0], 2.78), (X[0], 4.13), "DID / key lookup", fs=6.3, lpos=0.42)
arrow(ax, (X[2], 2.78), (X[2], 3.13))
arrow(ax, (X[2], 3.77), (X[2], 4.13))
ax.text(X[2] + 0.08, 3.95, "leaf hashes", fontsize=6.3, color=MUTED, va="center")
arrow(ax, (X[2] - W / 2, 3.45), (X[1] + W / 2, 3.45))
arrow(ax, (X[2] + W / 2, 3.45), (AUD[0] - AUD[2] / 2, 3.45), "reading +\nMerkle proof", lpos=0.45, fs=6.3)
for x, lab, kw in [(X[0], "register / rotate / revoke", dict(both=True)), (X[1], "requestAccess / checkAccess", dict(both=True)),
                   (X[2], "anchor(seq, root)", dict(color=BLUE, lw=1.8, lcolor=BLUE)), (X[3], "settleAttested(id, Wh, σ_meter)", {})]:
    arrow(ax, (x, 4.77), (x, 6.03), lab, fs=6.4, lpos=0.58, **kw)
arrow(ax, (AUD[0], 3.96), (X[2] + 0.35, 6.77), None, rad=0.62, ls="--")
ax.text(11.3, 5.25, "verifyInclusion()", fontsize=6.6, color=MUTED, ha="left", bbox=dict(fc="white", ec="none", pad=0.8), zorder=8)
fig.savefig("figs/fig_arch.png"); plt.close(fig)

# ===================== Provenance / dispute sequence =====================
fig, ax = plt.subplots(figsize=(9.6, 5.2)); ax.set_xlim(-0.05, 10.3); ax.set_ylim(0, 10); ax.axis("off")
actors = [("Device d", 0.9, AQUA), ("Gateway g", 3.3, ORANGE), ("Off-chain store", 5.5, MUTED), ("Ledger", 7.4, BLUE), ("Auditor", 9.3, MUTED)]
for name, x, c in actors:
    ax.add_patch(FancyBboxPatch((x - 0.85, 9.15), 1.7, 0.55, boxstyle="round,pad=0.02,rounding_size=0.08", fc="white", ec=c, lw=1.3))
    ax.text(x, 9.42, name, ha="center", va="center", fontsize=7.8, weight="bold")
    ax.plot([x, x], [0.3, 9.15], color="#c3c2b7", lw=1, ls=(0, (3, 3)), zorder=0)
xs = {a[0]: a[1] for a in actors}
def msg(a, b, y, text, color=INK, dashed=False, note_side="above"):
    ax.add_patch(FancyArrowPatch((xs[a], y), (xs[b], y), arrowstyle="-|>", mutation_scale=9, color=color, lw=1.2, ls="--" if dashed else "-"))
    ax.text((xs[a] + xs[b]) / 2, y + 0.22, text, ha="center", va="bottom", fontsize=6.9, color=INK)
def selfnote(a, y, text, w=2.3):
    ax.add_patch(FancyBboxPatch((xs[a] - w / 2, y - 0.3), w, 0.6, boxstyle="round,pad=0.02,rounding_size=0.06", fc="#f4f3ef", ec="#c3c2b7", lw=0.8))
    ax.text(xs[a], y, text, ha="center", va="center", fontsize=6.6, color=INK, linespacing=1.1)
ax.text(0.05, 8.85, "Collection (every Δ)", fontsize=7.2, color=MUTED, style="italic")
msg("Device d", "Gateway g", 8.0, "r = (did, t, v, seq),  σ = Sign(sk_d, r)")
selfnote("Gateway g", 7.3, "check DID active, key hash,\nσ valid, seq fresh  →  ℓ = H(r‖σ)")
msg("Gateway g", "Off-chain store", 6.45, "store (r, σ, ℓ)")
ax.text(0.05, 5.95, "Anchoring (every T)", fontsize=7.2, color=MUTED, style="italic")
selfnote("Gateway g", 5.3, "R_k = MerkleRoot(ℓ_1 … ℓ_n)\nsorted-pair Keccak-256")
msg("Gateway g", "Ledger", 4.45, "anchor(k, R_k, n, t_start, t_end)   [seq k = last+1]", color=BLUE)
selfnote("Ledger", 3.55, "BFT finality;\nevent Anchored(g, k, R_k)", w=2.2)
ax.text(0.05, 2.95, "Dispute / audit (on demand)", fontsize=7.2, color=MUTED, style="italic")
msg("Auditor", "Off-chain store", 2.45, "fetch (r, σ, π_ℓ) for reading in batch k", dashed=True)
msg("Auditor", "Ledger", 1.45, "verifyInclusion(g, k, ℓ, π_ℓ) → bool", dashed=True)
ax.text(5.0, 0.55, "Any post-hoc change to r, σ, batch order or batch membership changes ℓ or R_k and is detected (A10–A12).",
        ha="center", fontsize=7.0, color=MUTED, style="italic")
fig.savefig("figs/fig_seq.png"); plt.close(fig)
print("ok")
