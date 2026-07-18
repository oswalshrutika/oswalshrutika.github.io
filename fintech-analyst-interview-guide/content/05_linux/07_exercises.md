# 07 — Linux / Shell Exercises (Hands-on)

## Contents
1. Count `35=D` (NewOrderSingle) messages by (SenderCompID, TargetCompID)
2. Top 10 slowest heartbeat gaps in the last hour
3. `TIME_WAIT` sockets per remote host
4. Processes owned by user `flex` with RSS > 2 GB
5. Rename all `*.log` older than 7 days with `.old` suffix in one command
6. Sort a log with out-of-order timestamps
7. Continuously monitor and alert when a line matches `REJECT.*35=8`
8. Print 3 lines of context around each match of `ORD-12345`
9. Extract unique ClOrdIDs from a compressed `.gz` log
10. Compute per-minute message rate over the last hour
11. Find sessions whose `MsgSeqNum` jumped by more than 10 in one step
12. Show top 5 fattest FDs on a running process
13. Find TCP ports listening but with no established connection
14. Find the PID holding TCP port 12345
15. Compute time-delta between `35=D` and first `35=8` per ClOrdID
16. Grep messages between 09:30:00 and 09:31:00 without loading the whole file
17. Bash function to base64-decode SOH-delimited FIX lines
18. Find processes with the most page faults in the last minute
19. Show CPU cores >90% saturated for 60 s
20. `tcpdump` command to capture only outbound FIX traffic to a specific broker IP

---

**Setup assumption for every problem below**

Sample FIX log at `/var/log/oms/fix.log`. Lines are SOH-delimited (`\x01` between tags), but for readability the examples below render SOH as `|`. When copy-pasting the actual commands, `\x01` is the true delimiter — the commands account for this.

Example line:
```
20260718-14:30:00.123|8=FIX.4.2|9=142|35=D|49=CLIENT1|56=OMS|34=42|11=ORD-1|55=AAPL|54=1|38=100|40=2|44=185.50|10=015
```

---

### Q1. Count `35=D` (NewOrderSingle) messages by (SenderCompID, TargetCompID)
**Interviewer signal:** They want to see comfort with `grep + awk` on delimited data and whether the candidate reaches for the SOH byte correctly.
**Answer:**
```bash
grep -F $'\x0135=D\x01' /var/log/oms/fix.log \
  | awk -F'\x01' '
      {
        s=""; t="";
        for (i=1; i<=NF; i++) {
          if ($i ~ /^49=/) s=substr($i,4);
          if ($i ~ /^56=/) t=substr($i,4);
        }
        print s"|"t
      }' \
  | sort | uniq -c | sort -rn
```
Expected output:
```
   4821 CLIENT1|OMS
   3902 CLIENT2|OMS
   1180 OMS|BROKER_X
```
**Explanation:** `grep -F` fixed-string on the SOH-wrapped literal `\x0135=D\x01` avoids matching `35=D` occurring inside a value. `awk -F'\x01'` splits on SOH and pulls only tags 49 and 56 — order-independent within the message.
**Watch-outs:** `grep 35=D` (without SOH anchors) matches spurious substrings like `1235=D...`; and `awk '$4 ~ /35=D/'` assumes positional layout which FIX never guarantees.

---

