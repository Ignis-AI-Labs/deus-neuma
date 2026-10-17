#!/usr/bin/env bash
# One bench process per config. Usage: ./sweep.sh THREADS "args A" "args B" ...
# The CPU is shared with other work: before each config, wait (up to GATE_WAIT s) until the
# cores we pin to (0..THREADS-1) are mostly idle, so configs are compared under similar load.
set -u
T=$1; shift
gate() {
  python3 - "$T" "${GATE_BUSY:-35}" "${GATE_WAIT:-900}" <<'PY'
import sys, time
t, busy_max, wait = int(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
def snap():
    d = {}
    for l in open("/proc/stat"):
        if l.startswith("cpu") and l[3].isdigit():
            p = l.split(); v = list(map(int, p[1:])); d[int(p[0][3:])] = (sum(v), v[3] + v[4])
    return d
t0 = time.time()
while True:
    a = snap(); time.sleep(3); b = snap()
    busy = sum(100 * (1 - (b[c][1] - a[c][1]) / max(1, b[c][0] - a[c][0])) for c in range(t)) / t
    if busy < busy_max or time.time() - t0 > wait:
        print(f"gate: cores 0-{t-1} {busy:.0f}% busy after {time.time()-t0:.0f}s")
        break
PY
}
for cfg in "$@"; do
  gate
  echo "== t$T $cfg  load: $(cut -d' ' -f1-3 /proc/loadavg)"
  OMP_WAIT_POLICY=${OMP_WAIT_POLICY:-PASSIVE} timeout 1800 .venv/bin/python bench.py --threads "$T" $cfg ${BENCH_EXTRA:-} 2>&1 | grep -E "^SUMMARY|Error" | cut -c1-460
done
