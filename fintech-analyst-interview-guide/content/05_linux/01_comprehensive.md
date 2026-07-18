# 05 — Linux Comprehensive Q&A

> 100+ Linux/shell questions relevant to trading support.

---

## 1. Filesystem & permissions

### Q1. What are `/proc`, `/sys`, and `/etc` used for?
**Interviewer signal:** Do you know where kernel state, device state, and config live?
**Answer:**
- `/proc`: virtual filesystem exposing kernel and per-process state (`/proc/<pid>/status`, `/proc/meminfo`, `/proc/cpuinfo`, `/proc/net/tcp`).
- `/sys`: sysfs, exposes devices, drivers, and kernel objects (block device queue depth, network interface flags).
- `/etc`: persistent system config (`/etc/hosts`, `/etc/resolv.conf`, `/etc/fstab`, service configs).
- `/proc` and `/sys` are in-memory, not on disk; changes to `/sys` tunables are runtime-only unless persisted via sysctl.

**Watch-outs:** `/proc/<pid>/limits` and `/proc/<pid>/fd` are goldmines when debugging a stuck OMS process.

### Q2. What is an inode and why does `df` show space but writes fail?
**Interviewer signal:** Understands filesystem internals beyond bytes.
**Answer:**
- An inode stores file metadata (owner, perms, size, block pointers) — one per file/dir.
- Filesystems allocate a fixed number of inodes at mkfs time.
- If a directory holds millions of small files (FIX session logs, drop-copies), you can exhaust inodes while bytes remain.
- Check with `df -i`; symptom is `No space left on device` even when `df -h` looks fine.

**Watch-outs:** Log rotation cleaning old files frees inodes; deleting one huge file does not.

### Q3. Hard link vs symbolic link?
**Interviewer signal:** Basic FS literacy.
**Answer:**
- Hard link: second directory entry pointing to the same inode; same filesystem only; file persists until link count hits 0.
- Symlink: a small file containing a path string; can cross filesystems, can point to nonexistent targets, breaks if target moves.
- `ls -li` shows inode number and link count; `readlink -f` resolves symlink chains.
- Deleting the target of a hard link keeps data alive; deleting target of symlink leaves a dangling link.

**Watch-outs:** `tar` and rsync handle these differently — check `-H` / `-l` flags.

### Q4. Explain `chmod` and `umask`.
**Interviewer signal:** Comfort with permission bits.
**Answer:**
- Permission triplet: user/group/other, each with r(4)/w(2)/x(1).
- `chmod 640 file` → owner rw, group r, other none.
- `umask` is the default mask subtracted from 0666 (files) / 0777 (dirs) on creation; typical `022` yields 644 / 755.
- Symbolic form: `chmod g+w,o-r file`; recursive with `-R`.

```bash
umask           # show current
chmod 750 script.sh
chmod -R g+rX logs/   # capital X = execute only on dirs
```

**Watch-outs:** Setting 777 on a shared drop directory is a common audit finding — use group ownership + setgid instead.

### Q5. What do setuid, setgid, and the sticky bit do?
**Interviewer signal:** Deeper permission model.
**Answer:**
- setuid (4xxx): binary runs as file owner (e.g. `/usr/bin/passwd` runs as root).
- setgid (2xxx): on a binary, runs as file group; on a directory, new files inherit the dir's group — useful for shared team dirs.
- Sticky bit (1xxx): on a dir, only file owner can delete their files (e.g. `/tmp`).
- Shown as `s`/`t` in `ls -l`: `-rwsr-xr-x`, `drwxrwxrwt`.

**Watch-outs:** setuid shell scripts are ignored by the kernel; only binaries honor it. Audit any setuid file you don't recognize.

## 2. Process management

### Q1. `ps aux` vs `ps -ef` — what's the difference?
**Interviewer signal:** Practical shell fluency.
**Answer:**
- Both list all processes; different columns and heritage.
- `ps aux` (BSD-style): shows `%CPU %MEM VSZ RSS STAT START TIME COMMAND` — good for resource snapshots.
- `ps -ef` (SysV-style): shows `UID PID PPID C STIME TTY TIME CMD` — good for parent-child chains.
- I use `ps -ef` when hunting the parent of a runaway child, `ps aux --sort=-rss` when hunting memory hogs.

**Watch-outs:** `COMMAND` column may be truncated; add `ww` (`ps auxww`) to see full args.

### Q2. `pgrep` and `pkill` — when to use them?
**Interviewer signal:** Prefers precise tools over `ps | grep`.
**Answer:**
- `pgrep -f pattern` finds PIDs matching the full command line.
- `pkill -f -TERM pattern` sends signal to matches.
- Safer than `ps | grep | awk | xargs kill` — no risk of matching the grep itself.
- Use `-u user` to scope to a user, `-P ppid` to scope to children of a parent.

```bash
pgrep -af oms_engine
pkill -TERM -f 'fix_session.*SESSION_A'
```

**Watch-outs:** Test with `pgrep` before running `pkill` — regex slips can kill unrelated processes.

### Q3. Signals — 15 vs 9 vs 1 vs USR1?
**Interviewer signal:** Knows how to shut things down gracefully.
**Answer:**
- SIGTERM (15): default, polite request; process can trap and clean up (flush FIX seq nums, close sockets).
- SIGKILL (9): uncatchable, immediate; last resort — orphaned locks, corrupt state possible.
- SIGHUP (1): historically "terminal hangup"; commonly repurposed to reload config (nginx, syslog).
- SIGUSR1/USR2 (10/12): user-defined; apps often use them for log rotation, thread dumps, debug toggles.

**Watch-outs:** Always try 15, wait, then 9. `kill -0 <pid>` tests if a process is still alive without signaling.

### Q4. `nohup` and `disown` — what's the difference?
**Interviewer signal:** Understands job control.
**Answer:**
- `nohup cmd &` starts a command immune to SIGHUP, redirects stdout/stderr to `nohup.out`; use at launch time.
- `disown %1` removes an already-running job from the shell's job table so it survives shell exit; use after the fact.
- `setsid` fully detaches into a new session — cleanest for daemons.
- For anything long-running, prefer `systemd`, `tmux`, or `screen` over shell tricks.

**Watch-outs:** `nohup` doesn't redirect stdin — closes it. Doesn't help if the app writes to `/dev/tty` explicitly.

### Q5. Foreground vs background job control?
**Interviewer signal:** Shell literacy.
**Answer:**
- `cmd &` starts in background; `jobs` lists them; `fg %1` brings job 1 to foreground; `bg %1` resumes stopped job.
- Ctrl-Z sends SIGTSTP (stop); Ctrl-C sends SIGINT.
- `wait` blocks until background jobs finish — useful in scripts fanning out parallel work.
- Redirect output (`cmd > out.log 2>&1 &`) or it will scribble over your terminal.

