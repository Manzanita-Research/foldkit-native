# Performance numbers (FKN-26)

`scripts/nightly.ts` measures FoldKit on gpuix in real windows: three apps
(`bench/counter.ts`, Big List, Pixel Art), each in its own process, driven
through gpuix's automation. It prints a table and compares it with the
committed baseline for the machine class, failing when a metric's median is
**at least 25% worse** and worse by more than its noise floor.

```sh
bun scripts/nightly.ts                       # run (5 processes per app), compare with bench/baseline.<class>.json
bun scripts/nightly.ts --record              # run and write the baseline for this class
bun scripts/nightly.ts --runs 3 --apps counter --out results.json
```

macOS needs a logged-in desktop (one process at a time, so no other window
work). Linux runs inside a headless compositor:
`scripts/wayland-session.sh -- bun scripts/nightly.ts --class linux-m6`.

## Baselines are per machine class

A baseline is only comparable to the same hardware and OS. The committed ones:

| File | Class | Recorded on |
|---|---|---|
| `baseline.macos-ci.json` | `macos-ci` | the `nightly` workflow on `blacksmith-6vcpu-macos-15` (Metal), run by hand with record ticked |
| `baseline.linux-m6.json` | `linux-m6` | jemarchy-m6 (an AMD Ryzen mini PC, Phoenix1 iGPU on Mesa, Linux, headless sway; load average about 1.5 from other threads) |

Add another class with `--record --class <name>` on that hardware and commit
the file. The CI runner is its own class (`macos-ci`): record it by running the
`nightly` workflow with `record` ticked, and commit what it uploads. The
workflow runs every night (about 10 minutes of Blacksmith macOS) and fails
when a median is 25% worse than that baseline; the table is in the job summary.

## What's measured

First paint, click → frame, key → frame, theme switch, scroll step → frame,
RSS, idle CPU. See the head of `scripts/nightly.ts` for each one's definition.
The table shows the median, with the p95 in brackets (the task's budgets are
p95s); the gate is on the median, because a p95 over a few dozen samples
moved by 20% between identical runs. The noise floors (`scripts/nightly-compare.ts`)
keep a +25% on a 5 ms number from failing the run.

"On screen" is GPUI's last painted frame where gpuix reports it (macOS) and
the retained tree where it doesn't (Linux; up to a frame early).

## Metal (the macos-ci baseline)

| App | first paint | click → frame | key → frame | theme switch | scroll step → frame | RSS | idle CPU |
|---|---|---|---|---|---|---|---|
| counter | 383 ms | 6.7 ms | – | – | – | 185 MB | 1.5 % |
| big-list | 514 ms | – | 23.9 ms | 14.8 ms | 21.7 ms | 257 MB | 2.0 % |
| pixel-art | 587 ms | **81.8 ms** (p95 111) | 44.6 ms (p95 55) | – | – | 311 MB | 1.5 % |

Against the budgets: all within except Pixel Art's click → frame (opening its
Listbox restyles many elements; gpuix's `applyBatch` takes about 10 ms for one
style op in a live window), which is over the 50 ms budget on both platforms.

## Budgets from the task, against the first Linux numbers

These are a reading, not a gate (the gate is the baseline):

| Budget | m6, Linux |
|---|---|
| warm first paint p95 ≤ 1 s | 1.2 s (counter), 1.36 s (Big List), 1.5 s (Pixel Art), from spawn: bun start-up and module loading included. Over |
| click/key → frame p95 ≤ 50 ms | counter 43 ms, Big List key 43 ms, Pixel Art key (Escape) 97 ms and click (opening its Listbox) 168 ms. Pixel Art is over |
| theme switch ≤ 100 ms | Big List 66 ms (p95 71). Within |
| RSS ≤ 350 MB small app, ≤ 500 MB 10k-record app | counter 368 MB (over: Linux counts the GPU driver's mappings), Big List 417 MB, Pixel Art 450 MB. Within for the big apps |
| scrolling frame p95 ≤ 16.7 ms | not measurable: gpuix gives automation no frame times. A wheel step → the next row on screen is 33 ms median (p95 41) |
| idle CPU | 2.0% of a core in all three: a 60 Hz timer-driven frame loop, about twice as busy for a few seconds after any interaction |
