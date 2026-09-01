package event

const SchemaV1 = "kernel.event/v1"

type SyscallSpan struct {
	NR         uint32    `json:"nr"`
	Name       string    `json:"name"`
	Args       [6]uint64 `json:"args"`
	Return     int64     `json:"return"`
	DurationUS uint64    `json:"duration_us"`
	FD         *uint32   `json:"fd,omitempty"`
	FDTarget   string    `json:"fd_target,omitempty"`
}

type Wakeup struct {
	AtNS      uint64 `json:"at_monotonic_ns"`
	WakerPID  uint32 `json:"waker_pid"`
	WakerTID  uint32 `json:"waker_tid"`
	WakerComm string `json:"waker_comm"`
	WakeeTID  uint32 `json:"wakee_tid"`
	TargetCPU uint32 `json:"target_cpu"`
}

type KernelEventV1 struct {
	Schema    string      `json:"schema"`
	Sequence  uint64      `json:"seq"`
	Kind      string      `json:"kind"`
	Source    string      `json:"source"`
	Timestamp string      `json:"timestamp"`
	StartNS   uint64      `json:"start_monotonic_ns"`
	EndNS     uint64      `json:"end_monotonic_ns"`
	PID       uint32      `json:"pid"`
	TID       uint32      `json:"tid"`
	UID       uint32      `json:"uid"`
	CPU       uint32      `json:"cpu"`
	CgroupID  uint64      `json:"cgroup_id"`
	Comm      string      `json:"comm"`
	Subsystem string      `json:"subsystem"`
	Syscall   SyscallSpan `json:"syscall"`
	Wakeup    *Wakeup     `json:"wakeup,omitempty"`
}