**Watch-outs:** Backgrounded jobs die on shell exit unless disowned or nohup'd; SSH sessions dropping is the classic cause.

## 3. Memory & OOM

### Q1. Reading `free -m` — what's `available` vs `free`?
**Interviewer signal:** Doesn't panic when `free` looks low.
**Answer:**
- `free`: memory not used for anything.
- `used`: application + kernel allocations (excluding buffers/cache in modern `free`).
- `buff/cache`: page cache and buffers — reclaimable on demand.
- `available`: kernel estimate of memory available for new allocations without swapping — this is the number that matters.
- Low `free` + high `available` = healthy; Linux uses spare RAM as cache aggressively.

**Watch-outs:** Old habits from `free -m` pre-3.14 kernels are misleading; trust `available`.

### Q2. What's in `/proc/meminfo`?
**Interviewer signal:** Knows where the ground truth lives.
**Answer:**
- `MemTotal`, `MemFree`, `MemAvailable` — headline numbers.
- `Buffers`, `Cached`, `SwapCached` — page cache breakdown.
- `Active`/`Inactive` (anon + file) — LRU state; feeds reclaim decisions.
- `Slab`, `SReclaimable`, `SUnreclaim` — kernel object caches.
- `Committed_AS`, `CommitLimit` — total virtual memory promised vs cap.
- `HugePages_*` — hugepage pool state.

**Watch-outs:** High `SUnreclaim` growth is a kernel-side leak — dmesg and slabtop are next stops.

### Q3. Swap — when is it fine, when is it a red flag?
**Interviewer signal:** Understands memory pressure signals.
**Answer:**
- Some swap use is normal — kernel pages out idle anon memory to make room for cache.
- Red flag: active swapping (`si`/`so` in `vmstat 1` nonzero), rising latency, thrashing.
- For latency-sensitive OMS/FIX processes we typically set `vm.swappiness=1` or lock critical processes with `mlockall`.
- Absence of swap is fine on servers with tuned memory; OOM will just fire sooner.

```bash
vmstat 1 5     # si/so columns
swapon --show
```

**Watch-outs:** `free` "used swap" can persist long after pressure ended — check rates, not totals.

### Q4. How does the OOM killer pick a victim?
**Interviewer signal:** Understands kernel behavior under pressure.
**Answer:**
- Kernel scores each process in `/proc/<pid>/oom_score` — higher score = more likely victim.
- Score roughly ~ RSS + swap usage, adjusted by `oom_score_adj` (-1000 disables, +1000 forces).
- Killer prefers processes with high memory + low importance; also considers `oom_score_adj`.
- `dmesg | grep -i 'killed process'` shows the victim and reason.
- Protect critical daemons with `echo -1000 > /proc/<pid>/oom_score_adj` or systemd `OOMScoreAdjust=`.

**Watch-outs:** OOM killer can pick surprising victims (init scripts, cgroup managers) — always set adjustments explicitly on the trading process.

### Q5. RSS vs VSZ vs PSS — what's the difference?
**Interviewer signal:** Precise about memory metrics.
**Answer:**
- VSZ (virtual size): total virtual address space mapped — includes unused reservations, mmap'd files, shared libs. Almost always overstates real usage.
- RSS (resident set size): physical pages currently in RAM for the process; double-counts shared pages across processes.
- PSS (proportional set size): RSS with shared pages divided by sharers — best "fair share" number for capacity planning.
- See PSS in `/proc/<pid>/smaps_rollup` or `smem -k`.

**Watch-outs:** Summing RSS across 200 Java workers wildly overestimates memory; sum PSS instead.

## 4. IO & disk

### Q1. Reading `iostat -xz 1` — which columns matter?
**Interviewer signal:** Debugs disk latency, not just utilization.
**Answer:**
- `r/s`, `w/s` — IOPS.
- `rkB/s`, `wkB/s` — throughput.
- `await` — average total wait (queue + service) in ms; the latency number.
- `r_await`/`w_await` — split by direction.
- `%util` — device busy time; misleading on SSDs/NVMe which parallelize.
- `aqu-sz` (avgqu-sz) — average queue depth; sustained >1 means queuing.

```bash
iostat -xz 1 5
```

**Watch-outs:** `%util` at 100% on NVMe doesn't mean saturated — trust `await` and queue depth.

### Q2. What does `iotop` show and when do you reach for it?
**Interviewer signal:** Knows per-process IO tools.
**Answer:**
- `iotop -oPa` shows per-process read/write bandwidth, accumulated since start.
- Needs root and kernel `CONFIG_TASK_IO_ACCOUNTING`.
- Best for "who is writing to disk right now" — noisy log writers, runaway `find`, backups.
- Pair with `pidstat -d 1` for scripted collection.

**Watch-outs:** IO account tracks bytes issued, not physical IO — page cache hits still count as reads.

### Q3. XFS vs ext4 — trade-offs?
**Interviewer signal:** Understands filesystem choice.
**Answer:**
- ext4: mature default, good general-purpose, supports online resize, journaling; slower for very large files and parallel writes.
- XFS: designed for large files, high parallel throughput, better metadata scalability; default on RHEL 7+; can only grow, not shrink.
- Both journaled; XFS typically wins for FIX log volumes and market-data captures; ext4 fine for root/OS.
- Neither is a substitute for backup/replication.

**Watch-outs:** XFS shrink is not supported — plan LVM sizing carefully.

### Q4. `df` vs `du` — why do they disagree?
**Interviewer signal:** Debugs "disk full" mysteries.
**Answer:**
- `df`: reports filesystem-level free space via statfs — includes deleted-but-open file space.
- `du`: walks the directory tree, sums allocated blocks of visible files.
- Common gap: a process holds a deleted log file open — `du` doesn't see it, `df` still shows it consumed.
- Find offenders with `lsof +L1` (files with link count 0).

```bash
df -hT /var
du -sh /var/log/* | sort -h
lsof +L1 | grep deleted
```

**Watch-outs:** Restarting the process holding the deleted file releases the space instantly.

## 5. Network diagnostics

### Q1. `ss -tanp` — what does it show and why prefer it over netstat?
**Interviewer signal:** Uses modern tools.
**Answer:**
- `ss` reads directly from kernel netlink; faster than `netstat` on hosts with thousands of sockets.
- Flags: `-t` TCP, `-a` all states, `-n` numeric (no DNS), `-p` process/PID.
- Add `-o` for timers (retransmits, keepalive), `-i` for TCP internals (cwnd, rtt).
- `state established`, `sport = :9876`, `dst 10.0.0.5` filters narrow it down.

```bash
ss -tanp state established '( sport = :9876 or dport = :9876 )'
ss -tin dst 10.0.0.5
```

