//go:build ignore

#include <linux/bpf.h>
#include <linux/types.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>

/* libbpf reads a kprobe's arguments out of the register frame and expects the
   layout to come from a vmlinux.h generated for the target architecture, which
   would mean carrying a three-megabyte header per architecture to obtain one
   field. Both layouts are stable kernel user ABI from asm/ptrace.h rather than
   internal structure, so they are spelled out here instead and there is
   nothing for CO-RE to relocate. */
#if defined(__TARGET_ARCH_x86)
struct pt_regs {
    __u64 r15, r14, r13, r12, rbp, rbx, r11, r10, r9, r8;
    __u64 rax, rcx, rdx, rsi, rdi, orig_rax, ip, cs, flags, sp, ss;
};
#elif defined(__TARGET_ARCH_arm64)
struct user_pt_regs {
    __u64 regs[31];
    __u64 sp, pc, pstate;
};
#else
#error "the peer distance kprobe needs a register layout for this architecture"
#endif

#include <bpf/bpf_tracing.h>

#define TASK_COMM_LEN 16
#define MAX_INFLIGHT 32768
#define RING_BYTES (8 * 1024 * 1024)
#define MAX_PEERS 4096

/* Wire offsets into the IPv4 header, fixed by RFC 791. These address packet
   bytes rather than a kernel struct, so they are stable and need no CO-RE. */
#define IPV4_TTL_OFFSET 8
#define IPV4_SADDR_OFFSET 12

struct trace_entry {
    __u16 type;
    __u8 flags;
    __u8 preempt_count;
    __s32 pid;
};

struct sys_enter_ctx {
    struct trace_entry common;
    __s64 id;
    __u64 args[6];
};

struct sys_exit_ctx {
    struct trace_entry common;
    __s64 id;
    __s64 ret;
};

struct sched_wakeup_ctx {
    struct trace_entry common;
    char comm[TASK_COMM_LEN];
    __s32 pid;
    __s32 prio;
    __s32 target_cpu;
};

struct inflight_value {
    __u64 start_ns;
    __u64 args[6];
    __u32 pid;
    __u32 uid;
    __u32 nr;
};

struct wakeup_value {
    __u64 ts_ns;
    __u32 waker_pid;
    __u32 waker_tid;
    __u32 target_cpu;
    char waker_comm[TASK_COMM_LEN];
};

struct sensor_event {
    __u64 start_ns;
    __u64 end_ns;
    __u64 duration_ns;
    __u64 args[6];
    __u64 wakeup_ns;
    __u64 cgroup_id;
    __s64 ret;
    __u32 pid;
    __u32 tid;
    __u32 uid;
    __u32 cpu;
    __u32 nr;
    __u32 waker_pid;
    __u32 waker_tid;
    __u32 target_cpu;
    __u8 has_wakeup;
    __u8 _pad[7];
    char comm[TASK_COMM_LEN];
    char waker_comm[TASK_COMM_LEN];
};

/* Only the two fields the TTL read needs, declared partially and with
   preserve_access_index so libbpf relocates them against the running kernel.
   sk_buff.head sits at bit offset 1536 on the 5.15 dev kernel and 1600 on the
   6.8 kernel in production, so a hardcoded offset would read garbage on one of
   the two. */
struct sk_buff {
    __u16 network_header;
    unsigned char *head;
} __attribute__((preserve_access_index));

/* Never dereferenced: tcp_v4_conn_request takes it as its first argument, and
   the probe only needs the second. */
struct sock;

struct peer_distance {
    __u64 last_ns;
    __u64 connections;
    __u8 min_ttl;
    __u8 last_ttl;
    __u8 _pad[6];
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, MAX_INFLIGHT);
    __type(key, __u32);
    __type(value, struct inflight_value);
} inflight SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, MAX_INFLIGHT);
    __type(key, __u32);
    __type(value, struct wakeup_value);
} wakeups SEC(".maps");