### Q2. Top 10 slowest heartbeat gaps in the last hour
**Interviewer signal:** Can the candidate parse timestamps, compute deltas, and filter a time window without pulling the whole file into memory.
**Answer:**
```bash
# HeartBeat = 35=0. Timestamps in the leading field: YYYYMMDD-HH:MM:SS.mmm
awk -F'\x01' -v cutoff="$(date -u -d '1 hour ago' +%Y%m%d-%H:%M:%S)" '
  /\x0135=0\x01/ {
    ts=$1
    if (ts < cutoff) next
    # convert to epoch-ms
    gsub(/[-:.]/, " ", ts)
    split(ts, a, " ")
    t = mktime(substr(a[1],1,4)" "substr(a[1],5,2)" "substr(a[1],7,2)" "a[2]" "a[3]" "a[4]) * 1000 + a[5]
    sess=""
    for (i=1;i<=NF;i++) if ($i ~ /^49=/) sess=substr($i,4)
    if (sess in last) {
      d = t - last[sess]
      print d" ms  "sess"  @"$1
    }
    last[sess] = t
  }' /var/log/oms/fix.log \
  | sort -rn | head -10
```
Expected output:
```
92310 ms  CLIENT2  @20260718-13:41:12.004
45120 ms  BROKER_X @20260718-13:12:55.870
41008 ms  CLIENT1  @20260718-13:58:07.221
...
```
**Explanation:** `mktime` gives seconds since epoch, then add the ms suffix. Per-session `last[]` holds the previous heartbeat, so `d` is the wall-clock gap. Cutoff string compare works because the log timestamp format is lexicographically sortable.
**Watch-outs:** Comparing timestamps as raw strings only works because the format is fixed-width; comparing `HH:MM:SS.mmm` alone across a day boundary silently breaks.

---

### Q3. `TIME_WAIT` sockets per remote host
**Interviewer signal:** Do they know `ss` (or fall back to `netstat`) and can they slice the remote address correctly.
**Answer:**
```bash
ss -tan state time-wait \
  | awk 'NR>1 {split($4,a,":"); print a[1]}' \
  | sort | uniq -c | sort -rn
```
Expected output:
```
 812 10.20.30.41
 402 10.20.30.42
  17 192.168.4.19
```
**Explanation:** `ss -tan state time-wait` lists only TIME_WAIT TCP sockets, no name resolution. Column 4 is `peer:port`; splitting on `:` gives the host. Works for IPv4; for IPv6, use `rsplit`-style handling (`awk '{n=split($4,a,":"); print a[n-1]}'` or match `\[...\]`).
**Watch-outs:** Don't use `netstat -tn | grep TIME_WAIT` on prod — deprecated and slower on machines with many sockets.

---

### Q4. Processes owned by user `flex` with RSS > 2 GB
**Interviewer signal:** Comfort with `ps` output and unit conversion; awareness that RSS from `ps` is in KiB.
**Answer:**
```bash
ps -u flex -o pid,rss,cmd --no-headers \
  | awk '$2 > 2*1024*1024 { printf "%-8s %10.2f GB  %s\n", $1, $2/1024/1024, substr($0, index($0,$3)) }'
```
Expected output:
```
14211        3.42 GB  /opt/oms/bin/order-router --config /etc/oms/router.yml
14589        2.11 GB  /opt/oms/bin/session-manager
```
**Explanation:** `ps -u flex` filters by user. `rss` is KiB; `2 GB = 2 * 1024 * 1024 KiB`. `substr($0, index($0,$3))` keeps the full command line intact even when it contains spaces.
**Watch-outs:** RSS includes shared pages; a hot answer is to also mention `PSS` from `/proc/<pid>/smaps_rollup` for a truer per-process footprint.

---