**Watch-outs:** `-p` needs root or matching UID to see process names.

### Q2. `lsof -i:NNNN` — what is it for?
**Interviewer signal:** Maps ports to processes fast.
**Answer:**
- `lsof -i:9876` lists every process with an open socket on port 9876 (listen or connected).
- `lsof -i @10.0.0.5` filters by peer address; `-nP` skips DNS and service name lookup.
- Great for "who is bound to this port already?" during a restart failure.
- On very busy hosts prefer `ss -tanp '( sport = :9876 )'` — faster.

**Watch-outs:** Without root, only sees your own processes' sockets.

### Q3. `ip a` and `ip route` — the basics?
**Interviewer signal:** Modern replacement for ifconfig/route.
**Answer:**
- `ip a` (or `ip addr show`): interfaces, MAC, IPv4/IPv6 addresses, link state (`UP`, `LOWER_UP`).
- `ip -br a` gives a compact one-line-per-interface view.
- `ip route`: routing table; `ip route get 10.0.0.5` shows which interface and gateway will be used for that dest.
- `ip -s link` shows RX/TX packets, errors, drops per interface — first stop for NIC issues.

**Watch-outs:** `ifconfig` output on modern distros can miss secondary addresses — always use `ip`.

### Q4. `tcpdump` filter to capture FIX traffic?
**Interviewer signal:** Can debug wire-level.
**Answer:**
- Capture both directions on a known session port, write to file for later analysis.
- `-s0` full packets, `-w` pcap file, `-nn` no name resolution, `-i` interface.
- Filter for a specific peer and port.

```bash
sudo tcpdump -i eth0 -nn -s0 -w /tmp/fix.pcap \
  'host 10.0.0.5 and tcp port 9876'
# Follow live and search for a ClOrdID
sudo tcpdump -i eth0 -A -nn 'tcp port 9876' | grep -a '11=ORD12345'
```

**Watch-outs:** `-A` prints ASCII which is fine for FIX but grep needs `-a` to treat pcap output as text. Rotate captures (`-C 100 -W 10`) or you fill the disk.

### Q5. `nc` vs `curl` vs `telnet` for connectivity checks?
**Interviewer signal:** Picks the right tool.
**Answer:**
- `nc -vz host port` — cleanest reachability test; scriptable exit code; supports UDP with `-u`.
- `curl -v` — for HTTP(S), shows TLS handshake, headers, redirects; `--connect-timeout` for CI.
- `telnet host port` — legacy; useful for interactive line-oriented protocols but often not installed.
- `openssl s_client -connect host:port` when TLS cert/chain is the question.

```bash
nc -vz 10.0.0.5 9876
curl -v --connect-timeout 3 https://api.internal/health
openssl s_client -connect 10.0.0.5:9876 -servername fix.internal
```

**Watch-outs:** A successful TCP connect doesn't prove app-layer health — follow with a FIX Logon or HTTP GET.

### Q6. `mtr` — when do you use it over `ping` + `traceroute`?
**Interviewer signal:** Diagnoses intermittent network issues.
**Answer:**
- `mtr` combines traceroute + continuous ping per hop, showing loss% and latency per hop over time.
- Reveals which hop is dropping or jittering, not just the endpoint.
- Use `mtr -rwzbc 100 host` for a report-mode run (100 packets, wide, ASN, both hostnames and IPs) — great to paste in tickets.
- Ping alone tells you end-to-end loss; mtr tells you *where*.

**Watch-outs:** ICMP-only mode misses firewalls that drop ICMP but pass TCP; use `--tcp --port 9876` to test the actual path.
## 6. CPU & performance

### Q1. How do you spot per-CPU imbalance on a multi-core OMS box?
**Interviewer signal:** Knows CPU is not one number.
**Answer:**
- `mpstat -P ALL 1` prints per-core %usr/%sys/%iowait/%idle every second.
- If one core sits at 100% while others idle, likely a single hot thread (IRQ handler, matcher, or a spinning consumer).
- Cross-check with `top -H -p <pid>` to see which TID is burning that core.
- `sar -u 1` gives the aggregate view; `sar -P ALL 1` gives per-CPU (same as mpstat, but historical if sar collection is on).

**Watch-outs:** High `%soft` on one core often means NIC IRQs pinned there — enable RSS or move IRQ affinity.

### Q2. What does `perf top` show and when do you use it?
**Interviewer signal:** Comfortable with sampling profilers in prod.
**Answer:**
- Live sampling profile of what functions/symbols are consuming CPU across the system, updated in real time.
- Great when a process is CPU-bound and you need a first guess at the hot path without attaching a full profiler.
- `perf top -p <pid>` narrows to one process; add `-g` for call graphs.
- Needs debug symbols to be useful — otherwise you see raw addresses or stripped names.

**Watch-outs:** Sampling overhead is low but non-zero; don't leave it running on a latency-sensitive matcher in prod.

### Q3. `top` vs `top -H` — what changes?
**Interviewer signal:** Understands thread-level view.
**Answer:**
- Default `top` shows one row per process; a multi-threaded OMS looks like one entry summing all threads.
- `top -H` shows one row per thread (TID in the PID column) so you can see which thread is hot.
- Press `H` inside top to toggle at runtime.
- Match the TID back to a Java thread name via `jstack <pid>` + `printf '%x\n' <tid>` (nid in jstack).

**Watch-outs:** In Java, nid in jstack is hex; TID from top is decimal — convert before searching.

### Q4. What is `taskset` and when do you pin threads to CPUs?
**Interviewer signal:** Latency-tuning awareness.
**Answer:**
- `taskset -c 2,3 ./oms` launches with CPU affinity restricted to cores 2 and 3.
- `taskset -pc 2 <pid>` re-pins an existing process; `taskset -a` covers all threads.
- Used for latency-sensitive paths: pin the matcher/FIX reader to isolated cores (paired with `isolcpus` or `cpuset`) to avoid scheduler jitter.
- Complements IRQ affinity (`/proc/irq/<n>/smp_affinity`) — keep NIC IRQs off the hot cores.

**Watch-outs:** Pinning without isolating the core means the kernel still schedules other tasks there; you gain little.

### Q5. What is NUMA and how does `numactl` help?
**Interviewer signal:** Multi-socket box awareness.
**Answer:**
- On multi-socket servers, each socket has its own memory bank; accessing remote-socket memory is slower.
- `numactl --hardware` lists nodes, CPUs per node, and free memory per node.
- `numactl --cpunodebind=0 --membind=0 ./oms` runs the process only on node 0's CPUs and RAM — avoids cross-socket hops.
- Symptoms of NUMA neglect: high memory bandwidth, elevated latency variance, `numastat` showing lots of `numa_miss`/`numa_foreign`.

