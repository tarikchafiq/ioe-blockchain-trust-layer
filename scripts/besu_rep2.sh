#!/bin/bash
# Reduced second repetition on key operating points (fresh chain per run).
cd /home/claude/work/proto
source <(sed -n '/^run() {/,/^}/p' scripts/besu_sweep.sh)
run log 50 30 rep2; run log 150 30 rep2; run store 50 30 rep2; run anchor 3.3 30 rep2; run anchor 150 30 rep2
echo REP2DONE
