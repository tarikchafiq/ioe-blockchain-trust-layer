"""Mutation testing of the trust-layer contracts (test-suite adequacy).
Generates first-order mutants with classic operators, recompiles, runs the Hardhat test-suite and
records whether each mutant is killed (>=1 failing test), survives, or is stillborn (does not compile).
Output: results/mutation.json
"""
import json, os, re, subprocess, shutil, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = ["IoERegistry.sol", "AccessPolicy.sol", "AnchorRegistry.sol", "EnergyMarket.sol", "EnergyMarketV2.sol"]
OPS = [
    ("ROR", r"(?<![=!<>])==(?!=)", "!="), ("ROR", r"!=", "=="),
    ("ROR", r"(?<![<>=])<=(?!=)", "<"), ("ROR", r"(?<![<>=])>=(?!=)", ">"),
    ("ROR", r"(?<![<>=-])<(?![<=])", "<="), ("ROR", r"(?<![<>=-])>(?![>=])", ">="),
    ("LOR", r"&&", "||"), ("LOR", r"\|\|", "&&"),
    ("AOR", r"\+ 1\b", "+ 2"), ("AOR", r"(?<![+])\+=", "-="),
    ("BLR", r"\btrue\b", "false"),
]
def mutants(src):
    out = []
    lines = src.split("\n")
    for li, line in enumerate(lines):
        s = line.strip()
        if s.startswith("//") or s.startswith("pragma") or s.startswith("import") or s.startswith("event ") or s.startswith("error ") or "SPDX" in s:
            continue
        # operator replacement
        for name, pat, rep in OPS:
            for m in re.finditer(pat, line):
                new = line[:m.start()] + rep + line[m.end():]
                out.append((name, li + 1, s, lines[:li] + [new] + lines[li + 1:]))
        # guard removal: delete an `if (...) revert X();` check
        if re.match(r"\s*if \(.*\) revert \w+\(\);\s*$", line):
            out.append(("GRD", li + 1, s, lines[:li] + ["        // mutant: guard removed"] + lines[li + 1:]))
        # statement deletion of state-changing assignments
        if re.match(r"\s*[\w\[\]\.\(\)\s]+(\+=|=)\s*[^=].*;\s*$", line) and not re.search(r"\b(uint\d*|bytes32|bool|address|Offer|Policy|Device|Anchor|Status)\b\s+\w+\s*=", line) and "return" not in line:
            out.append(("SDL", li + 1, s, lines[:li] + ["        // mutant: statement deleted"] + lines[li + 1:]))
        # modifier removal
        if re.search(r"\bonly(Admin|Gateway)\b", line) and "modifier" not in line:
            out.append(("MOD", li + 1, s, lines[:li] + [re.sub(r"\s*\bonly(Admin|Gateway)\b", "", line)] + lines[li + 1:]))
    return out

def run(cmd, timeout=300):
    p = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout + p.stderr

results = []
ONLY = None; OUT = "mutation.json"
if len(sys.argv) > 1 and sys.argv[1] == "--survivors":
    prev = json.load(open(os.path.join(ROOT, "results", sys.argv[2])))
    ONLY = {(r["contract"], r["op"], r["line"], r["code"]) for r in prev if r["status"] == "survived"}
    carried = [r for r in prev if r["status"] != "survived"]
    OUT = sys.argv[3]
limit = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 10**9
for t in TARGETS:
    path = os.path.join(ROOT, "contracts", t)
    orig = open(path).read()
    ms = mutants(orig)
    print(t, len(ms), "mutants", flush=True)
    for k, (op, ln, before, newlines) in enumerate(ms[:limit]):
        if ONLY is not None and (t, op, ln, before) not in ONLY: continue
        open(path, "w").write("\n".join(newlines))
        t0 = time.time()
        try:
            rc, out = run("npx hardhat test 2>&1", timeout=400)
            if "HH600" in out or "Compilation failed" in out or "DeclarationError" in out or "TypeError" in out or "ParserError" in out:
                status = "stillborn"
            elif re.search(r"\d+ failing", out):
                status = "killed"
            elif re.search(r"\d+ passing", out):
                status = "survived"
            else:
                status = "error"
        except subprocess.TimeoutExpired:
            status = "killed"  # infinite loop / hang counts as detected
        finally:
            open(path, "w").write(orig)
        results.append({"contract": t, "op": op, "line": ln, "code": before, "status": status, "secs": round(time.time() - t0, 1)})
        print(t, op, ln, status, flush=True)
        json.dump((carried if ONLY is not None else []) + results, open(os.path.join(ROOT, "results", OUT), "w"), indent=1)
run("npx hardhat compile")
summ = {}
for r in ((carried if ONLY is not None else []) + results):
    s = summ.setdefault(r["contract"], {"killed": 0, "survived": 0, "stillborn": 0, "error": 0})
    s[r["status"]] += 1
print(json.dumps(summ, indent=1))