**Watch-outs:** JVMs need `-XX:+UseNUMA` (parallel GC) or careful pinning; a Java heap sprawled across nodes silently loses latency.

## 7. Log parsing

### Q1. When do you reach for `grep -E` over plain `grep`?
**Interviewer signal:** Regex fluency.
**Answer:**
- `grep -E` (or `egrep`) enables extended regex: `|` alternation, `+`, `?`, `()` without backslashes.
- Example: `grep -E 'ERROR|FATAL|Reject' oms.log` to catch multiple severities in one pass.
- Add `-i` (case), `-n` (line numbers), `-C 3` (context lines), `-v` (invert), `-c` (count).
- For a fixed string with no regex, `grep -F` is faster and safer against special chars.

**Watch-outs:** `grep -P` (Perl regex) is powerful but not portable; stick to `-E` in shared scripts.

### Q2. How do you slice a specific field from a log line with `awk`?
**Interviewer signal:** Basic awk chops.
**Answer:**
```
# print timestamp (col 1) and order id (col 5) for rejects
awk '/Reject/ {print $1, $5}' oms.log

# custom delimiter (pipe)
awk -F'|' '{print $3}' feed.log

# sum column 7
awk '{s+=$7} END {print s}' pnl.log
```
- `$0` is the whole line, `$1..$N` are fields, `NF` is field count, `NR` is line number.

**Watch-outs:** Default field splitter is any whitespace run — mixed tabs/spaces still work, but a single embedded space inside a field will split it.

### Q3. When should you use `sed -i` and when should you not?
**Interviewer signal:** Understands in-place edit risks.
**Answer:**
- `sed -i 's/old/new/g' file` edits in place; `sed -i.bak` keeps a `.bak` backup.
- Great for config edits, batch renames of hostnames in properties files, quick FIX tag substitutions in captured logs.
- Never run `sed -i` blindly on rotated live logs — you can race with the writer and corrupt the file.
- On macOS BSD sed the syntax is `sed -i '' 's/.../.../'` — annoying gotcha in cross-platform scripts.

**Watch-outs:** Test the substitution without `-i` first, then add it once the diff looks right.

### Q4. `tail -f` vs `less +F` — when do you use each?
**Interviewer signal:** Real day-to-day log habits.
**Answer:**
- `tail -f oms.log` streams appends; simple, no navigation, Ctrl-C to exit.
- `less +F oms.log` streams too, but Ctrl-C drops you into normal less where you can search (`/pattern`), jump, and then `F` again to resume follow.
- `tail -F` (capital F) survives log rotation by reopening the file when the inode changes.
- For debugging live, `less +F` wins because you can pause, grep backwards, then resume without losing your place.

**Watch-outs:** Plain `tail -f` gets stuck on the old inode after logrotate; always prefer `-F` on production logs.

### Q5. How do you grep across rotated/compressed logs?
**Interviewer signal:** Real ops experience.
**Answer:**
- `zgrep 'ClOrdID=ABC' oms.log.*.gz` transparently decompresses `.gz` files.
- Siblings: `zcat`, `zless`, `zdiff`, and `xzgrep`/`bzgrep` for `.xz`/`.bz2`.
- Combine with a date-sorted glob: `zgrep -h 'Reject' oms.log-2026-07-1{5,6,7}.gz | awk '{...}'`.
- For a large rotation set, `find … -name 'oms.log.*.gz' -print0 | xargs -0 zgrep -l 'ClOrdID=ABC'` first narrows the files, then you deep-dive.

**Watch-outs:** `zgrep` prints the filename by default across multiple files (`-h` to suppress); order of `.gz` names is lexical, not chronological.

## 8. FIX log parsing

### Q1. How do you grep a FIX log where the delimiter is SOH (0x01)?
**Interviewer signal:** Knows FIX wire format.
**Answer:**
- FIX fields are separated by SOH (`\x01`), which is invisible in most viewers — files often look like one long line.
- Tell awk explicitly: `awk -F$'\x01' '{...}'` (bash ANSI-C quoting).
- To make a log human-readable: `tr '\001' '|' < fix.log | less`.
- To keep SOH but pretty-print per-message, split on `8=FIX` first: `awk 'BEGIN{RS="8=FIX"} {print "8=FIX"$0}' fix.log`.

**Watch-outs:** Do not run `sed -i` with `\x01` substitutions on the live capture — you'll break replay.

### Q2. How do you pull just the NewOrderSingles from a FIX log?
**Interviewer signal:** Knows msg types.
**Answer:**
- MsgType tag is 35; NewOrderSingle is `35=D`.
- `grep -a $'\x01''35=D''\x01' fix.log` — the `-a` treats binary as text, the SOH anchors avoid matching `35=D` inside another field.
- Or `awk -F$'\x01' '{for(i=1;i<=NF;i++) if($i=="35=D") {print; next}}' fix.log`.
- Common types to remember: D (New), F (Cancel), G (Replace), 8 (ExecReport), 9 (OrderCancelReject), 3 (Reject).

**Watch-outs:** A raw `grep 35=D` without SOH anchors will false-match `Text=order 35=D...` inside a free-text field.

### Q3. How do you extract ClOrdID, SenderCompID, TargetCompID by tag?
**Interviewer signal:** Tag-based parsing.
**Answer:**
- Tags: 11 = ClOrdID, 49 = SenderCompID, 56 = TargetCompID.
- Awk pattern:
```
awk -F$'\x01' '{
  for(i=1;i<=NF;i++){
    split($i,kv,"=");
    if(kv[1]==11) c=kv[2];
    if(kv[1]==49) s=kv[2];
    if(kv[1]==56) t=kv[2];
  }
  print s, t, c
}' fix.log
```
- For quick one-offs: `grep -oE $'\x01''11=[^\x01]+' fix.log | cut -d= -f2 | sort -u`.

**Watch-outs:** Tag 41 (OrigClOrdID) is what you join on for cancels/replaces, not 11.

### Q4. How do you reconstruct an order lifecycle from a FIX log?
**Interviewer signal:** Can build an end-to-end trace.
**Answer:**
- Grab the ClOrdID (11) and OrigClOrdID (41) chain for the order in question.
- Filter: `grep -aE $'\x01'"(11|41)=ABC123"$'\x01' fix.log` to catch the New plus any Cancel/Replace referring to it.
- Follow ExecReports (`35=8`) matched by OrderID (37) — broker-assigned and stable across cancel/replace, unlike ClOrdID which changes on replace.
- Sort by SendingTime (52) to order the events, then map ExecType (150): 0=New, 4=Cancelled, 5=Replaced, F=Trade, 8=Rejected.

**Watch-outs:** ClOrdID changes on every replace; only OrderID (37) is stable — build the story around 37, not 11.

