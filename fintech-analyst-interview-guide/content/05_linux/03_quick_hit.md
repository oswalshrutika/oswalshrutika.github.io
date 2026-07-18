# Linux Quick-Hit Q&A

## Table of Contents

1. [Kill signals — SIGTERM vs SIGKILL vs SIGHUP](#q1-kill-signals--sigterm-vs-sigkill-vs-sighup)
2. [`tail -f` vs `less +F`](#q2-tail--f-vs-less-f)
3. [Reading a rotated log while tailing](#q3-reading-a-rotated-log-while-tailing)
4. [`tcpdump` filter for a FIX session](#q4-tcpdump-filter-for-a-fix-session)
5. [`ss` vs `netstat`](#q5-ss-vs-netstat)
6. [`grep -c` vs `wc -l`](#q6-grep--c-vs-wc--l)
7. [`awk` field extraction](#q7-awk-field-extraction)
8. [`sed` in-place edit](#q8-sed-in-place-edit)
9. [`ulimit` — open files & core dumps](#q9-ulimit--open-files--core-dumps)
10. [`TZ` environment variable](#q10-tz-environment-variable)
11. [`cron` syntax and pitfalls](#q11-cron-syntax-and-pitfalls)
12. [Find files modified in last hour](#q12-find-files-modified-in-last-hour)
13. [`lsof` — who owns this port / file](#q13-lsof--who-owns-this-port--file)
14. [Disk full but `df` and `du` disagree](#q14-disk-full-but-df-and-du-disagree)
15. [`strace` on a hung process](#q15-strace-on-a-hung-process)
16. [`top` load average vs CPU%](#q16-top-load-average-vs-cpu)
17. [`nohup` vs `disown` vs `screen`/`tmux`](#q17-nohup-vs-disown-vs-screentmux)
18. [Pipe vs redirect — `2>&1` gotcha](#q18-pipe-vs-redirect--21-gotcha)
19. [`xargs` for bulk operations](#q19-xargs-for-bulk-operations)
20. [`scp` / `rsync` for log pulls](#q20-scp--rsync-for-log-pulls)
21. [Hard link vs symlink](#q21-hard-link-vs-symlink)
22. [`chmod` numeric vs symbolic](#q22-chmod-numeric-vs-symbolic)
23. [`grep -P` vs `grep -E`](#q23-grep--p-vs-grep--e)
24. [`journalctl` for a systemd service](#q24-journalctl-for-a-systemd-service)
25. [SSH tunneling for restricted UAT](#q25-ssh-tunneling-for-restricted-uat)

---

### Q1. Kill signals — SIGTERM vs SIGKILL vs SIGHUP
**Interviewer signal:** Do you understand graceful shutdown vs hard-kill, and the operational risk of `-9`?
**Answer:**
`kill <pid>` sends `SIGTERM` (15) by default — a polite request. The process gets to run its signal handler, flush open FIX sessions, close DB connections, and exit cleanly. `kill -9 <pid>` sends `SIGKILL` — uncatchable, the kernel yanks the process; open files may be left half-written, shared memory not detached, FIX sequence numbers not persisted, and next restart may need manual reset. `SIGHUP` (1) is traditionally "terminal hangup" but daemons repurpose it as "reload config without restarting" — our OMS gateways use it for log rotation. In production support I always try `-15` first, wait 30–60 seconds, and only escalate to `-9` if the process is truly wedged.
**Watch-outs:** Never say "just `kill -9` it" without acknowledging state corruption risk for a stateful trading process.

---

### Q2. `tail -f` vs `less +F`
**Interviewer signal:** Do you know when a tail is not enough — searching a live log without stopping it?
**Answer:**
`tail -f logfile` streams new lines forward-only. It's fine for a passive watch but you can't scroll up or search without killing it. `less +F logfile` starts in follow mode identical to `tail -f`, but `Ctrl-C` drops you into normal `less` where you can `/pattern` search, page up, jump to a line, then press `F` to resume following from where the file currently is. On a busy OMS log at 5–10k lines a minute, `less +F` is what I use when I need to grep for an order ID mid-stream. Also: `tail -F` (capital F) survives log rotation by re-opening the file when the inode changes, whereas lowercase `-f` keeps tailing the old, now-unlinked file forever.
**Watch-outs:** Confusing `tail -f` and `tail -F` — the difference is critical for logs rotated hourly.

---

### Q3. Reading a rotated log while tailing
**Interviewer signal:** Log rotation is happening mid-incident — can you keep visibility?
**Answer:**
Use `tail -F` (capital F), which is `--follow=name --retry`. It follows the *filename*, so when `logrotate` moves `oms.log` to `oms.log.1` and creates a new empty `oms.log`, `tail -F` re-opens the new file. Lowercase `-f` follows the *file descriptor*, so it keeps tailing the rotated-away file which is invisible to anyone new. During a live incident I always start with `tail -F` piped through `grep --line-buffered` for the order ID or session name — the line-buffer flag is important so grep flushes on each line rather than at 4 KB chunks.
**Watch-outs:** Forgetting `--line-buffered` — output looks frozen even though data is flowing.

---

### Q4. `tcpdump` filter for a FIX session
**Interviewer signal:** Can you capture wire-level FIX traffic without drowning in noise?
**Answer:**
The BPF filter should pin host and port and, ideally, keep only the direction you care about. For a session where our OMS talks to a European sell-side broker on port 9823:
```bash
sudo tcpdump -i eth0 -w /tmp/fix_broker.pcap -s0 \
  'host 10.20.30.40 and tcp port 9823'
```
`-s0` captures full packets (default snaplen truncates FIX bodies), `-w` writes a pcap for later Wireshark analysis, and the host/port BPF keeps the trace small. If you're chasing a specific tag, do the capture then post-filter with `tshark -r file.pcap -Y 'fix.msgtype == "D"'`. For a live tail, `-A` prints ASCII which is enough for FIX since it's text-based, but you lose the ability to reassemble TCP segments cleanly.
**Watch-outs:** Missing `-s0` — you'll truncate messages and only see the first 68 bytes, losing tag content.

---

### Q5. `ss` vs `netstat`
**Interviewer signal:** Are you using modern tools, and do you know why `netstat` was replaced?
**Answer:**
`ss` (socket statistics) reads directly from the kernel via netlink, whereas `netstat` parses `/proc/net/tcp` which is slow and can miss sockets on a busy host. On a production box with 10k+ connections, `netstat -an` can take 30+ seconds; `ss -tan` returns in under a second. Common invocations: `ss -tlnp` for listening TCP sockets with owning process, `ss -tan state established '( sport = :9823 )'` to filter by session port, `ss -s` for a summary of socket counts by state. `netstat` is deprecated on modern RHEL/Ubuntu — `net-tools` isn't even installed by default anymore. I still use the muscle memory `netstat -an | grep ESTAB | wc -l` but that's actually slower than `ss -tan state established | wc -l`.
**Watch-outs:** Saying "netstat" without acknowledging it's deprecated — dates you and misses a real perf issue on high-connection hosts.

---

### Q6. `grep -c` vs `wc -l`
**Interviewer signal:** Do you know the subtle differences that cause miscounts?
**Answer:**
`grep -c pattern file` counts matching *lines* — not matches. If a line contains the pattern three times, it counts as one. `grep pattern file | wc -l` gives the same answer for line count. But `grep -o pattern file | wc -l` counts *occurrences* — each match on its own output line. The gotcha with `wc -l`: it counts newline characters, so a file whose last line has no trailing newline is under-counted by one. In production I use `grep -c "OrderID=XYZ" oms.log` to check how many log lines mention an order, and `grep -oc` (or the pipe form) if I'm counting field occurrences within lines.
**Watch-outs:** Reporting "500 matches" when it's actually 500 matching *lines* with possibly multiple matches each.

---

### Q7. `awk` field extraction
**Interviewer signal:** Can you slice log columns without writing Python?
**Answer:**
`awk` splits each line on whitespace by default; `$1` is the first field, `$NF` is the last, `$0` is the whole line. For a comma-delimited FIX-ish log:
```bash
awk -F'|' '{ print $3, $7 }' oms.log       # 3rd and 7th pipe-delimited fields
awk -F'=' '/OrderID/ { print $2 }' oms.log # value after OrderID=
awk '$5 > 1000 { print $1, $5 }' latency.log  # filter on numeric column
```
For FIX messages I use SOH (`\x01`) as the delimiter: `awk -F'\x01' '{ for(i=1;i<=NF;i++) print $i }'`. `awk` is much faster than piping through cut+grep+sed for the same task and handles conditionals and arithmetic inline.
**Watch-outs:** Assuming space-delimited when logs are tab or pipe — always set `-F` explicitly.

---

### Q8. `sed` in-place edit
**Interviewer signal:** Do you know the portability pitfall and the safety habit?
**Answer:**
`sed -i 's/old/new/g' file.txt` edits in place on GNU sed (Linux). On BSD sed (macOS) the same command errors unless you supply an extension: `sed -i '' 's/old/new/g'` — the empty string means "no backup". The portable form is `sed -i.bak 's/.../.../g' file` which works everywhere and leaves `file.bak` as a rollback. I always take a backup for config edits on prod — a wrong regex on an OMS config file can bring down a gateway. For multi-file mass changes I combine with `find … -print0 | xargs -0 sed -i.bak …`. And test the pattern *without* `-i` first — pipe to `less` or redirect to a scratch file — before overwriting.
**Watch-outs:** Running `-i` without a backup on the first shot, discovering the regex was too greedy.

---

### Q9. `ulimit` — open files & core dumps
**Interviewer signal:** Do you understand per-process kernel limits and how they bite trading apps?
**Answer:**
`ulimit -n` is the max open file descriptors per process — default 1024, which an OMS with thousands of FIX sessions and TCP connections will blow through, causing `EMFILE: too many open files` and dropped orders. Production processes should be started under a shell with `ulimit -n 65535` or the equivalent in `/etc/security/limits.conf` and `systemd` unit files (`LimitNOFILE=`). `ulimit -c unlimited` enables core dumps — critical for post-mortem on a crashed gateway; combined with `/proc/sys/kernel/core_pattern` to steer dumps to a scratch disk with space. `ulimit -a` shows all soft limits; `-H` shows hard limits (only root can raise). During a live incident I always check the running process's actual limits via `cat /proc/<pid>/limits` — the shell `ulimit` shows *your* limits, not the target process's.
**Watch-outs:** Confusing shell `ulimit` output with the running daemon's actual limits.

---

### Q10. `TZ` environment variable
**Interviewer signal:** Timezone bugs are a classic trading-support gotcha — can you diagnose one?
**Answer:**
`TZ` overrides the system timezone for a single process. `TZ='America/New_York' date` prints NY time regardless of server locale. This matters because trading logs commonly mix UTC (from wire timestamps) with local time (from the OMS host clock), and if the OMS is in Frankfurt but reporting is in New York you get 5–6 hour discrepancies in trade blotters. Set `TZ` in the service unit or startup script to force a canonical zone — most shops standardize on `UTC` for logs and let the UI layer localize. Watch out for daylight-savings edges: the same wall-clock time can occur twice on the fall-back day. IANA names (`America/New_York`) are correct; `EST5EDT` is deprecated and doesn't handle DST cleanly.
**Watch-outs:** Using `EST` or `PST` as short strings — they don't switch to DST and cause 1-hour drifts twice a year.

---

### Q11. `cron` syntax and pitfalls
**Interviewer signal:** Can you schedule a nightly job without shooting yourself in the foot?
**Answer:**
Five fields: minute, hour, day-of-month, month, day-of-week, then command. `0 2 * * *` runs at 02:00 daily. `*/5 * * * *` every five minutes. `0 22 * * 1-5` at 22:00 weekdays. Big pitfalls: (1) cron runs with a minimal `PATH` — always absolute-path binaries or set `PATH=` at the top of the crontab; (2) `%` is a field separator inside cron commands — escape as `\%` if used in `date +%Y%m%d`; (3) cron doesn't source `~/.bashrc`, so environment variables must be set in the crontab or a wrapper script; (4) DST — running at `02:30` local time on the fall-back day executes twice, on spring-forward day zero times, so schedule critical trading jobs at times that don't cross DST boundaries or in UTC. Always redirect stdout/stderr to a log: `>> /var/log/job.log 2>&1` — otherwise cron mails root, filling `/var/spool/mail`.
**Watch-outs:** Forgetting the `PATH` and getting `java: command not found` at 2 a.m. when the pager fires.

---

### Q12. Find files modified in last hour
**Interviewer signal:** Basic incident-forensics move — can you narrow the blast radius?
**Answer:**
```bash
find /var/log/oms -type f -mmin -60         # modified in last 60 minutes
find /var/log/oms -type f -mmin -60 -ls     # with size, permissions, timestamps
find /opt/app -newer /tmp/marker -type f    # modified since a marker file
```
`-mmin -60` means "modified less than 60 minutes ago"; `-mtime -1` is "less than 1 day". Use `-type f` to exclude directories, `-size +100M` to hunt large files (disk full incidents), and `-not -path '*/archive/*'` to prune. For "what changed since deploy at 14:00" I `touch -t 202607181400 /tmp/deploy_marker` and `find /opt/app -newer /tmp/deploy_marker`. Combined with `xargs ls -lart` you get an audit trail sorted by mtime.
**Watch-outs:** Confusing `-mtime -1` (less than 1 day) with `-mtime 1` (exactly 1 day, floor-rounded).

---

### Q13. `lsof` — who owns this port / file
**Interviewer signal:** Something is holding a port or file open — can you find it fast?
**Answer:**
`lsof -i :9823` shows what process is listening on or connected to port 9823. `lsof -p <pid>` lists everything a given PID has open — sockets, files, libraries. `lsof | grep deleted` finds files that have been unlinked but are still held open by a process, which is the classic "df says full but du says empty" case (see Q14). For a FIX session mystery, `lsof -i @10.20.30.40:9823` filters to a specific remote peer. It's slower than `ss` for pure socket queries but far richer because it correlates FDs to processes and files in one view. On locked-down prod hosts `lsof` sometimes isn't installed; `ss -tanp` and `readlink /proc/<pid>/fd/*` give you subsets of the same info.
**Watch-outs:** Not running as root — `lsof` hides FDs of other users' processes without privileges.

---

### Q14. Disk full but `df` and `du` disagree
**Interviewer signal:** Classic "the space is missing" puzzle — do you know why?
**Answer:**
`df` reads filesystem-level free-space accounting; `du` sums up directory contents visible in the tree. They disagree when a file has been *deleted* (unlinked from the directory) but a process still has it open — the inode is freed only when the last FD closes, so `du` doesn't see the file, but `df` still counts the blocks as used. Classic case on OMS boxes: someone `rm`'d a huge log while the app was writing to it, and disk usage doesn't drop until the app is restarted. Find the culprit:
```bash
lsof | grep deleted | sort -k7 -n
```
The fix is to signal the app to reopen its log (`SIGHUP` if supported), or worst-case restart. Prevention: use `truncate -s 0 logfile` or `> logfile` to zero-out a live log instead of `rm`.
**Watch-outs:** Recommending a reboot when a truncate or SIGHUP would fix it in seconds without dropping FIX sessions.

---

### Q15. `strace` on a hung process
**Interviewer signal:** Live process is stuck — can you see what syscall it's waiting on?
**Answer:**
`strace -p <pid>` attaches to a running process and prints syscalls in real time. If the process is truly hung, you'll see it blocked on a single syscall — typically `read()`, `epoll_wait()`, `futex()`, or `poll()`. Read/epoll on a socket FD points to a network stall; futex points to a lock contention; nothing at all means it's spinning in user space (attach `perf top -p <pid>` instead). Useful flags: `-f` follows children, `-e trace=network` filters to socket syscalls, `-tt` timestamps, `-o file` writes to disk. Warning: `strace` slows the target process by 10-50x because every syscall traps to the tracer — do NOT strace a latency-sensitive trading gateway during market hours unless you've accepted the risk. `gdb -p <pid>` with `thread apply all bt` is often a safer first look because it snapshots a stack once without ongoing overhead.
**Watch-outs:** Attaching strace to a live exchange gateway at 09:30 EST — you'll widen the incident.

---

### Q16. `top` load average vs CPU%
**Interviewer signal:** Do you interpret load average correctly, or confuse it with CPU utilization?
**Answer:**
Load average is the count of processes in the run queue *or* uninterruptible sleep (usually waiting on disk I/O), averaged over 1, 5, and 15 minutes. On a 16-core box, load average 16 = fully utilized; load 32 = 2x oversubscribed. CPU% in `top` is per-CPU utilization broken down as user/sys/iowait/idle. High load with low CPU% means processes are stuck in D-state (disk I/O wait) — check `iostat -x 1` for saturated disks. High CPU user% with normal load means efficient work; high sys% suggests kernel contention (context switches, lock contention). For OMS boxes I watch iowait — even 5% can mean journal-flush latency is spiking, which correlates with order-ack delays.
**Watch-outs:** Panicking at "load 20" on a 32-core host — it's 60% utilization, not a fire.

---

### Q17. `nohup` vs `disown` vs `screen`/`tmux`
**Interviewer signal:** Do you know how to run something that survives your SSH disconnect?
**Answer:**
`nohup cmd &` immunizes a process against `SIGHUP` (which the shell sends its children when the terminal closes) and redirects stdio to `nohup.out`. Good for fire-and-forget. `disown` (bash builtin) removes a job from the shell's job table so exiting the shell doesn't send SIGHUP — useful *after* you've already started something and forgot `nohup`. `screen` or `tmux` create a detachable terminal session — the process keeps running in a virtual TTY you can re-attach to from any subsequent SSH. For a live remediation on a prod host I always start in `tmux` first — if my VPN drops mid-recovery I can re-attach and see exactly where I was. For scheduled jobs, use systemd or cron, not nohup — nohup is a manual convenience, not a service manager.
**Watch-outs:** Kicking off a long re-index with `&` and no nohup, then closing the laptop.

---

### Q18. Pipe vs redirect — `2>&1` gotcha
**Interviewer signal:** Do you understand file descriptor ordering?
**Answer:**
`cmd > file 2>&1` sends stdout to `file` then duplicates stderr to whatever stdout points at — both go to `file`. `cmd 2>&1 > file` does the *opposite*: it duplicates stderr to stdout (the terminal) *first*, then redirects stdout to `file` — stderr still goes to the terminal. Order matters because shell redirection is evaluated left to right. Modern bash also supports `cmd &> file` which is unambiguous shorthand for both streams to `file`. In cron especially, `>> job.log 2>&1` is the canonical form so both output streams end up in the log — otherwise you get cryptic emails from cron with only stderr. For separate streams: `cmd > out.log 2> err.log`.
**Watch-outs:** Writing `2>&1 > file` and wondering why errors still print to the console.

---

### Q19. `xargs` for bulk operations
**Interviewer signal:** Can you compose commands to act on many files safely?
**Answer:**
`xargs` reads items from stdin and passes them as arguments to a command. `find . -name '*.log' | xargs grep ERROR` runs grep once with all filenames — much faster than `-exec grep {} \;` which forks per file. Safe form: `find . -name '*.log' -print0 | xargs -0 grep ERROR` — `-print0`/`-0` uses NUL as separator so filenames with spaces or newlines don't break. `-P 8` runs 8 jobs in parallel; `-n 100` batches 100 args per invocation. On big log directories I use `find /var/log -name 'oms-*.log' -mtime -7 -print0 | xargs -0 -P 4 grep -l ORDER_ID` — parallel grep across last week's logs, prints filenames only. Note: `find … -exec cmd {} +` is a modern alternative that batches like xargs without a pipe.
**Watch-outs:** Piping `ls` into xargs — breaks on any filename with spaces; always use `find -print0`.

---

### Q20. `scp` / `rsync` for log pulls
**Interviewer signal:** How do you pull large logs off a prod host efficiently?
**Answer:**
`scp` is simple and fine for one-off small files but re-copies everything on retry and doesn't resume. `rsync -avz --partial --progress user@host:/var/log/oms.log ./` is the workhorse: `-a` preserves timestamps and perms, `-z` compresses in transit (huge win on text logs, often 10:1), `--partial` keeps a resume point on network failure, `--progress` shows a per-file bar. For a directory of rotated logs, `rsync -av --include='oms-2026-07-18*' --exclude='*' host:/var/log/ ./` grabs only today's rotations. On locked-down prod I often can only pull via a jump host — `rsync -e 'ssh -J jumphost' …` uses SSH's ProxyJump. For very large captures, `ssh host 'gzip -c /tmp/big.pcap' > local.pcap.gz` streams compression at the source.
**Watch-outs:** Using `scp` on a 20 GB log over VPN, watching it fail at 80%, and starting over.

---

### Q21. Hard link vs symlink
**Interviewer signal:** Fundamentals — do you understand inodes?
**Answer:**
A hard link is a second directory entry pointing at the same inode as the original file. Both names are equal citizens; `rm` one and the file survives until the last link is removed. Hard links can't cross filesystems (different inode namespaces) and can't point at directories. A symlink (symbolic link, `ln -s`) is a small file whose contents are a path to the target; `rm` the target and the symlink dangles. Symlinks can cross filesystems and point at directories. In OMS deployments I use symlinks for `/opt/oms/current -> /opt/oms/releases/2026.07.18` so rollback is atomic (`ln -sfn` swaps the pointer without a window of no-file). Hard links show the same size in `du`; symlinks show a few bytes.
**Watch-outs:** Assuming a symlink update is atomic without `-n` — `ln -sf` on an existing symlink to a directory dereferences and creates inside it. Use `ln -sfn`.

---

### Q22. `chmod` numeric vs symbolic
**Interviewer signal:** Do you get permission triples and octal encoding right?
**Answer:**
Octal: each digit = read(4) + write(2) + execute(1). `chmod 755 file` = owner rwx (7), group rx (5), other rx (5). `chmod 640` = owner rw, group r, other none — typical for config files with secrets. Symbolic: `chmod u+x file`, `chmod g-w file`, `chmod o=r file`, or combined `chmod u=rwx,g=rx,o= file`. Special bits: `4000` setuid, `2000` setgid, `1000` sticky (used on `/tmp` so users can't delete each other's files). For OMS config directories I use `750` on the dir and `640` on files so the app's group can read but random logins can't. `chmod -R` recurses but note it applies the same mode to files and directories — usually wrong because dirs need execute-bit to be traversable. Use `find … -type d -exec chmod 750 {} \;` and `find … -type f -exec chmod 640 {} \;` separately.
**Watch-outs:** `chmod -R 644` on a directory tree — now no one can `cd` into subdirs.

---

### Q23. `grep -P` vs `grep -E`
**Interviewer signal:** Do you know the regex flavors?
**Answer:**
`grep` by default is BRE (Basic Regular Expression) — `?`, `+`, `|`, `()`, `{}` must be backslash-escaped. `grep -E` is ERE (Extended) — those metacharacters work natively without backslashes. `grep -P` is PCRE (Perl-Compatible) — adds lookaheads/lookbehinds, non-greedy quantifiers (`.*?`), `\d`, `\s`, `\b`, and named captures. For a FIX tag lookup I use `grep -P '(?<=\|11=)[^|]+' oms.log` — lookbehind extracts the value of tag 11 (ClOrdID) without printing the tag itself. `-P` isn't in POSIX and older grep builds (BusyBox, Solaris) don't have it; `ripgrep` (`rg`) has PCRE2 by default and is much faster. Use `grep -F` (fixed strings) when the pattern contains regex chars you want literal — avoids escaping and is faster.
**Watch-outs:** Writing `grep 'error|warn'` (default BRE) and getting no matches because `|` is literal — needs `grep -E` or `grep 'error\|warn'`.

---

### Q24. `journalctl` for a systemd service
**Interviewer signal:** Are you comfortable with the modern init system's log view?
**Answer:**
`journalctl -u oms-gateway.service` shows all logs for the unit. `-f` follows live. `-n 200` last 200 lines. `--since '10 min ago'`, `--since '2026-07-18 09:00' --until '2026-07-18 10:00'` window queries. `-p err` filters to error priority and above. `-o json` for machine parsing, `-o cat` for message-only. For crash investigation: `journalctl -u oms-gateway --since today | grep -i 'failed\|error\|abort'` then walk back for context. journald indexes by timestamp, priority, and unit so these queries are fast even on GB-sized journals. If the app writes its own log file, journalctl only captures stdout/stderr — the file itself is separate. On older RHEL 6 hosts there's no journald; you're back to `/var/log/messages` and grep.
**Watch-outs:** Ignoring `-p` and drowning in DEBUG-level noise during an incident.

---

### Q25. SSH tunneling for restricted UAT
**Interviewer signal:** Can you reach a service behind a jump host without corporate-VPN gymnastics?
**Answer:**
Local port forward: `ssh -L 9000:uat-oms:8080 jumphost` — connect to `localhost:9000` on your laptop and it tunnels to `uat-oms:8080` via jumphost. Useful for reaching an OMS admin UI or a database not exposed outside the DMZ. Remote port forward: `ssh -R 9000:localhost:8080 jumphost` — opposite direction, exposes your local port to the jump host. Dynamic (SOCKS proxy): `ssh -D 1080 jumphost` — turns SSH into a SOCKS5 proxy at localhost:1080 so browsers/apps configured to use it get transparent tunneling for any destination reachable from jumphost. `ProxyJump` in `~/.ssh/config` (`ssh -J jumphost uat-oms`) chains hops cleanly. Add `-N` (no shell) and `-f` (background) for a persistent tunnel: `ssh -fNL 9000:uat-oms:8080 jumphost`. Kill it with `pkill -f 'ssh.*9000:uat-oms'`.
**Watch-outs:** Leaving a forwarded port open on a shared bastion — anyone on that host may connect to `localhost:9000` and reach prod. Bind to `127.0.0.1` explicitly.