/* nr -> minimum completed duration in ns. Presence means "traced"; the value
   is the floor below which the span is dropped in-kernel. Two classes share
   one map: the latency set carries the --min-duration floor so the
   visualisation stream stays quiet, the security set carries 0 because
   execve/setresuid/ptrace finish in microseconds and must still be reported. */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 512);
    __type(key, __u32);
    __type(value, __u64);
} watched_syscalls SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 32);
    __type(key, __u32);
    __type(value, __u8);
} ignored_tgids SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u64);
} drops SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, RING_BYTES);
} events SEC(".maps");

/* Client IPv4 address (network byte order) -> arriving TTL. LRU rather than
   plain hash: the key space is every address that ever connects, and the
   oldest peer is the right one to forget. Read by userspace on an interval,
   not streamed, because this answers a lookup ("how far is this address")
   rather than describing an event. */
struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, MAX_PEERS);
    __type(key, __u32);
    __type(value, struct peer_distance);
} peer_distance SEC(".maps");

static __always_inline void count_drop(void)
{
    __u32 key = 0;
    __u64 *value = bpf_map_lookup_elem(&drops, &key);
    if (value)
        __sync_fetch_and_add(value, 1);
}

SEC("tracepoint/raw_syscalls/sys_enter")
int trace_sys_enter(struct sys_enter_ctx *ctx)
{
    __u32 nr = (__u32)ctx->id;
    if (!bpf_map_lookup_elem(&watched_syscalls, &nr))
        return 0;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 tgid = pid_tgid >> 32;
    if (bpf_map_lookup_elem(&ignored_tgids, &tgid))
        return 0;
    __u32 tid = (__u32)pid_tgid;
    struct inflight_value value;
    __builtin_memset(&value, 0, sizeof(value));
    value.start_ns = bpf_ktime_get_ns();
    value.pid = tgid;
    value.uid = (__u32)bpf_get_current_uid_gid();
    value.nr = nr;
    __builtin_memcpy(value.args, ctx->args, sizeof(value.args));
    bpf_map_update_elem(&inflight, &tid, &value, BPF_ANY);
    return 0;
}

SEC("tracepoint/sched/sched_wakeup")
int trace_sched_wakeup(struct sched_wakeup_ctx *ctx)
{
    __u32 wakee_tid = (__u32)ctx->pid;
    if (!bpf_map_lookup_elem(&inflight, &wakee_tid))
        return 0;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct wakeup_value value;
    __builtin_memset(&value, 0, sizeof(value));
    value.ts_ns = bpf_ktime_get_ns();
    value.waker_pid = pid_tgid >> 32;
    value.waker_tid = (__u32)pid_tgid;
    value.target_cpu = (__u32)ctx->target_cpu;
    bpf_get_current_comm(value.waker_comm, sizeof(value.waker_comm));
    bpf_map_update_elem(&wakeups, &wakee_tid, &value, BPF_ANY);
    return 0;
}

SEC("tracepoint/raw_syscalls/sys_exit")
int trace_sys_exit(struct sys_exit_ctx *ctx)
{
    __u32 tid = (__u32)bpf_get_current_pid_tgid();
    struct inflight_value *started = bpf_map_lookup_elem(&inflight, &tid);
    if (!started)
        return 0;
    if (started->nr != (__u32)ctx->id)
        goto cleanup;

    __u64 end_ns = bpf_ktime_get_ns();
    __u64 duration_ns = end_ns - started->start_ns;
    __u64 *minimum_ns = bpf_map_lookup_elem(&watched_syscalls, &started->nr);
    if (minimum_ns && duration_ns < *minimum_ns)
        goto cleanup;

    struct sensor_event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        count_drop();
        goto cleanup;
    }
    __builtin_memset(event, 0, sizeof(*event));
    event->start_ns = started->start_ns;
    event->end_ns = end_ns;
    event->duration_ns = duration_ns;
    __builtin_memcpy(event->args, started->args, sizeof(event->args));
    event->cgroup_id = bpf_get_current_cgroup_id();
    event->ret = ctx->ret;
    event->pid = started->pid;
    event->tid = tid;
    event->uid = started->uid;
    event->cpu = bpf_get_smp_processor_id();
    event->nr = started->nr;
    event->has_wakeup = 0;
    bpf_get_current_comm(event->comm, sizeof(event->comm));

    struct wakeup_value *wakeup = bpf_map_lookup_elem(&wakeups, &tid);
    if (wakeup && wakeup->ts_ns >= started->start_ns) {
        event->has_wakeup = 1;
        event->wakeup_ns = wakeup->ts_ns;
        event->waker_pid = wakeup->waker_pid;
        event->waker_tid = wakeup->waker_tid;
        event->target_cpu = wakeup->target_cpu;
        __builtin_memcpy(event->waker_comm, wakeup->waker_comm, sizeof(event->waker_comm));
    }
    bpf_ringbuf_submit(event, 0);