### Q5. How do you count fills or rejects by symbol from a FIX log?
**Interviewer signal:** Aggregation with awk.
**Answer:**
```
# fills per symbol (tag 55=symbol, 150=2 is Fill, 150=F is Trade in FIX 4.4)
awk -F$'\x01' '
  { sym=""; et="";
    for(i=1;i<=NF;i++){ split($i,kv,"=");
      if(kv[1]==55) sym=kv[2];
      if(kv[1]==150) et=kv[2]; }
    if(et=="F") cnt[sym]++
  }
  END{ for(s in cnt) print s, cnt[s] }' fix.log | sort -k2 -nr
```
- Swap `et=="F"` for `et=="8"` to count Rejects.
- Pipe to `sort -k2 -nr | head` to get top offenders.

**Watch-outs:** In FIX 4.2 fills are 150=1/2 (partial/full); in 4.4 use 150=F with ExecType — check your session's version before trusting counts.

## 9. Shell scripting

### Q1. How do bash arrays work and when do you use them?
**Interviewer signal:** Beyond string-of-space-separated tokens.
**Answer:**
```
sessions=(FIX_LSE FIX_NYSE FIX_TSE)
echo "${sessions[0]}"       # first
echo "${sessions[@]}"       # all as separate words
echo "${#sessions[@]}"      # count
for s in "${sessions[@]}"; do restart "$s"; done
sessions+=(FIX_HKEX)        # append
```
- Always quote `"${arr[@]}"` — unquoted, elements with spaces get re-split.
- Associative arrays: `declare -A m; m[NYSE]=up; echo "${m[NYSE]}"` (bash 4+).

**Watch-outs:** `${arr[*]}` joins with IFS[0]; `${arr[@]}` keeps elements separate — pick deliberately.

### Q2. What are the most useful parameter expansions?
**Interviewer signal:** Writes clean shell without external tools.
**Answer:**
- `${var:-default}` — use default if unset/empty; `${var:=default}` also assigns.
- `${var:?err msg}` — exit with error if unset (great in scripts).
- `${var#prefix}` / `${var##prefix}` — strip shortest/longest prefix; `%` / `%%` for suffix.
- `${var/old/new}` — first replace; `${var//old/new}` — all replace.
- `${var:offset:len}` — substring; `${#var}` — length.
- Example: `logdate="${file##*-}"; logdate="${logdate%.gz}"` extracts date from `oms-2026-07-18.gz`.

**Watch-outs:** These are pure bash — no fork of `sed`/`cut`, so they're much faster in tight loops.

### Q3. Why do quoting and IFS matter so much?
**Interviewer signal:** Understands word splitting.
**Answer:**
- Unquoted `$var` undergoes word splitting on IFS (default: space/tab/newline) and glob expansion — filenames with spaces or `*` break scripts.
- Always quote: `cp "$src" "$dst"`, `for f in "$@"`, `[[ -n "$x" ]]`.
- Change IFS carefully: `IFS=',' read -ra parts <<< "a,b,c"` splits a CSV into an array; restore or scope IFS with a subshell.
- `"$@"` preserves each positional arg intact; `"$*"` joins them with IFS[0] — different tools.

**Watch-outs:** `set -u` (nounset) catches unset var usage; `set -o pipefail` makes pipelines fail on any stage error — both belong in prod scripts.

### Q4. What is process substitution `<(cmd)` and when is it useful?
**Interviewer signal:** Knows bash beyond pipes.
**Answer:**
- `<(cmd)` exposes a command's output as a filename (typically `/dev/fd/63`), so tools that need file args can consume streams.
- Classic use: `diff <(ssh host1 'ls /var/log') <(ssh host2 'ls /var/log')` — diff two remote listings without temp files.
- Also: `comm -12 <(sort a) <(sort b)` for intersection; `paste <(cut -f1 x) <(cut -f2 y)` for joining columns.
- `>(cmd)` is the output variant — send a stream to a command that expects a filename to write.

**Watch-outs:** Not POSIX — needs bash/zsh/ksh; won't work under `sh` on minimal containers.

### Q5. How do you use `trap` for cleanup?
**Interviewer signal:** Writes scripts that don't leave garbage.
**Answer:**
```
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT           # always cleanup
trap 'echo "interrupted"; exit 130' INT TERM
```
- `EXIT` fires on any exit path — normal, error, or signal — best place for cleanup.
- Common signals: `INT` (Ctrl-C), `TERM` (kill), `HUP` (terminal closed).
- Reset a trap with `trap - EXIT`.
- Combine with `set -e` so errors trigger EXIT and cleanup still runs.

**Watch-outs:** `trap` on `ERR` only fires under `set -e` and has surprising rules inside functions — prefer `EXIT` for cleanup.

## 10. Cron & systemd

### Q1. Why does a script that works in the shell fail under cron?
**Interviewer signal:** Knows cron env is not login env.
**Answer:**
- Cron runs with a minimal environment: PATH is short (often `/usr/bin:/bin`), no `.bashrc`/`.profile` sourced, no `TERM`, no aliases.
- Symptoms: `command not found` for Java/mvn/kubectl, wrong `JAVA_HOME`, no locale so `LANG` defaults break date parsing.
- Fix: set env inside the crontab (`PATH=...` at top), source the profile explicitly (`bash -lc 'script.sh'`), or set absolute paths in the script.
- Redirect stdout/stderr (`>>/var/log/x.log 2>&1`) — otherwise cron mails output and you lose it silently on servers with no mailer.

**Watch-outs:** Cron doesn't understand `%` — it's treated as newline in the command; escape as `\%` in crontab entries.

### Q2. Cron vs systemd timers — which do you pick?
**Interviewer signal:** Modern Linux awareness.
**Answer:**
- Cron: simple, universal, one-line schedule, but no dependencies, weak logging, no retry, no missed-run catch-up.
- Systemd timer: pairs with a `.service` unit — you get journald logs, restart policies, `OnCalendar=` schedules, `Persistent=true` to run after downtime, resource limits (CPU/IO), and dependencies on other units.
- Pick systemd when the job matters (needs logging, alerting, retry) or interacts with other services; cron for trivial rotations/cleanups.
- Inspect: `systemctl list-timers`, `journalctl -u myjob.service`.

**Watch-outs:** Systemd timer names should mirror the service (`foo.timer` + `foo.service`); `OnCalendar=` uses its own syntax, not cron's.

### Q3. What are soft vs hard ulimits and how do you set them?
**Interviewer signal:** Prod tuning.
**Answer:**
- Hard limit: ceiling set by root; only root can raise it. Soft limit: current value the process sees; user can raise up to hard.
- Common ones: `nofile` (open FDs), `nproc` (processes/threads), `memlock`, `core`, `stack`.
- Set per-user in `/etc/security/limits.conf` (or drop-ins in `/etc/security/limits.d/`) for PAM sessions.
- For systemd services, `limits.conf` is ignored — use `LimitNOFILE=`, `LimitNPROC=` in the unit file, then `systemctl daemon-reload`.

