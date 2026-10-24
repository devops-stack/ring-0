# kernel-ai sensor

Privileged eBPF producer for kernel-ai. It pairs selected
`raw_syscalls:sys_enter`/`sys_exit` tracepoints, correlates
`sched:sched_wakeup`, and emits normalized `kernel.event/v1` JSON packets over
a bounded Unix `SOCK_SEQPACKET` socket.

The bpftrace collector is retained as a rollback path but must not write the
same snapshot while this sensor and broker are active.

```bash
go generate ./internal/bpf
go test ./...
go build -o kernel-ai-sensor ./cmd/kernel-ai-sensor
sudo ./kernel-ai-sensor --socket /run/kernel-ai-sensor/sensor.sock
```

The generated eBPF object is embedded in the Go binary. Production therefore
needs only the binary and systemd unit, not Go, clang, or kernel headers.

`deploy/ebpf/sensor_broker.py` is the unprivileged consumer. It validates the
contract, applies a second rate bound, and atomically publishes inside its own
`/run/kernel-ai-sensor` runtime directory. A tmpfiles-managed compatibility
link exposes that snapshot as `/run/kernel-ai/kernel-events.json`, the path
already consumed by `/api/kernel-events`.
