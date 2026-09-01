# kernel-ai sensor

Privileged eBPF producer for kernel-ai. It pairs selected
`raw_syscalls:sys_enter`/`sys_exit` tracepoints, correlates
`sched:sched_wakeup`, and emits normalized `kernel.event/v1` JSON packets over
a bounded Unix `SOCK_SEQPACKET` socket.

The existing bpftrace collector remains the active application source while
this daemon is validated side by side.

```bash
go generate ./internal/bpf
go test ./...
go build -o kernel-ai-sensor ./cmd/kernel-ai-sensor
sudo ./kernel-ai-sensor -socket /run/kernel-ai/sensor-dev.sock
```

The generated eBPF object is embedded in the Go binary. Production therefore
needs only the binary and systemd unit, not Go, clang, or kernel headers.

`deploy/ebpf/sensor_broker.py` is the unprivileged consumer. It validates the
contract, applies a second rate bound, and atomically publishes the snapshot
shape already consumed by `/api/kernel-events`. Its side-by-side default is
`/run/kernel-ai/kernel-events-v1.json`; changing the backend snapshot path is a
separate cutover step.