**Watch-outs:** OMS processes hitting `Too many open files` under load is almost always a `nofile` soft limit; check with `cat /proc/<pid>/limits`, not the shell's `ulimit -n`.

### Q4. Systemd service Type= — simple vs forking vs notify?
**Interviewer signal:** Writes correct unit files.
**Answer:**
- `Type=simple` (default): main process is the `ExecStart` PID; systemd considers it started as soon as it forks. Fine for foreground apps.
- `Type=forking`: `ExecStart` forks and the parent exits; systemd tracks the child via PIDFile. Legacy daemons.
- `Type=notify`: process calls `sd_notify(READY=1)` when actually ready — best for services with slow startup (JVMs, databases) so dependents wait for real readiness.
- `Type=oneshot`: runs once and exits; combine with `RemainAfterExit=yes` for one-shot state changes.

**Watch-outs:** With `Type=simple`, dependent services can start before yours is truly ready; use `notify` and emit readiness after connecting to downstream (FIX sessions up, cache warmed).

### Q5. How do you tail and filter systemd service logs?
**Interviewer signal:** journald fluency.
**Answer:**
```
journalctl -u oms.service -f              # follow
journalctl -u oms.service --since "10 min ago"
journalctl -u oms.service -p err          # errors and worse
journalctl -u oms.service -o cat          # message only, no metadata
journalctl _PID=12345                     # by PID
journalctl --disk-usage                   # storage used
```
- Persistent logs live under `/var/log/journal/` if `Storage=persistent` in `journald.conf`; otherwise volatile in `/run/log/journal/`.

**Watch-outs:** journald rate-limits by default (`RateLimitBurst`); a spammy service can drop lines silently — check `journalctl --verify` and `RateLimit*` settings.
## 11. Kernel tuning

### Q1. What does `net.core.somaxconn` control and when do you raise it?
**Interviewer signal:** Do you understand the listen backlog?
**Answer:** It caps the accept queue depth for a listening socket (completed 3-way handshakes waiting for `accept()`). Default (128 on older kernels, 4096 on newer) is often too small for FIX gateways or busy load balancers where bursts of reconnects hit at once. If it overflows you see `ListenOverflows`/`ListenDrops` in `netstat -s` and clients get RSTs or timeouts. We typically raise to 4096-32768 on trading gateways, and the app must also pass a matching `backlog` to `listen()`.
```bash
sysctl -w net.core.somaxconn=16384
# persist in /etc/sysctl.d/99-tuning.conf
```
**Watch-outs:** Kernel cap is useless if the app hardcodes `listen(fd, 128)`.

### Q2. What is `net.ipv4.tcp_tw_reuse` and when is it safe?
**Interviewer signal:** TIME_WAIT hygiene.
**Answer:** Allows the kernel to reuse a socket in `TIME_WAIT` for a new outgoing connection when the timestamp on the new SYN is strictly greater than the last one seen. Safe for outbound client-side connections (e.g., an OMS calling downstream services) where you're exhausting ephemeral ports. Unlike the removed `tcp_tw_recycle`, it's NAT-safe. Turn it on when `ss -s` shows tens of thousands of TIME_WAITs and you get `EADDRNOTAVAIL`.
```bash
sysctl -w net.ipv4.tcp_tw_reuse=1
```
**Watch-outs:** Only affects outbound; won't fix server-side TIME_WAIT buildup.

### Q3. What is `tcp_max_syn_backlog` and how does it differ from `somaxconn`?
**Interviewer signal:** SYN queue vs. accept queue.
**Answer:** `tcp_max_syn_backlog` sizes the SYN queue (half-open, SYN received but 3WHS not complete). `somaxconn` sizes the accept queue (handshake done, waiting for the app). SYN backlog matters under SYN floods or reconnect storms. Raise both together; also enable SYN cookies as a safety net. Symptoms of undersize: `TCPReqQFullDoCookies` / drops in `nstat`.
```bash
sysctl -w net.ipv4.tcp_max_syn_backlog=8192
sysctl -w net.ipv4.tcp_syncookies=1
```
**Watch-outs:** Cookies bypass some TCP options; fine as overflow safety but not steady state.

### Q4. What does `fs.file-max` do and how do you set per-process limits?
**Interviewer signal:** FD exhaustion on a busy gateway.
**Answer:** `fs.file-max` is the system-wide ceiling on open file descriptors. Per-process limits are set via `ulimit -n` / `/etc/security/limits.conf` or a systemd unit's `LimitNOFILE=`. On an OMS handling thousands of FIX sessions plus DB connections plus log files, we set the process to 65536+ and the system max well above that. Check with `cat /proc/<pid>/limits` and `lsof -p <pid> | wc -l`.
```bash
sysctl -w fs.file-max=2097152
# systemd unit
LimitNOFILE=65536
```
**Watch-outs:** Setting only `ulimit` in a login shell won't affect a service started by systemd.

### Q5. What is `vm.swappiness` and what value do you use for a trading server?
**Interviewer signal:** Latency-sensitive tuning.
**Answer:** Controls how aggressively the kernel swaps anonymous pages out to disk (0-100, default 60). For latency-sensitive apps (OMS, matching, market data) we set it low (1 or 10) so JVM/native heap stays in RAM. 0 means "only swap to avoid OOM" — still allowed. Combine with `vm.dirty_ratio`/`dirty_background_ratio` tuning and disable transparent huge pages if using a low-latency JVM.
```bash
sysctl -w vm.swappiness=1
```
**Watch-outs:** Setting to 0 doesn't disable swap; it just discourages it heavily.

## 12. SSL/TLS operational

### Q1. How do you check what cert a server is presenting?
**Interviewer signal:** Basic openssl fluency.
**Answer:**
```bash
openssl s_client -connect fixgw.internal:4443 -servername fixgw.internal -showcerts </dev/null
```
`-showcerts` dumps the full chain the server sends. `-servername` sets SNI, critical when one IP hosts multiple certs. Pipe to `openssl x509 -noout -subject -issuer -dates` to inspect specific certs. For TLS 1.3 add `-tls1_3`; for mutual TLS add `-cert` and `-key`.
**Watch-outs:** Without `-servername`, you may get the wrong cert on multi-tenant load balancers.

