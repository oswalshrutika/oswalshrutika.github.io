# Networking — Red Flag Answers

## Contents
- [R1. "TIME_WAIT is a bug — just set tw_reuse=1"](#r1-time_wait-is-a-bug--just-set-tw_reuse1)
- [R2. "UDP is faster than TCP so we should use it for orders"](#r2-udp-is-faster-than-tcp-so-we-should-use-it-for-orders)
- [R3. "Multicast market data has no drops because it's stateless"](#r3-multicast-market-data-has-no-drops-because-its-stateless)
- [R4. "SSL and TLS are the same thing"](#r4-ssl-and-tls-are-the-same-thing)
- [R5. "Colo eliminates all latency"](#r5-colo-eliminates-all-latency)
- [R6. "Jumbo frames always help"](#r6-jumbo-frames-always-help)
- [R7. "MTU=1500 is a Linux setting"](#r7-mtu1500-is-a-linux-setting)
- [R8. "traceroute uses TCP"](#r8-traceroute-uses-tcp)
- [R9. "DNS resolution is always cached at OS level"](#r9-dns-resolution-is-always-cached-at-os-level)
- [R10. "netstat is deprecated so ss doesn't work on RHEL 7"](#r10-netstat-is-deprecated-so-ss-doesnt-work-on-rhel-7)
- [R11. "RST from peer means firewall issue"](#r11-rst-from-peer-means-firewall-issue)
- [R12. "Keepalive at 2 hours default keeps a FIX session alive"](#r12-keepalive-at-2-hours-default-keeps-a-fix-session-alive)
- [R13. "iperf shows FIX order latency"](#r13-iperf-shows-fix-order-latency)
- [R14. "Session resumption skips the cert"](#r14-session-resumption-skips-the-cert)
- [R15. "TCP retransmit means bandwidth is exhausted"](#r15-tcp-retransmit-means-bandwidth-is-exhausted)

---

### R1. "TIME_WAIT is a bug — just set tw_reuse=1"
**Interviewer signal:** Does the candidate understand TCP state machine and why TIME_WAIT exists?
**Wrong:** "We're seeing thousands of TIME_WAIT sockets, just flip `net.ipv4.tcp_tw_reuse=1` or `tcp_tw_recycle=1` and they go away."
**Why it's wrong:** TIME_WAIT is not a bug — it's 2×MSL protection against delayed duplicate segments from a prior connection landing in a new one with the same 4-tuple, and it lets the passive close receive a re-sent FIN. `tcp_tw_recycle` was removed from the kernel entirely in 4.12 because it broke NAT'd clients (dropped SYNs based on PAWS timestamps). `tw_reuse` only helps the *client* side and only for outgoing connections — it does not clean up server-side TIME_WAITs.
**Correct:** Diagnose *why* so many sockets are in TIME_WAIT — usually the app is doing short-lived connections instead of pooling. Fix the connection lifecycle (persistent FIX sessions, HTTP keep-alive, connection pool). If you must tune, `tw_reuse=1` is safe for outbound; increase ephemeral port range; never touch `tw_recycle`.

---

### R2. "UDP is faster than TCP so we should use it for orders"
**Interviewer signal:** Do they understand order-flow semantics vs market-data semantics?
**Wrong:** "UDP has no handshake and no ACKs so we get lower latency — let's put FIX orders on UDP."
**Why it's wrong:** Orders demand exactly-once, in-order, guaranteed delivery with acknowledgment — that is the entire reason FIX runs on TCP and has application-level sequence numbers on top. Losing an order or duplicating a fill is a P1 incident with regulatory exposure. UDP gives you none of those guarantees; you would have to rebuild TCP badly in application code.
**Correct:** UDP (usually multicast) is for market data where the fanout is huge, drops are recoverable via gap-fill / retransmit servers (arbitration A/B feeds), and stale ticks are worse than missing ticks. Orders stay on TCP — the handshake cost is paid once at logon and the session lives all day.

---

### R3. "Multicast market data has no drops because it's stateless"
**Interviewer signal:** Have they actually operated a market-data plant?
**Wrong:** "Multicast is UDP-based and stateless, so once we join the group we get every packet."
**Why it's wrong:** Multicast drops constantly — NIC ring buffer overruns, kernel socket buffer full (`netstat -su` RcvbufErrors), switch IGMP snooping timing out and pruning the group, spanning-tree reconvergence, PIM RP failover, or the publisher's own send-side drops. Exchanges publish A/B feeds *specifically* because drops are expected.
**Correct:** Assume drops. Monitor `RcvbufErrors`, per-interface `rx_dropped`, feed-handler gap counters, and sequence-gap alerts. Size `SO_RCVBUF` (`net.core.rmem_max`), pin the feed handler to a CPU on the NIC's NUMA node, use A/B arbitration, and have a TCP-based retransmit / snapshot recovery path.

---

### R4. "SSL and TLS are the same thing"
**Interviewer signal:** Do they know current crypto posture?
**Wrong:** "SSL and TLS are interchangeable names for the same protocol."
**Why it's wrong:** SSL 2.0/3.0 are dead — POODLE killed SSL 3.0 in 2014, and all SSL versions are deprecated by RFC 7568. TLS 1.0 and 1.1 were formally deprecated by RFC 8996 in 2021. Banks are on TLS 1.2 minimum, moving to 1.3. Calling them "the same" on a security review would fail the audit.
**Correct:** They're a lineage, not a synonym. SSL 3.0 → TLS 1.0 → 1.1 → 1.2 → 1.3, and each version changes cipher suites, handshake shape, and record protection. For a FIX-over-TLS connection I'd expect TLS 1.2+ with a modern AEAD suite (AES-GCM or ChaCha20-Poly1305), forward secrecy (ECDHE), and pinned cert chains.

---

### R5. "Colo eliminates all latency"
**Interviewer signal:** Do they understand the latency budget end-to-end?
**Wrong:** "We're colocated in the exchange data center so we have zero latency."
**Why it's wrong:** Colo shrinks the *wire* latency to microseconds, but the wire is only one hop. You still pay: NIC-to-kernel copy, kernel network stack, socket buffer, application deserialization, matching engine queuing, exchange gateway sequencing, cross-connect cable length differences (yes — same-length fiber matters between racks), and switch hops within the colo. HFT firms buy kernel-bypass (Solarflare/Onload, DPDK) precisely because colo alone isn't enough.
**Correct:** Colo reduces geographic latency; the remaining budget is dominated by host stack, application processing, and intra-DC switching. To get true low-latency you also need kernel bypass, busy-poll, CPU pinning, IRQ affinity, and careful cable-length equalization.

---

### R6. "Jumbo frames always help"
**Interviewer signal:** Do they understand where jumbo frames pay off vs where they hurt?
**Wrong:** "Set MTU to 9000 everywhere and throughput improves."
**Why it's wrong:** Jumbo frames help bulk throughput (backups, storage replication, big data shuffles) by amortizing per-packet overhead. For a FIX message that fits in 200 bytes, jumbo frames do nothing except add head-of-line blocking risk. Worse, if *any* device in the path (switch uplink, VPN, cross-connect, cloud provider) has MTU < 9000 and PMTU discovery is broken by an ICMP-blocking firewall, you get silent black-holing of large packets while small ones pass.
**Correct:** Jumbo frames are a bulk-throughput optimization end-to-end within a controlled L2 domain. Enable only when every device supports it and packets are actually large. For order flow, standard 1500 MTU is fine.

---

### R7. "MTU=1500 is a Linux setting"
**Interviewer signal:** Do they know MTU is a link-layer property, not an OS knob?
**Wrong:** "MTU 1500 is the default in Linux — Windows uses something else."
**Why it's wrong:** MTU=1500 comes from Ethernet II framing (RFC 894) — it's the maximum Ethernet payload size, defined by the standard, and it's the same on Linux, Windows, AIX, Solaris, and the switch. What varies is *path* MTU (tunnels shrink it: GRE −24, IPsec −50–70, PPPoE −8, VXLAN −50). Blaming Linux for MTU is a red flag on any triage call.
**Correct:** MTU is a property of the L2 medium. Ethernet is 1500 by convention. Overlays, VPNs, and tunnels reduce the effective payload, so you either lower MTU on the tunnel interface or rely on PMTUD (which requires ICMP Type 3 Code 4 not to be blocked).

---

### R8. "traceroute uses TCP"
**Interviewer signal:** Do they know their tools?
**Wrong:** "traceroute sends TCP SYNs with increasing TTL."
**Why it's wrong:** Classic Unix `traceroute` sends **UDP** to high ports with incrementing TTL and reads back ICMP Time Exceeded. Windows `tracert` uses **ICMP Echo**. There's a `tcptraceroute` / `traceroute -T` variant that uses TCP SYN, but it's opt-in and used specifically because firewalls block UDP/ICMP. Getting this wrong on a network troubleshooting question is bad.
**Correct:** Default Linux traceroute = UDP+ICMP. Windows tracert = ICMP. `traceroute -T -p 443` uses TCP SYN and is what I'd reach for when a firewall silently drops UDP or ICMP but permits the app port.

---

### R9. "DNS resolution is always cached at OS level"
**Interviewer signal:** Have they ever debugged a DNS latency spike?
**Wrong:** "The OS caches DNS so we only hit the resolver once."
**Why it's wrong:** Vanilla Linux does **not** cache DNS at the OS level — every `getaddrinfo` goes to `/etc/resolv.conf`'s configured resolver unless something in the path caches (nscd, systemd-resolved, dnsmasq, unbound, or the JVM's `networkaddress.cache.ttl`). If you don't run one of those, every connection re-queries. Conversely, the JVM caches DNS *forever* by default (`networkaddress.cache.ttl=-1` with a SecurityManager) which breaks DR failover.
**Correct:** Caching is per-component: nscd/systemd-resolved on the OS, JVM inside the process, and the app's own resolver library. In prod I check `ss -tulpn` for the resolver, `strace -e trace=network` to see actual queries, and set JVM `networkaddress.cache.ttl` to something sane like 30–60s so DNS-based failover works.

---

### R10. "netstat is deprecated so ss doesn't work on RHEL 7"
**Interviewer signal:** Do they use modern tooling?
**Wrong:** "We can't use `ss` because we're on RHEL 7 — `netstat` is the only option."
**Why it's wrong:** Backwards. `ss` (from `iproute2`) has been in RHEL since RHEL 6 and is *preferred* on RHEL 7; `netstat` (from `net-tools`) is the one that's deprecated. `ss` reads directly from kernel netlink and is dramatically faster on hosts with many sockets — a `netstat -a` on a busy FIX gateway with 50k sockets can take a minute; `ss -a` returns in a second.
**Correct:** `ss` works everywhere modern. `ss -tanp` for TCP with process, `ss -s` for a summary, `ss -tin` for TCP internals (rtt, cwnd, retransmits). `netstat` still works but is slower and gets deprecated per distro.

---

### R11. "RST from peer means firewall issue"
**Interviewer signal:** Can they read a packet capture?
**Wrong:** "We got a RST — must be a firewall in the middle."
**Why it's wrong:** RSTs come from several sources and blaming the firewall first wastes an hour. A RST from the peer host commonly means: (a) app crashed / closed with SO_LINGER=0, (b) port not listening (immediate RST on SYN), (c) app read from a half-closed socket, (d) sequence number invalid (out-of-window packet), (e) NAT/stateful firewall dropped the flow from its state table and RST'd the next packet. Only (e) is a firewall.
**Correct:** Check the RST's TTL and source IP in the pcap — if TTL matches the peer OS default it's from the peer host, not a middlebox. Then check the app log for crashes, `ss -tanp` for whether the listener is up, and firewall session-timeout config. On FIX, RSTs after long idle are classically NAT/firewall state timeout.

---

### R12. "Keepalive at 2 hours default keeps a FIX session alive"
**Interviewer signal:** Do they understand FIX-layer vs TCP-layer heartbeating?
**Wrong:** "TCP keepalive at 2 hours keeps the FIX session alive across idle periods."
**Why it's wrong:** Two problems. First, Linux default `tcp_keepalive_time=7200s` (2 hours) is way longer than a stateful firewall's idle timeout (typically 3600s or less) — so the firewall drops the flow before TCP even sends its first probe. Second, FIX has its own application-level heartbeat (tag 108, typically 30s) precisely so the *application* knows the session is alive, not the kernel. TCP keepalive is a fallback, not the mechanism.
**Correct:** FIX heartbeat (30s) is the primary liveness signal, with TestRequest (tag 112) on missed heartbeats. TCP keepalive should be tuned way down (`tcp_keepalive_time=60`, `_intvl=10`, `_probes=6`) as a belt-and-braces below the firewall idle timeout. Keep both.

---

### R13. "iperf shows FIX order latency"
**Interviewer signal:** Do they understand what a benchmark actually measures?
**Wrong:** "iperf3 shows 200µs RTT so our FIX latency is 200µs."
**Why it's wrong:** iperf measures raw TCP throughput / RTT between two hosts with a trivial payload — it does not include FIX parsing, session sequence-number handling, application matching logic, order-book updates, risk checks, drop-copy fanout, or any of the actual work an OMS does per message. FIX round-trip in a real OMS is dominated by application processing, not wire time.
**Correct:** iperf tells you the *floor* — what the network alone contributes. Real order latency is measured end-to-end with FIX SendingTime (52) vs ack SendingTime, correlated by ClOrdID, or with hardware timestamps at the NIC. For network-only budgeting, iperf is fine; for order-flow SLA, use application timestamps.

---

### R14. "Session resumption skips the cert"
**Interviewer signal:** Do they understand TLS handshake shapes?
**Wrong:** "TLS session resumption skips the certificate exchange entirely — no cert validation happens on the resumed session."
**Why it's wrong:** Session resumption (session IDs or session tickets in TLS 1.2, PSK in TLS 1.3) skips the *key exchange* and the *cert transmission on the wire*, but the peer's identity is still bound cryptographically to the resumed session — the ticket / PSK is derived from the original handshake's master secret, which was authenticated with the cert. If the cert were revoked between the original and the resumption, the resumed session inherits the original trust — which is why ticket lifetimes matter.
**Correct:** Resumption shortcuts the handshake for latency (1-RTT in TLS 1.2, 0-RTT in TLS 1.3) but the identity is inherited from the original full handshake. Rotate tickets, cap lifetimes, and force full handshakes periodically for revocation to take effect.

---

### R15. "TCP retransmit means bandwidth is exhausted"
**Interviewer signal:** Can they diagnose a retransmit correctly?
**Wrong:** "We see TCP retransmits — the link is saturated."
**Why it's wrong:** Retransmits mean the sender didn't get an ACK in RTO; that can be bandwidth exhaustion, but far more common causes on a well-provisioned bank link are: NIC ring-buffer drops (rx overruns visible in `ethtool -S`), microbursts overflowing a switch buffer, MTU/PMTUD black-hole (large packets silently dropped, small ones pass), a flapping route, unidirectional loss where the ACK path is broken, or a receive-side application not draining fast enough (zero-window). Bandwidth saturation would show as sustained high utilization on the interface graph, not sporadic retransmits.
**Correct:** Check `netstat -s | grep -iE 'retrans|drop'`, `ethtool -S` for NIC drops, `ss -tin` for per-socket retrans counters and cwnd, and interface graphs for actual utilization. Correlate retransmit timing with switch buffer stats and any known route changes. Bandwidth is one hypothesis out of many.

---

**Meta pattern:** almost every red flag above collapses one layer into another (TCP into UDP, MTU into OS, colo into zero-latency, TLS resumption into no-auth). The correct answers all *decompose* the stack and name which layer owns which behavior. On an interview, showing the decomposition matters more than reciting the fix.
