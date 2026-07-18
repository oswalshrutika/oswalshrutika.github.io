# Linux — Red Flags: 15 Wrong Answers

Common wrong answers heard in Technical Analyst / Production Support interviews. Each entry lists the wrong statement, why it is wrong, and the correct framing. Grounded in real trading-floor troubleshooting on our OMS.

## Contents
1. [`kill -9` is the safe way to stop a process](#1-kill--9-is-the-safe-way-to-stop-a-process)
2. [`TIME_WAIT` is a bug — just set `tw_reuse=1`](#2-time_wait-is-a-bug--just-set-tw_reuse1)
3. [`SIGKILL` can be trapped](#3-sigkill-can-be-trapped)
4. [`chmod 777` fixes permission issues](#4-chmod-777-fixes-permission-issues)
5. [`cd` is a program, not a builtin](#5-cd-is-a-program-not-a-builtin)
6. [`tail -f` re-reads the whole file](#6-tail--f-re-reads-the-whole-file)
7. [`grep -R` searches only the current directory](#7-grep--r-searches-only-the-current-directory)
8. [`systemctl` and `service` are the same](#8-systemctl-and-service-are-the-same)
9. [`cron` uses my login shell environment](#9-cron-uses-my-login-shell-environment)
10. [`sudo su` is best practice](#10-sudo-su-is-best-practice)
11. [`ldd` shows runtime library loads](#11-ldd-shows-runtime-library-loads)
12. [`strace` has no performance cost](#12-strace-has-no-performance-cost)
13. [`tcpdump` captures all traffic to file always](#13-tcpdump-captures-all-traffic-to-file-always)
14. [Ephemeral ports are 1024–1500](#14-ephemeral-ports-are-10241500)
15. [The OOM killer picks by process age](#15-the-oom-killer-picks-by-process-age)

---

## 1. `kill -9` is the safe way to stop a process

**Wrong:** "Always use `kill -9` to stop a hung OMS gateway."
**Why it's wrong:** `-9` is `SIGKILL` — the kernel terminates the process immediately with no chance to flush buffers, close FIX sessions with a proper Logout(35=5), release lock files, or roll back in-flight DB transactions. On a FIX gateway that means the sequence number cache is out of sync with the counterparty on next restart, PID/lock files are stale, and shared memory segments leak.
**Correct:** Escalate signals — `SIGTERM` (15) first to let the process shut down cleanly, wait 10–30 seconds, then `SIGKILL` only if it will not exit. `SIGKILL` is a last resort, not a default.

## 2. `TIME_WAIT` is a bug — just set `tw_reuse=1`

**Wrong:** "We had thousands of sockets in `TIME_WAIT`, so I enabled `net.ipv4.tcp_tw_recycle` / `tw_reuse` to fix the leak."
**Why it's wrong:** `TIME_WAIT` is by design — the TCP RFC requires it (2×MSL) so late-arriving segments from the old connection do not corrupt a new one on the same 4-tuple. `tcp_tw_recycle` was removed from the kernel (4.12+) because it breaks connections through NAT. `tcp_tw_reuse` only helps the *client* side and only for outbound connections.
**Correct:** High `TIME_WAIT` is usually a sign of many short-lived connections — fix the application to use connection pooling / keep-alive. If sockets in `TIME_WAIT` are actually exhausting ephemeral ports, widen the ephemeral range and enable `tcp_tw_reuse` on the client side only. Never blindly enable recycling on a load-balanced or NATed host.

## 3. `SIGKILL` can be trapped

**Wrong:** "The app ignored my kill because it trapped `SIGKILL`."
**Why it's wrong:** `SIGKILL` (9) and `SIGSTOP` (19) are the two signals that cannot be caught, blocked, or ignored — the kernel handles them directly. If a process appears to survive `kill -9`, it is almost certainly stuck in uninterruptible sleep (state `D` in `ps`) — typically waiting on a hung NFS mount, a stuck disk I/O, or a kernel driver.
**Correct:** `kill -9` always kills a runnable or sleeping process. If it does not, check `ps -eo pid,stat,wchan,cmd` — a `D` state means the process is blocked in kernel space and will only exit when the I/O completes or the mount is recovered. Trapping only works for `SIGTERM`, `SIGHUP`, `SIGINT`, etc.

## 4. `chmod 777` fixes permission issues

**Wrong:** "The batch job could not write the file, so I did `chmod 777` on the directory."
**Why it's wrong:** `777` grants read/write/execute to *everyone* on the box — a hard fail in any bank audit. It masks the real issue (wrong owner, wrong group, wrong umask, SELinux context) and creates a compliance finding. On shared production hosts it also lets any user tamper with reconciliation output.
**Correct:** Find the actual owner/group the service runs as (`ps -eo user,cmd | grep <svc>`), then `chown` / `chgrp` and use `750` or `770`. Check the umask in the service unit file. If SELinux is enforcing, check `ls -Z` and `restorecon`. On the trading floor, `777` on anything under `/apps` is a P2 audit finding by itself.

## 5. `cd` is a program, not a builtin

**Wrong:** "`cd` is at `/usr/bin/cd`."
**Why it's wrong:** `cd` must be a shell builtin — it changes the current working directory of the *shell process itself*. A child process (which is what a separate binary would be) cannot change its parent's cwd. `type cd` returns `cd is a shell builtin`.
**Correct:** `cd`, `export`, `alias`, `source`/`.`, `pwd`, `set`, and `ulimit` are shell builtins. Use `type <cmd>` or `command -V <cmd>` to see whether something is a builtin, alias, function, or external binary. This matters when writing scripts — `env cd /tmp` does nothing useful.

## 6. `tail -f` re-reads the whole file

**Wrong:** "`tail -f` is expensive because it re-reads the log from the top each time."
**Why it's wrong:** `tail -f` seeks to end-of-file, prints the last N lines (default 10), then blocks on `read()` / uses `inotify` (with `tail -F` or on GNU coreutils) to stream new bytes as they are appended. It never re-reads the file from the top.
**Correct:** `tail -f` is cheap — it is a single open FD holding the offset. The gotcha is log rotation: plain `-f` keeps following the old inode after `logrotate` renames the file, so you stop seeing new lines. Use `tail -F` (capital F) which reopens by name on rotation. For huge files use `less +F` for scrollback plus tailing.

## 7. `grep -R` searches only the current directory

**Wrong:** "`grep -R 'ORDER_REJECT'` only greps the files in `.`, not subdirs."
**Why it's wrong:** `-R` (and `-r`) is exactly the recursive flag — it descends into every subdirectory from the given path. Without `-R`, `grep` on a directory prints `Is a directory` and exits.
**Correct:** `grep -R 'pattern' /apps/oms/logs` walks the entire tree. Use `--include='*.log'` to filter by extension, `-l` to list matching files only, `-n` for line numbers. The real footgun is grepping across NFS or an active log dir at peak — pin it to specific files with `find … -newer` or use `zgrep` on rolled archives instead of stampeding the live log.

## 8. `systemctl` and `service` are the same

**Wrong:** "`systemctl restart oms` and `service oms restart` do the same thing."
**Why it's wrong:** On a systemd host, `service` is a wrapper that redirects to `systemctl` for native units but falls back to SysV init scripts under `/etc/init.d/` for legacy services. They can diverge — a unit installed as both a systemd service and an old init script may behave differently under each command. Also, `service` strips environment and `systemctl` does not source `/etc/profile`.
**Correct:** On RHEL 7+/CentOS 7+/modern Linux, use `systemctl` directly — `status`, `restart`, `enable`, `is-enabled`, `daemon-reload`, `list-units --failed`. Check `systemctl cat <svc>` to see the actual unit file. `service` is fine for muscle memory but not the source of truth.

## 9. `cron` uses my login shell environment

**Wrong:** "My cron job failed because it inherits my `.bash_profile` — let me add more exports there."
**Why it's wrong:** cron runs with a minimal environment — typically only `HOME`, `LOGNAME`, `PATH=/usr/bin:/bin`, and `SHELL=/bin/sh`. It does not source your login profile, `.bashrc`, or the service account's env. Every "works in my terminal, fails in cron" outage in a support role traces back to this.
**Correct:** Either set the needed vars at the top of the crontab (`PATH=…`, `JAVA_HOME=…`) or explicitly source the env in the command: `0 5 * * * . /apps/oms/env.sh && /apps/oms/bin/eod.sh`. Use full absolute paths for every binary and file. Redirect stdout/stderr to a log file so failures are debuggable.

## 10. `sudo su` is best practice

**Wrong:** "For any elevated task I do `sudo su -` and work from there."
**Why it's wrong:** `sudo su` starts a root shell that runs *every* subsequent command as root with no audit trail per-command — the audit log shows a single `su` entry, not what you actually did. Banks reject this in SOX / SOC2 reviews. It also defeats least-privilege because `sudoers` typically whitelists specific commands, not a blanket shell.
**Correct:** Run individual commands via `sudo <cmd>` so each is logged in `/var/log/secure` or `sudo.log` with the invoking user. If you truly need an interactive elevated shell (e.g. install steps), use `sudo -i` (login shell) or `sudo -s`, and prefer a break-glass procedure with a ticket. Never share a root shell in a screen/tmux with a colleague.

## 11. `ldd` shows runtime library loads

**Wrong:** "I ran `ldd` on the OMS binary and that is exactly what it will load at runtime."
**Why it's wrong:** `ldd` shows the libraries the dynamic linker *would* resolve given the current environment (`LD_LIBRARY_PATH`, `RPATH`, `RUNPATH`, `ld.so.cache`) — but the runtime environment of the actual service (systemd unit, wrapper script, container) is usually different. `dlopen()`-loaded plugins are also invisible to `ldd`. And on untrusted binaries, `ldd` can execute code (it actually runs the loader).
**Correct:** For a running process, look at `/proc/<pid>/maps` — the authoritative list of what is *actually* mapped in. For plugin/`dlopen` behavior, `strace -e trace=openat -f` on startup. Use `readelf -d` to inspect `RPATH`/`RUNPATH` statically. Never run `ldd` on a binary you do not trust.

## 12. `strace` has no performance cost

**Wrong:** "Let me `strace -f -p` the production FIX gateway to see what it is doing."
**Why it's wrong:** `strace` uses `ptrace`, which intercepts every syscall — that is two context switches per syscall (in and out). On a busy trading process doing tens of thousands of syscalls/sec, this can slow it down 10–100x, drop FIX messages, and cause counterparty disconnects. Doing this on a live gateway at market open is a career-limiting move.
**Correct:** In prod, prefer low-overhead tools: `perf`, `bpftrace`, `eBPF`, or `strace -c` for short bounded samples on a low-volume replica. Filter tightly (`strace -e trace=network -p <pid>`). Never attach to a session-carrying process without a controlled window and desk approval. For hot-path analysis, use flame graphs off the perf events.

## 13. `tcpdump` captures all traffic to file always

**Wrong:** "I ran `tcpdump -i any port 3050` and it captured every FIX message to file."
**Why it's wrong:** By default `tcpdump` writes to stdout in ASCII summary form (not pcap), and it truncates each packet to the `snaplen` (default 262144 on modern versions, but historically 68 bytes — enough for headers only, not FIX payload). It also drops packets under load — check the "packets dropped by kernel" line on exit.
**Correct:** Use `tcpdump -i any -s 0 -w /var/tmp/fix.pcap 'port 3050'` — `-s 0` means full packet, `-w` writes pcap binary. Rotate with `-C` (size) and `-W` (file count) so you do not fill the disk. For lossless capture at line rate on 10G+, use `dumpcap` or a dedicated tap. Analyze offline with Wireshark or `tshark -Y 'fix'`.

## 14. Ephemeral ports are 1024–1500

**Wrong:** "Client-side outbound connections use ports 1024–1500."
**Why it's wrong:** The Linux ephemeral port range is controlled by `net.ipv4.ip_local_port_range`, which on modern kernels defaults to `32768 61000` (roughly 28k ports). The number 1024 is the top of the *privileged* port range (below which requires root to bind), not the ephemeral range. On a busy connector opening thousands of downstream connections, port exhaustion is a real failure mode.
**Correct:** Check `sysctl net.ipv4.ip_local_port_range`. Widen it to `1024 65535` if the host is dedicated. Combine with `tcp_tw_reuse=1` on client-heavy boxes. Ephemeral port exhaustion shows as `EADDRNOTAVAIL` / "cannot assign requested address" in the app log — a classic post-market-open failure mode when reconnect storms happen.

## 15. The OOM killer picks by process age

**Wrong:** "The OOM killer killed my batch because it was the oldest process."
**Why it's wrong:** The OOM killer scores processes by `oom_score`, which is a function of RSS (resident memory), swap usage, and the `oom_score_adj` tunable (`/proc/<pid>/oom_score_adj`, range -1000 to +1000). Age has nothing to do with it — the biggest memory hog with a non-negative adjustment wins the lottery. Root processes and kthreads get some protection but are not immune.
**Correct:** To protect a critical process (OMS core, market data feed handler), set `oom_score_adj = -1000` in the systemd unit (`OOMScoreAdjust=-1000`). Check `dmesg -T | grep -i 'killed process'` after an OOM event to see the actual victim and its score. Investigate real memory pressure via `/proc/meminfo`, `vmstat 1`, and cgroup memory limits — never just add swap and call it done.