### Q2. How do you check cert expiry quickly across many hosts?
**Interviewer signal:** Ops automation instinct.
**Answer:**
```bash
echo | openssl s_client -connect host:443 -servername host 2>/dev/null \
  | openssl x509 -noout -enddate -subject
```
For a file: `openssl x509 -in cert.pem -noout -enddate`. Wrap in a loop over hostnames and alert if `notAfter` is within 30 days. Better: push into Prometheus via blackbox exporter's `probe_ssl_earliest_cert_expiry` metric so alerts fire from monitoring, not cron.
**Watch-outs:** `-enddate` shows the leaf only; intermediates can expire too — check the whole chain.

### Q3. What is a CA bundle and where does it live on Linux?
**Interviewer signal:** Trust store awareness.
**Answer:** A CA bundle is a concatenated PEM file of trusted root (and sometimes intermediate) certificates. On RHEL/Rocky: `/etc/pki/ca-trust/source/anchors/` (drop PEM here, run `update-ca-trust`); the consolidated bundle is at `/etc/pki/tls/certs/ca-bundle.crt`. On Debian/Ubuntu: `/usr/local/share/ca-certificates/`, then `update-ca-certificates`; bundle at `/etc/ssl/certs/ca-certificates.crt`. Java uses its own truststore (`cacerts`, managed with `keytool`) — updating the OS bundle doesn't help the JVM.
**Watch-outs:** curl/openssl use OS bundle; Java, Node, Python each have their own — verify per runtime.

### Q4. `s_client` returns "unable to verify the first certificate" — what does that mean?
**Interviewer signal:** Chain debugging.
**Answer:** The server didn't send an intermediate cert, and your local trust store only has the root. Fix on the server by concatenating leaf + intermediate(s) into the served chain (order: leaf, intermediate, [root optional]). Verify with `-showcerts`; you should see depth 0 (leaf), depth 1 (intermediate), etc. Test with `-CAfile /path/to/intermediate.pem` to confirm the missing piece.
**Watch-outs:** Browsers cache intermediates so they mask the issue; scripts, Java clients, and mobile apps fail.

## 13. SSH

### Q1. How do you set up passwordless key-based auth?
**Interviewer signal:** Basic ops.
**Answer:**
```bash
ssh-keygen -t ed25519 -C "aditya@laptop"
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host
# or manually append pubkey to remote ~/.ssh/authorized_keys
```
Ensure remote perms: `~/.ssh` 700, `authorized_keys` 600, home dir not group-writable. On the server, `PasswordAuthentication no` and `PubkeyAuthentication yes` in `sshd_config`. Use ed25519 over RSA for new keys; add a passphrase and use `ssh-agent` so you type it once per session.
**Watch-outs:** SELinux contexts on `~/.ssh` can silently break it — `restorecon -R ~/.ssh`.

### Q2. What is `ProxyJump` and when do you use it?
**Interviewer signal:** Bastion/jumphost pattern.
**Answer:** `ProxyJump` (aka `-J`) tunnels SSH through one or more bastion hosts to reach an isolated target — the destination doesn't need to be routable from your laptop.
```bash
ssh -J bastion.dmz.example.com user@internal-oms-01
# or in ~/.ssh/config:
Host internal-oms-*
  ProxyJump bastion.dmz.example.com
  User aditya
```
Chain multiple: `-J bastion1,bastion2`. Each hop authenticates independently — agent forwarding avoids copying keys to bastions.
**Watch-outs:** Don't enable `ForwardAgent` blindly on untrusted bastions; prefer `ProxyJump` which never lands your key on the hop.

### Q3. Explain local vs. remote vs. dynamic port forwarding.
**Interviewer signal:** Do you understand tunnel directions?
**Answer:**
- **Local (`-L`)**: `ssh -L 5432:dbhost:5432 bastion` — listen on my laptop:5432, forward through bastion to dbhost:5432. Use for reaching a service behind a bastion.
- **Remote (`-R`)**: `ssh -R 8080:localhost:8080 remote` — listen on remote:8080, forward back to my laptop:8080. Use to expose a local service to a remote box (e.g., for callback testing).
- **Dynamic (`-D`)**: `ssh -D 1080 bastion` — starts a SOCKS5 proxy on laptop:1080; any app pointed at it tunnels through bastion. Use as a poor-man's VPN.

**Watch-outs:** `-R` requires `GatewayPorts yes` on the remote to bind non-loopback; otherwise only reachable from the remote itself.

### Q4. Your SSH session hangs on long-running commands. What do you tune?
**Interviewer signal:** Keepalives.
**Answer:** Firewalls/NAT drop idle TCP flows. Client side, in `~/.ssh/config`:
```
Host *
  ServerAliveInterval 30
  ServerAliveCountMax 3
  TCPKeepAlive yes
```
Server side (`sshd_config`): `ClientAliveInterval 30`, `ClientAliveCountMax 3`. For truly long jobs, run under `tmux` or `screen` so a disconnect doesn't kill the process. `nohup cmd &` + `disown` is the quick alternative.
**Watch-outs:** Setting `ServerAliveInterval` too low (e.g., 5s) generates noise and can hide real network issues.

## 14. GDB & tracing

### Q1. How do you attach gdb to a running PID and get a backtrace?
**Interviewer signal:** Live production debug.
**Answer:**
```bash
sudo gdb -p <pid>
(gdb) bt              # backtrace current thread
(gdb) thread apply all bt   # all threads
(gdb) detach
(gdb) quit
```
For non-interactive snapshot: `gdb -batch -ex "thread apply all bt" -p <pid>`. Requires matching debug symbols (`*-debuginfo` RPM or `.debug` files). Attaching pauses the process — do it briefly on a live trading gateway or during a controlled window.
**Watch-outs:** `ptrace_scope=1` (default on many distros) blocks non-parent attach; use `sudo` or `sysctl kernel.yama.ptrace_scope=0` temporarily.

### Q2. How do you analyze a coredump post-mortem?
**Interviewer signal:** Do they know offline analysis?
**Answer:**
```bash
# ensure cores are enabled
ulimit -c unlimited
# path pattern
sysctl kernel.core_pattern
# analyze
gdb /path/to/binary /path/to/core.<pid>
(gdb) bt full
(gdb) info threads
(gdb) thread apply all bt
```
On systems with `systemd-coredump`, use `coredumpctl list` and `coredumpctl gdb <pid>`. Make sure the binary and libraries match the crashing host — mismatched symbols give useless traces. Ship debuginfo separately in most enterprise builds.
**Watch-outs:** Cores can contain PII / secrets / customer order data — treat as sensitive and clean up.

### Q3. Difference between `thread apply all bt` and `bt`?
**Interviewer signal:** Multi-threaded awareness.
**Answer:** `bt` only prints the current thread's backtrace — useless on a server with 200 worker threads where the culprit is a stuck lock in another thread. `thread apply all bt` walks every thread and prints each stack. `thread apply all bt full` also prints local variables per frame — noisy but invaluable for deadlocks. Look for many threads parked in `pthread_cond_wait` on the same mutex — that's your contention point.
**Watch-outs:** `full` output can be huge (MBs); redirect to a file with `set logging on`.

