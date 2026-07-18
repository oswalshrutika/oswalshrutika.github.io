# 05 — Linux for Trading Support

Index of the Linux prep pack. Audience: Technical Analyst / Production Support at a sell-side or buy-side trading desk. Assumes ~5 years supporting a vendor OMS on RHEL/CentOS/Rocky boxes.

| # | File | Purpose |
|---|------|---------|
| 00 | [00_INDEX.md](./00_INDEX.md) | This file — table of contents |
| 01 | [01_comprehensive.md](./01_comprehensive.md) | Deep 100+ Q&A across filesystem, permissions, procs, memory, IO, network, log parsing, FIX log parsing, shell, systemd, kernel tuning, SSL, SSH, GDB, strace, and real trading-support scenarios |
| 02 | [02_focused.md](./02_focused.md) | 50 focused Q&A for the "45-minute Linux round" — mostly commands, one-liners, and short scenarios |
| 03 | [03_quick_hit.md](./03_quick_hit.md) | 25 quick-hit Q&A — sub-30-second answers, phone-screen style |
| 05 | [05_red_flags.md](./05_red_flags.md) | 15 wrong answers to *avoid* saying out loud, with the correction |
| 06 | [06_mock_interview.md](./06_mock_interview.md) | 3 full mock dialogues: FIX session dropped, OMS at 100 % CPU, extract exec reports for one order from a 40 GB log |
| 07 | [07_exercises.md](./07_exercises.md) | 20 hands-on shell problems with sample data and reference commands |

## How to use this pack

1. **First pass (day 1)** — read `01_comprehensive.md` top to bottom, mark anything you can't explain out loud in 60 seconds.
2. **Drill (days 2–3)** — do `07_exercises.md` on a real Linux box. Type every command, don't copy-paste. Time yourself.
3. **Refresh (day of interview)** — skim `03_quick_hit.md` on the train, then `05_red_flags.md` so nothing embarrassing leaks out.
4. **Rehearse (evening before)** — read one dialogue from `06_mock_interview.md` out loud, then close the file and re-tell it from memory.

## Command-recall priority

If you only remember 20 commands, make them these:

```bash
ss -tlnp                          # who is listening on which port
lsof -i :9876                     # who holds this FIX port
lsof -p <pid>                     # what does this process have open
strace -f -p <pid> -e trace=network -tt   # what syscalls is it making
pgrep -af oms | head              # find the OMS pid tree
pstree -pals <pid>                # parent chain
top -H -p <pid>                   # per-thread CPU for one process
pidstat -t 1 -p <pid>             # thread-level CPU/IO deltas
gdb -p <pid> -batch -ex "thread apply all bt"  # non-destructive stack dump
iostat -xz 1                      # per-device IO
free -h ; cat /proc/meminfo       # memory truth
awk -F'\x01' '$0 ~ /\x0135=D\x01/ {print}' fix.log   # slice FIX log by MsgType
grep -c '35=8' fix.log            # count exec reports
zgrep -h 'ClOrdID=ABC123' *.gz    # cross-file order lifecycle
tcpdump -i any -w /tmp/fix.pcap 'host 10.20.30.40 and port 9876'
journalctl -u oms --since '10 min ago' -f
find /var/log/oms -name '*.log' -mtime +7 -size +100M
tail -F /var/log/oms/session.log | grep --line-buffered -E 'REJECT|35=3|35=j'
openssl s_client -connect broker.example.com:9443 -servername broker.example.com </dev/null 2>/dev/null | openssl x509 -noout -dates
```

## Interviewer-signal cheat sheet

| They ask about... | They actually want to know... |
|---|---|
| "How do you tail a large log?" | Do you know `less +F`, `tail -F` vs `-f`, and that `grep --line-buffered` matters when piping |
| "How do you kill a process?" | Do you understand `SIGTERM` vs `SIGKILL`, when a process ignores `SIGTERM`, and that `SIGKILL` can't be caught |
| "How do you find who holds port 9876?" | `ss -tlnp` / `lsof -i :9876` — and can you read the output |
| "Load average is 40, box is fine — why?" | You know load ≠ CPU; it counts uninterruptible-sleep (D-state, usually IO/NFS) |
| "Free shows 200 MB free" | You know about buffers/cache vs `available`; you don't panic |
| "OOM killed the OMS at 3 AM" | Can you read `dmesg` OOM output, and did you check `vm.overcommit_memory`, cgroup limits, and `oom_score_adj` |
| "How do you decode a core file?" | `gdb <binary> <core>`, `bt`, `thread apply all bt`, and `ulimit -c unlimited` / `/proc/sys/kernel/core_pattern` |
| "Extract every fill for ClOrdID=X" | Do you reach for `zgrep`, `awk -F'\x01'`, or open the file in vim (wrong) |

Everything in this pack is grounded in what a trading-desk L2/L3 support engineer actually does on a Tuesday morning when the phone rings.
