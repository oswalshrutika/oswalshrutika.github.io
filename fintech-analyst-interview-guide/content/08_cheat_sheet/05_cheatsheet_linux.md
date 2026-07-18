# Linux — One-Page Reference

> The one-liners a T/A actually runs in prod when a trader calls. Every command tested against RHEL/Ubuntu.

---

## Contents

- [1. FIX log parsing](#1-fix-log-parsing)
- [2. Process, memory, CPU](#2-process-memory-cpu)
- [3. Files, disk, IO](#3-files-disk-io)
- [4. TCP / network from the app side](#4-tcp--network-from-the-app-side)
- [5. Time / dates](#5-time--dates)
- [6. Text munging (awk / sed / cut)](#6-text-munging-awk--sed--cut)
- [7. systemd / logs / cron](#7-systemd--logs--cron)
- [8. Java / JVM diagnostics](#8-java--jvm-diagnostics)
- [9. Safety patterns](#9-safety-patterns)

---

## 1. FIX log parsing

FIX messages use **SOH (0x01)** as field separator; often displayed as `|`. Assume file uses SOH.

```bash
# Replace SOH with pipe on the fly (for reading only)
tr '\001' '|' < fix.log | less

# Grep by symbol
grep -aE '\x0155=AAPL\x01' fix.log | tr '\001' '|' | less

# Extract MsgType counts
tr '\001' '\n' < fix.log | grep -E '^35=' | sort | uniq -c | sort -rn

# All rejects (session 35=3 or business 35=j) with reason
grep -aE '\x0135=(3|j)\x01' fix.log \
  | tr '\001' '|' \
  | grep -oE '(35=[3j])|58=[^|]+|373=[^|]+|380=[^|]+'

# Get all messages for a specific ClOrdID
grep -aE '\x0111=ABC-12345\x01' fix.log | tr '\001' '|'

# Get exec reports (35=8) for a specific order and pretty-print key tags
grep -aE '\x0111=ABC-12345\x01' fix.log \
  | tr '\001' '\n' \
  | awk -F= '$1~/^(35|11|37|17|150|39|32|31|14|151|58)$/ {print}'

# Count fills per symbol
grep -aE '\x0135=8\x01' fix.log \
  | grep -aE '\x01150=[F12]\x01' \
  | grep -oaE '\x0155=[^\x01]+' \
  | sort | uniq -c | sort -rn

# Rate of messages per minute
grep -aE '^8=FIX' fix.log \
  | grep -oE '52=[0-9]{8}-[0-9]{2}:[0-9]{2}' \
  | sort | uniq -c

# Find sequence gaps in a single session file (assumes msgs already in order)
grep -aE '\x0134=' fix.log \
  | grep -oE '\x0134=[0-9]+' | tr -d '\001' | cut -d= -f2 \
  | awk 'NR>1 && $1 != prev+1 { printf "gap between %d and %d\n", prev, $1 } { prev=$1 }'
```

## 2. Process, memory, CPU

```bash
# Which process is my OMS?
ps -ef | grep -i oms | grep -v grep
pgrep -fa oms                     # command line + PID

# Full CPU/mem sorted by mem
ps -eo pid,ppid,user,%cpu,%mem,rss,vsz,stat,cmd --sort=-%mem | head

# Real-time
top -p $(pgrep -d, -f oms)
htop
pidstat -u -r -p <pid> 1          # per-sec CPU + RSS

# Threads of a process
ps -T -p <pid>
top -H -p <pid>

# What files & sockets are open
lsof -p <pid> | less
lsof -p <pid> -a -i               # only network sockets
lsof -nP -i :9876                 # who's listening on port 9876

# Memory maps (native heap, mmap files, shared libs)
pmap -x <pid> | tail

# Stack of a stuck process (native)
gstack <pid>                       # or:  gdb -p <pid> -batch -ex 'thread apply all bt'

# System-wide load
uptime                             # load averages
vmstat 1 5                         # CPU, io, memory over time
sar -u 1 5                         # sysstat
sar -q                             # runqueue

# Open FDs
ls /proc/<pid>/fd | wc -l          # count
cat /proc/<pid>/limits             # ulimits
cat /proc/<pid>/status | head      # rss, threads, etc.
```

## 3. Files, disk, IO

```bash
df -hT                             # disk usage per FS
du -sh /var/log/oms/*              # size per dir (nonrecursive)
du -h --max-depth=1 /path          # per subdir
find /var/log -type f -mtime +7 -size +100M   # old + large

# Tail a rotating log
tail -F /var/log/oms/app.log       # -F handles rotation

# IO stats
iostat -xz 1 5
iotop                              # per-process IO
lsof +D /path                      # what's open under a dir

# Find files quickly
find /var/log/oms -name '*.log' -newer /tmp/anchor
locate fix.cfg                     # uses updatedb

# Compare files
diff -u a.log b.log | less
diff <(sort a) <(sort b)
comm -23 <(sort a) <(sort b)       # in a but not b

# Split & rejoin large logs
split -b 500M big.log big.log.part.
cat big.log.part.* > restored.log
```

## 4. TCP / network from the app side

```bash
# What sockets does this process own?
ss -tnp | grep <pid>               # TCP; -u for UDP; -a for all
ss -tnp state established '( dport = :9876 or sport = :9876 )'

# Any TIME_WAIT buildup?
ss -tan state time-wait | wc -l

# Full picture including listening
ss -ltnp                           # listening TCP
ss -tan '( dport = :9876 or sport = :9876 )'

# Netstat legacy (may not be installed)
netstat -anp | grep 9876

# Quick connectivity
nc -vz broker.example.com 9876     # TCP handshake test
nc -vzu ntpserver 123              # UDP
telnet host 9876                   # legacy

# See traffic on the wire
sudo tcpdump -i eth0 -nn 'host broker.example.com and port 9876' -w capture.pcap
sudo tcpdump -i any -A -s 0 'port 9876 and tcp[13] & 0x18 = 0x18'  # PSH+ACK payload
sudo tcpdump -r capture.pcap 'tcp[tcpflags] & tcp-syn != 0'         # SYN only

# Ping-latency histogram
ping -c 100 host | tail -3

# DNS
dig +short broker.example.com
dig +trace broker.example.com

# TLS handshake
openssl s_client -connect broker.example.com:443 -showcerts </dev/null
```

## 5. Time / dates

```bash
date -u                                       # UTC
date -u +%Y-%m-%dT%H:%M:%S.%3N               # ISO-8601 ms
date -d '2 hours ago' +%Y%m%d-%H:%M:%S       # subtraction
date -d '2026-07-18 09:30 EST' -u            # convert timezone
TZ='America/New_York' date                    # ad-hoc TZ
epoch=$(date +%s); date -d @$epoch            # epoch <-> human

# NTP status
timedatectl                                   # systemd
chronyc tracking                              # if chrony
ntpq -p                                       # if ntpd
```

## 6. Text munging (awk / sed / cut)

```bash
# Extract 3rd column, whitespace-delimited
awk '{print $3}' file

# Sum a column
awk '{s+=$3} END {print s}' file

# Group + count with awk
awk '{c[$1]++} END {for (k in c) print c[k], k}' file | sort -rn

# Print rows where col2 > 1000
awk '$2 > 1000'

# Print between two patterns (inclusive)
sed -n '/START/,/END/p' file

# In-place replace, backup
sed -i.bak 's/OLD/NEW/g' file

# Take unique values from column
cut -d, -f3 file | sort -u

# Deduplicate but keep order
awk '!seen[$0]++' file

# Grep with context
grep -B2 -A5 'ERROR' file
grep -c 'REJECT' file              # count matches only
grep -c '' file                    # count lines total
grep -o 'ClOrdID=[^|]*' file | sort -u

# Multi-line JSON pretty
jq . < payload.json
jq '.orders[] | select(.status=="REJECTED")' < file
```

## 7. systemd / logs / cron

```bash
systemctl status oms
systemctl restart oms
systemctl enable --now oms
journalctl -u oms -f               # follow
journalctl -u oms --since '10 min ago'
journalctl -u oms -p err           # priority filter
journalctl _PID=1234

# cron
crontab -l                         # my cron
crontab -e
sudo cat /var/spool/cron/root      # root's cron
ls /etc/cron.d/ /etc/cron.hourly/ /etc/cron.daily/

# audit
last -20                           # login history
who
w
```

## 8. Java / JVM diagnostics

```bash
jps -lv                            # running JVMs
jstack <pid> > stack.txt           # thread dump — take 3 in a row for deadlock analysis
jmap -histo:live <pid> | head -30  # live heap histogram
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>
jcmd <pid> VM.uptime
jcmd <pid> GC.heap_info
jcmd <pid> Thread.print > td.txt
jstat -gcutil <pid> 1000 10        # GC utilization every 1s x10
```

## 9. Safety patterns

- Prefer `-i` on `sed`/`rm` in prod. Confirm the target list first with `find ... -print`.
- `less` for anything unless you're certain about size — `cat huge.log` will lock your terminal.
- Use `xargs -0` with `find -print0` for filenames with spaces/newlines.
- `set -euo pipefail` at the top of every script.
- `>>` appends, `>` truncates — muscle memory has ended careers.
- **Never** run `chmod 777` in prod. Use `750` / `640` and set groups.
- Read-only tunnel for prod: `alias psql-prod='ssh prod psql -X ...'` — no local install of prod creds.
- `tmux` / `screen` for anything longer than 30s.

---

## Bonus one-liners

```bash
# Find the top 10 slowest processes right now
ps -eo pid,%cpu,%mem,cmd --sort=-%cpu | head

# Zombie hunt
ps aux | awk '$8=="Z"{print}'

# Rotate to today's file
today=$(date +%Y%m%d); mv app.log app.log.$today; touch app.log

# Watch a value change
watch -n 1 'ss -tan | grep -c ESTAB'

# What port is a process listening on?
sudo lsof -Pan -p <pid> -i

# Bulk kill by pattern (careful!)
pgrep -f 'stuck-worker' | xargs -r kill -TERM
```