### Q4. When do you use `strace -f -p <pid>`?
**Interviewer signal:** Syscall-level diagnosis.
**Answer:** When a process is "stuck" or slow and you need to see what syscalls it's actually making — waiting on a socket read, spinning on `futex`, blocked in `fsync`. `-f` follows child threads/forks; `-p` attaches to a running PID. Add `-e trace=network` to filter, `-T` for per-call time, `-c` for a summary.
```bash
strace -f -T -e trace=network -p 12345
strace -c -p 12345   # then Ctrl-C for summary
```
**Watch-outs:** strace slows the target 2-10x — never leave attached to a hot trading process; use for short samples.

### Q5. What is `perf record` used for?
**Interviewer signal:** CPU profiling instinct.
**Answer:** Sampling profiler using hardware perf counters — near-zero overhead vs. instrumentation. Use to find hot functions in a busy OMS, cache misses, branch mispredicts.
```bash
sudo perf record -F 99 -p <pid> -g -- sleep 30
sudo perf report            # interactive
sudo perf script | flamegraph.pl > out.svg   # flame graph
```
`-F 99` = 99 Hz sampling, `-g` captures call graphs. For system-wide add `-a`. Great for "CPU is at 100%, where?" questions.
**Watch-outs:** Needs frame pointers or DWARF unwinding (`--call-graph dwarf`) for accurate stacks; JIT'd JVM code needs perf-map-agent.

## 15. Trading-support scenarios

### Q1. Find the PID listening on the FIX port 5001.
**Interviewer signal:** Bread-and-butter triage.
**Answer:**
```bash
ss -ltnp 'sport = :5001'
# or
sudo lsof -iTCP:5001 -sTCP:LISTEN -Pn
# fallback
sudo netstat -ltnp | grep :5001
```
Prefer `ss` — faster than `netstat` on high-connection hosts. `-Pn` on lsof avoids DNS/service-name lookups that stall.
**Watch-outs:** Without root/sudo you only see your own processes' sockets.

### Q2. Grep a 5GB FIX log fast for a specific ClOrdID.
**Interviewer signal:** Big-log discipline.
**Answer:**
```bash
LC_ALL=C grep -F "11=ABC123XYZ" /var/log/fix/session.log
# or ripgrep if available
rg -F "11=ABC123XYZ" /var/log/fix/session.log
```
- `LC_ALL=C` disables UTF-8 handling — 3-5x faster.
- `-F` fixed-string, no regex parsing.
- If the log is rotated: `zgrep -F` across `.gz` shards.
- For repeat queries, index once with `awk` or load into a small SQLite.

**Watch-outs:** Piping through `less` on a 5GB file kills terminal responsiveness — redirect to a file.

### Q3. Extract the full order lifecycle for one ClOrdID from FIX logs.
**Interviewer signal:** Do you know FIX chaining?
**Answer:** A single ClOrdID isn't enough — cancels/replaces generate new ClOrdIDs linked via `OrigClOrdID (41)`. Approach:
1. Grep initial ClOrdID → find `NewOrderSingle`, `ExecutionReports`.
2. Extract any `41=<origClOrdID>` referencing it → those are the replaces/cancels.
3. Recursively follow the chain.
```bash
CID="ABC123"
grep -F "11=$CID\|41=$CID" session.log | sort -k1,1
```
Better: pin on the exchange `OrderID (37)` once assigned — it's stable across amendments. In production we have a small script that walks 11↔37↔41 to render the tree.
**Watch-outs:** Multi-leg / basket orders share correlation via `ListID (66)`; don't forget those.

### Q4. How do you safely drain a message queue before a restart?
**Interviewer signal:** Do you respect in-flight orders?
**Answer:**
- **Stop inbound**: pull the app out of the LB / stop new sessions accepting (`Logout` new FIX logons, disable ingress).
- **Let inflight drain**: monitor queue depth (e.g., `rabbitmqctl list_queues`, Kafka lag, or app metric) until 0 or stable.
- **Signal graceful shutdown**: `SIGTERM` (not `SIGKILL`) so the app flushes state, acks outstanding messages, and writes checkpoints.
- **Verify persistence**: for FIX, ensure the message store (sequence numbers) is fsynced; for orders, DB commits done.
- **Then stop dependencies**.

**Watch-outs:** `kill -9` in a hurry loses unacked messages and desyncs FIX sequence numbers — recovery is painful.

### Q5. Find zombie processes and their parents.
**Interviewer signal:** Process hygiene.
**Answer:**
```bash
ps -eo pid,ppid,state,cmd | awk '$3=="Z"'
# or
ps aux | awk '$8 ~ /Z/ { print }'
```
Zombies are dead children whose parent hasn't called `wait()`. You can't kill a zombie directly (it's already dead) — you send `SIGCHLD` to the parent, or if the parent is broken, restart the parent so `init`/`systemd` reaps them. A handful is harmless; hundreds indicates a bug in a supervisor script that spawns children without reaping.
**Watch-outs:** Zombies hold a PID slot but no memory/CPU; the real problem is the buggy parent, not the zombie count.

### Q6. A trader says "orders are slow" — first 5 commands you run.
**Interviewer signal:** Structured triage.
**Answer:**
```bash
# 1. Load & CPU
uptime; top -bn1 | head -20
# 2. Memory / swap pressure
free -h; vmstat 1 5
# 3. IO
iostat -xz 1 5
# 4. Network to exchange / downstream
ss -tnp | grep <exchange_ip>; ping -c 3 <exchange_ip>
# 5. App-level: FIX session state, queue depth, GC
grep -c "35=D" /var/log/fix/session.log   # order rate proxy
jstat -gcutil <pid> 1000 5                # if JVM
```
Then correlate against monitoring dashboards (latency histograms, queue lag) before touching anything.
**Watch-outs:** Don't restart the process before capturing state — you'll destroy the evidence.

### Q7. How do you find which process is eating disk on `/var`?
**Interviewer signal:** Disk-fill emergency.
**Answer:**
```bash
# where is the space going?
du -h -x -d 1 /var | sort -h | tail -20
# which process is writing hot?
sudo iotop -oPa       # accumulated writes per process
# open files a process holds (deleted but still open = space leak)
sudo lsof +L1 | grep /var
```
A common trap: a log file was `rm`'d but the process still has it open, so `df` shows full while `du` shows fine. Fix: `truncate -s 0` while process is running, or restart the process. Then set up log rotation properly.
**Watch-outs:** Don't `rm` a hot log — always truncate or use `logrotate` with `copytruncate`.