### Q5. Rename all `*.log` older than 7 days with `.old` suffix in one command
**Interviewer signal:** `find` with `-exec` or `-execdir`, and safe rename in a single command.
**Answer:**
```bash
find /var/log/oms -type f -name '*.log' -mtime +7 \
  -exec sh -c 'mv "$1" "$1.old"' _ {} \;
```
Expected output (no stdout on success; verify via):
```
$ find /var/log/oms -name '*.log.old' -mtime +7 | wc -l
37
```
**Explanation:** `-mtime +7` selects files last modified more than 7 * 24 h ago. `sh -c 'mv "$1" "$1.old"' _ {}` sidesteps shell interpolation of the filename — spaces and special chars are safe. `\;` runs one `mv` per file; use `+` if the shell wrapper could batch (it can't here because we need per-file substitution).
**Watch-outs:** `for f in $(find ...)` breaks on names with spaces. `-mtime 7` (no plus) means *exactly* 7 days, not older.

---

### Q6. Sort a log with out-of-order timestamps
**Interviewer signal:** Do they know `sort -k` with a stable, locale-safe key.
**Answer:**
```bash
LC_ALL=C sort -s -t'|' -k1,1 /var/log/oms/fix.log > /tmp/fix.sorted.log
```
For real SOH-delimited files:
```bash
LC_ALL=C sort -s -t $'\x01' -k1,1 /var/log/oms/fix.log > /tmp/fix.sorted.log
```
Expected output:
```
$ head -2 /tmp/fix.sorted.log | cut -d'|' -f1
20260718-09:00:00.001
20260718-09:00:00.002
```
**Explanation:** Timestamp `YYYYMMDD-HH:MM:SS.mmm` is fixed-width and lexicographically monotone, so plain string sort on column 1 is correct. `LC_ALL=C` avoids locale-aware collation which is slower and can misorder. `-s` is stable — preserves original relative order for equal keys.
**Watch-outs:** Don't `-n` (numeric) — the timestamp isn't a number. Missing `LC_ALL=C` on a UTF-8 locale can be 3–5x slower on multi-GB files.

---

### Q7. Continuously monitor and alert when a line matches `REJECT.*35=8`
**Interviewer signal:** Real-time tailing, correct grep flags, and hooking into an alerting mechanism.
**Answer:**
```bash
tail -F /var/log/oms/fix.log \
  | grep --line-buffered -E 'REJECT.*35=8' \
  | while IFS= read -r line; do
      logger -t oms-alert -p user.err "REJECT observed: $line"
      # optional: curl -s -X POST -d "text=REJECT: $line" $SLACK_WEBHOOK
    done
```
Expected output (in `journalctl -t oms-alert` or `/var/log/messages`):
```
Jul 18 14:31:02 host oms-alert: REJECT observed: 20260718-14:31:02.117 8=FIX.4.2 ...35=8...58=UnknownSymbol...
```
**Explanation:** `tail -F` (capital F) survives log rotation. `--line-buffered` flushes each line immediately so `grep` doesn't buffer 4 KiB. `logger` writes to syslog which is picked up by the alerting stack.
**Watch-outs:** `tail -f` (lower-f) silently stops after `logrotate` — a classic outage cause. Also, `grep -E 'REJECT.*35=8'` requires REJECT to precede 35=8 in the line, which it usually does; a safer pattern is `grep -F $'\x0135=8\x01'` combined with a text `REJECT` check.

---

### Q8. Print 3 lines around each match of `ORD-12345`
**Interviewer signal:** Basic `grep -A/-B/-C` fluency.
**Answer:**
```bash
grep -C 3 'ORD-12345' /var/log/oms/fix.log
```
Expected output:
```
20260718-14:29:59.900 ... 11=ORD-12344 ...
20260718-14:29:59.912 ... heartbeat ...
20260718-14:29:59.981 ... 11=ORD-12344 ExecReport ...
20260718-14:30:00.123 ... 11=ORD-12345 35=D ...      <-- match
20260718-14:30:00.140 ... 11=ORD-12345 35=8 New ...
20260718-14:30:00.171 ... 11=ORD-12346 35=D ...
20260718-14:30:00.201 ... 11=ORD-12345 35=8 Fill ...
```
**Explanation:** `-C N` is shorthand for `-B N -A N`. Groups of matches within N lines are merged; separators (`--`) split disjoint groups.
**Watch-outs:** For a very hot log, prefer `grep -F -C 3 'ORD-12345'` — fixed-string is markedly faster than regex on long lines.

---

### Q9. Extract unique ClOrdIDs from a compressed `.gz` log
**Interviewer signal:** Do they use `zcat`/`zgrep` rather than un-gzipping first.
**Answer:**
```bash
zcat /var/log/oms/fix.log.2026-07-17.gz \
  | grep -oP '(?<=\x0111=)[^\x01]+' \
  | sort -u
```
Expected output:
```
ORD-1
ORD-10001
ORD-10002
...
```
**Explanation:** `zcat` streams the decompressed content; no temp files. `grep -oP` with a look-behind extracts *only* the value of tag 11 (ClOrdID). `sort -u` deduplicates. For huge files, prefer `awk` to avoid regex backtracking:
```bash
zcat file.gz | awk -F'\x01' '{for(i=1;i<=NF;i++) if ($i ~ /^11=/) print substr($i,4)}' | sort -u
```
**Watch-outs:** `gunzip -c` works but is a keystroke longer. Piping through `sort` without `-u` and then `uniq` wastes a pass.

---

### Q10. Compute per-minute message rate over the last hour
**Interviewer signal:** Time-bucketing with `awk` or `cut` and awareness of the log timestamp format.
**Answer:**
```bash
cutoff=$(date -u -d '1 hour ago' +%Y%m%d-%H:%M)
awk -v c="$cutoff" '
  {
    minute=substr($0,1,15)          # YYYYMMDD-HH:MM
    if (minute < c) next
    count[minute]++
  }
  END { for (m in count) print m, count[m] }
' /var/log/oms/fix.log | sort
```
Expected output:
```
20260718-13:30 4218
20260718-13:31 4102
20260718-13:32 3987
...
20260718-14:29 5011
```
**Explanation:** Truncate the timestamp to `YYYYMMDD-HH:MM` (15 chars). Lexicographic compare against cutoff drops old lines cheaply. `awk` associative array bucketing runs in a single pass.
**Watch-outs:** Don't try to shell out to `date` per line — that's ~5000x slower. And the cutoff must be in the same TZ the log uses (typically UTC in OMS shops — confirm).

---

### Q11. Find sessions whose `MsgSeqNum` (tag 34) jumped by more than 10 in one step
**Interviewer signal:** Correctness under session interleaving — do they group by SenderCompID before diffing.
**Answer:**
```bash
awk -F'\x01' '
  {
    s=""; sn=0
    for (i=1;i<=NF;i++) {
      if ($i ~ /^49=/) s=substr($i,4)
      else if ($i ~ /^34=/) sn=substr($i,4)+0
    }
    if (s=="" || sn==0) next
    if (s in prev) {
      d = sn - prev[s]
      if (d > 10) printf "GAP  %-15s  prev=%d  now=%d  delta=%d  ts=%s\n", s, prev[s], sn, d, $1
    }
    prev[s] = sn
  }' /var/log/oms/fix.log
```
Expected output:
```
GAP  CLIENT1          prev=1042  now=1071  delta=29  ts=20260718-10:14:22.001
GAP  BROKER_X         prev=5081  now=5109  delta=28  ts=20260718-11:02:47.512
```
**Explanation:** Track the previous seqnum *per SenderCompID*. Anything > 10 signals a gap — usually a missed ResendRequest or a rejected inbound message the vendor consumed silently.
**Watch-outs:** Some engines reset `34=` mid-day on logon (`ResetSeqNumFlag=Y`) causing a huge negative delta — filter `d > 0` if you want only forward jumps, or watch for `35=A` and reset `prev[s]` explicitly.

---

### Q12. Show top 5 fattest FDs on a running process
**Interviewer signal:** `lsof` + `sort -k` and awareness that "fat" means size, not count.
**Answer:**
```bash
lsof -p <PID> -a -d '^cwd,^rtd,^txt' -F pstn0 \
  | awk 'BEGIN{RS="\0";FS="\n"} { for(i=1;i<=NF;i++) { if($i~/^s/) sz=substr($i,2); if($i~/^n/) nm=substr($i,2)} print sz"\t"nm}' \
  | sort -rn | head -5
```
Simpler, less exact but interview-friendly:
```bash
lsof -p <PID> +L 1 -s 2>/dev/null \
  | awk 'NR>1 {print $7, $9}' \
  | sort -rn | head -5
```
Expected output:
```
15234876540  /var/log/oms/fix.log
 4211003201  /var/log/oms/drop-copy.log
  102400000  /tmp/oms-heap.dump
   52428800  /var/log/oms/audit.log
   10485760  /proc/14211/maps
```
**Explanation:** `lsof -p <PID>` lists open files for a PID. Column 7 (`SIZE/OFF`) is the file size in bytes when the FD is a regular file. Sorting numerically descending gives the fattest.
**Watch-outs:** Sockets and pipes have no size — they'll show 0 or `t<offset>`. Some `lsof` builds print offsets in hex — check with `-o` flag behavior.

---

### Q13. Find TCP ports listening but with no established connection
**Interviewer signal:** Set operations on socket lists — listeners minus those with peers.
**Answer:**
```bash
comm -23 \
  <(ss -Htnl | awk '{print $4}' | awk -F: '{print $NF}' | sort -u) \
  <(ss -Htn state established | awk '{print $4}' | awk -F: '{print $NF}' | sort -u)
```
Expected output:
```
9090
18443
22001
```
**Explanation:** `ss -tnl` = listening TCP, no name resolution. `ss -tn state established` = active connections. Both give local `addr:port`; strip to port. `comm -23` prints lines in file1 not in file2 — i.e., listening but no established peer.
**Watch-outs:** A listener bound to `127.0.0.1` and one bound to `0.0.0.0` on the same port will both appear — dedupe by port only, or preserve the bind-addr if you need to distinguish. Also `ss -H` (no header) is required or the header row leaks into results.

---

### Q14. Find the PID holding TCP port 12345
**Interviewer signal:** Do they reach for `ss -tlnp` (fast) rather than `lsof -i` (slow on busy boxes).
**Answer:**
```bash
ss -tlnp 'sport = :12345'
# or
sudo lsof -iTCP:12345 -sTCP:LISTEN -n -P
```
Expected output:
```
State  Recv-Q Send-Q Local Address:Port Peer Address:Port  Process
LISTEN 0      128         0.0.0.0:12345      0.0.0.0:*    users:(("order-router",pid=14211,fd=17))
```
**Explanation:** `ss -tlnp` needs root (or CAP_NET_ADMIN) to see the `users:` column with PID. `sport = :12345` is `ss`'s filter language — much faster than piping to grep.
**Watch-outs:** Without `sudo`, `ss` still prints the socket but the process column is empty. `fuser -n tcp 12345` works too but its output is terser and easily misread.

---

### Q15. Compute time-delta between `35=D` (NewOrderSingle) and its first `35=8` (ExecReport) per ClOrdID
**Interviewer signal:** Two-pass or single-pass associative-array logic; understanding of FIX order flow.
**Answer:**
```bash
awk -F'\x01' '
  function to_ms(ts,   a,d,t) {
    d=substr(ts,1,8); t=substr(ts,10)
    gsub(/[:.]/," ",t); split(t,a," ")
    return mktime(substr(d,1,4)" "substr(d,5,2)" "substr(d,7,2)" "a[1]" "a[2]" "a[3])*1000 + a[4]
  }
  {
    msgtype=""; clord=""
    for (i=1;i<=NF;i++) {
      if ($i ~ /^35=/) msgtype=substr($i,4)
      else if ($i ~ /^11=/) clord=substr($i,4)
    }
    if (clord=="") next
    t = to_ms($1)
    if (msgtype=="D" && !(clord in dsent))            dsent[clord]=t
    else if (msgtype=="8" && (clord in dsent) && !(clord in acked)) {
      acked[clord]=1
      printf "%-20s  %d ms\n", clord, t - dsent[clord]
    }
  }' /var/log/oms/fix.log \
  | sort -k2 -n -r | head
```
Expected output:
```
ORD-98104              412 ms
ORD-98102              289 ms
ORD-98099              244 ms
ORD-98110              198 ms
```
**Explanation:** First `35=D` per ClOrdID → record send time. First subsequent `35=8` → compute delta and mark ack'd to avoid double-counting fills. Sort descending to surface the slowest — usually the interesting ones.
**Watch-outs:** ExecReport with `39=8` (Rejected) is still `35=8` — you may want to filter on `150=0` (New) if the question is "ack" latency specifically. Also, in a real prod file, some `35=8` come from Drop Copy and won't have the original `11=` — filter to your own SenderCompID.

---

### Q16. Grep messages between 09:30:00 and 09:31:00 without loading the whole file
**Interviewer signal:** Awareness that `grep` streams line-by-line, and knowledge of `sed` address ranges or `awk` early-exit for real speed.
**Answer:**
```bash
# awk with early exit — stops reading as soon as the window closes
awk '
  /^20260718-09:30:00/ {in_win=1}
  in_win {print}
  /^20260718-09:31:00/ {in_win=0; exit}
' /var/log/oms/fix.log
```
Or, if the file is sorted and enormous, binary-search:
```bash
# using `look` for sorted files (fast, jumps via bsearch)
LC_ALL=C look '20260718-09:30' /var/log/oms/fix.log
```
Expected output:
```
20260718-09:30:00.001|8=FIX.4.2|9=142|35=D|...
20260718-09:30:00.017|8=FIX.4.2|9=118|35=0|...
...
20260718-09:30:59.998|8=FIX.4.2|9=140|35=D|...
```
**Explanation:** The `awk` early-exit stops reading once the end timestamp is passed — for a 20 GB file, this reads only the bytes up to that minute. `grep` alone would scan the entire file. `look` is O(log N) but requires the file to be sorted.
**Watch-outs:** `sed -n '/09:30:00/,/09:31:00/p'` does not exit early — it keeps scanning. And `grep '09:30:'` matches anywhere in the line — including `44=109:30:00` prices — always anchor with `^`.

---

### Q17. Bash function to base64-decode SOH-delimited FIX lines
**Interviewer signal:** Shell function definition, pipeline composition, `tr` for delimiter substitution.
**Answer:**
```bash
fix_b64_decode() {
  # Usage: echo "<base64>" | fix_b64_decode
  base64 -d | tr '\001' '|'
}
```
Test:
```bash
$ echo -n '8=FIX.4.2'$'\x01''35=D'$'\x01''11=ORD-1'$'\x01' | base64
OD1GSVguNC4yATM1PUQBMTE9T1JELTEB
$ echo 'OD1GSVguNC4yATM1PUQBMTE9T1JELTEB' | fix_b64_decode
8=FIX.4.2|35=D|11=ORD-1|
```
**Explanation:** `base64 -d` decodes stdin. `tr '\001' '|'` swaps SOH bytes for pipes so the output is human-readable in the terminal (SOH would otherwise render as an invisible control char). Defined as a function so it's reusable across pipelines without a temp file.
**Watch-outs:** `base64 -d` variants differ (`-D` on macOS/BSD). If the input contains newlines mid-base64, use `base64 -di -w0` on GNU or pre-strip with `tr -d '\n'`.

---

### Q18. Find processes with the most page faults in the last minute
**Interviewer signal:** Do they know `/proc/<pid>/stat` gives page-fault counters, or fall back to `ps -o min_flt,maj_flt`.
**Answer:**
```bash
# Snapshot at t=0 and t=60, diff, sort.
snap() {
  ps -e -o pid,comm,min_flt,maj_flt --no-headers
}
snap > /tmp/pf.0
sleep 60
snap > /tmp/pf.1
join -j1 <(sort /tmp/pf.0) <(sort /tmp/pf.1) \
  | awk '{
      pid=$1; comm=$2; min0=$3; maj0=$4; min1=$6; maj1=$7
      d_min = min1-min0; d_maj = maj1-maj0
      printf "%-8s %-24s minor=%d major=%d\n", pid, comm, d_min, d_maj
    }' \
  | sort -k3 -t= -rn | head -10
```
Expected output:
```
14211    order-router             minor=182401 major=17
14589    session-manager          minor= 91020 major=2
19004    market-data-adapter      minor= 41180 major=0
```
**Explanation:** `ps -o min_flt,maj_flt` prints cumulative page-fault counters. Snapshot before and after, diff, sort. Major faults (disk-backed) are the concerning ones — even a few dozen per minute means the process is thrashing.
**Watch-outs:** `perf stat -e page-faults` is cleaner for a single process; `sar -B` gives system-wide but not per-process. Also, a PID that dies between snapshots won't appear in the join — that's usually fine but worth mentioning.

---

### Q19. Show CPU cores that are >90% saturated for 60 s
**Interviewer signal:** `mpstat` or `sar` per-core view, thresholding, and time-window awareness.
**Answer:**
```bash
# Sample every 5s for 60s → 12 samples. Flag any core where >=90% saturated on >=10 samples.
mpstat -P ALL 5 12 \
  | awk '
      /^[0-9]/ && $2 ~ /^[0-9]+$/ {
        core = $2
        idle = $NF
        busy = 100 - idle
        if (busy >= 90) hot[core]++
        seen[core]++
      }
      END {
        for (c in hot) if (hot[c] >= 10) printf "core %s hot in %d/%d samples\n", c, hot[c], seen[c]
      }' \
  | sort
```
Expected output:
```
core 3 hot in 12/12 samples
core 7 hot in 11/12 samples
```
**Explanation:** `mpstat -P ALL 5 12` prints per-core stats every 5 s for 12 iterations. `100 - %idle` = total busy. A core hot in >= 10/12 samples is saturated for at least 50 s of the minute.
**Watch-outs:** `%idle` may not be the last column on all distros — `-o JSON` (recent sysstat) is safer to parse. Also, `top -1 -n 12 -d 5` works interactively but is hard to script.

---

### Q20. `tcpdump` command to capture only outbound FIX traffic to a specific broker IP
**Interviewer signal:** BPF filter fluency — direction, host, port — and awareness of `-w` for pcap capture without decode overhead.
**Answer:**
```bash
sudo tcpdump -i any -nn -s0 -w /tmp/fix-to-broker.pcap \
  'tcp and dst host 10.20.30.41 and dst port 9878'
```
For a live human-readable session (no capture file):
```bash
sudo tcpdump -i any -nn -A -s0 \
  'tcp and dst host 10.20.30.41 and dst port 9878'
```
Expected output (`-A` mode, first packet of a 35=D flowing to broker):
```
14:30:00.123456 IP 10.1.2.3.51002 > 10.20.30.41.9878: Flags [P.], seq 1:143, ack 1, win 502, length 142
E.....@.@...........
  8=FIX.4.2.9=142.35=D.49=OMS.56=BROKER_X.34=42.11=ORD-1.55=AAPL.54=1.38=100.40=2.44=185.50.10=015.
```
**Explanation:** `dst host` + `dst port` ensures we capture *only* the direction where OMS is talking *to* the broker — return traffic is excluded. `-s0` captures full packet (no snapshot truncation). `-w` writes raw pcap for offline analysis in Wireshark; `-A` is ASCII dump for eyeballing. `-i any` picks up all interfaces — if you know it's `bond0` or `eth1`, name it for lower overhead.
**Watch-outs:** Without `-s0`, older tcpdump defaults to 68 bytes and truncates the FIX payload — you'll see the header and no body. Also, `host X and port Y` (no `dst`) captures both directions and doubles the capture volume.