cleanup:
    bpf_map_delete_elem(&wakeups, &tid);
    bpf_map_delete_elem(&inflight, &tid);
    return 0;
}

/* Inbound SYN to a TCP listener: the one point per connection where the
   client's TTL is present and means something. A per-packet hook on
   tcp_v4_rcv answers the same question but fired 54 times for four page loads
   on the dev box, re-deriving a value that cannot change within a connection.

   The generic handler rather than tcp_v4_conn_request, which looks like the
   obvious choice and is not: measured on the dev box, a Go listener reaches
   tcp_conn_request without ever passing through the IPv4 wrapper, where
   gunicorn and python's http.server pass through both. The generic handler
   fired for every listener tried, so it is the one that cannot quietly miss a
   visitor. It serves IPv6 as well, hence the version check below.

   kprobe rather than fentry because the arm64 dev kernel has no BPF
   trampoline and fentry cannot attach there at all; the cost is that
   PT_REGS_PARM4 is arch-specific, which is why the object is generated per
   target architecture. */
SEC("kprobe/tcp_conn_request")
int BPF_KPROBE(trace_conn_request, void *rsk_ops, void *af_ops,
               struct sock *sk, struct sk_buff *skb)
{
    unsigned char *head = BPF_CORE_READ(skb, head);
    if (!head)
        return 0;
    __u16 network_header = BPF_CORE_READ(skb, network_header);

    __u8 version = 0;
    if (bpf_probe_read_kernel(&version, sizeof(version),
                              head + network_header))
        return 0;
    /* High nibble of the first header byte. IPv6 carries a hop limit rather
       than a TTL and a sixteen-byte address, so it needs its own record; the
       production listeners are IPv4-only, so it is skipped rather than
       half-handled. */
    if ((version >> 4) != 4)
        return 0;

    __u8 ttl = 0;
    __u32 saddr = 0;
    if (bpf_probe_read_kernel(&ttl, sizeof(ttl),
                              head + network_header + IPV4_TTL_OFFSET))
        return 0;
    if (bpf_probe_read_kernel(&saddr, sizeof(saddr),
                              head + network_header + IPV4_SADDR_OFFSET))
        return 0;
    if (!ttl || !saddr)
        return 0;

    __u64 now = bpf_ktime_get_ns();
    struct peer_distance *seen = bpf_map_lookup_elem(&peer_distance, &saddr);
    if (seen) {
        /* Minimum, not latest: a longer path can only lower the arriving TTL,
           so the minimum is the longest route seen and the hop count stops
           flickering when a route changes between connections. */
        if (ttl < seen->min_ttl)
            seen->min_ttl = ttl;
        seen->last_ttl = ttl;
        seen->last_ns = now;
        __sync_fetch_and_add(&seen->connections, 1);
        return 0;
    }

    struct peer_distance fresh;
    __builtin_memset(&fresh, 0, sizeof(fresh));
    fresh.min_ttl = ttl;
    fresh.last_ttl = ttl;
    fresh.last_ns = now;
    fresh.connections = 1;
    bpf_map_update_elem(&peer_distance, &saddr, &fresh, BPF_ANY);
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
