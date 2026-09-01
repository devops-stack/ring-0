//go:build ignore

#include <linux/bpf.h>
#include <linux/types.h>
#include <bpf/bpf_helpers.h>

#define TASK_COMM_LEN 16
#define MAX_INFLIGHT 32768
#define RING_BYTES (8 * 1024 * 1024)

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

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 512);
    __type(key, __u32);
    __type(value, __u8);
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
} config SEC(".maps");

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
    __u32 config_key = 0;
    __u64 *minimum_ns = bpf_map_lookup_elem(&config, &config_key);
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

char LICENSE[] SEC("license") = "GPL";
