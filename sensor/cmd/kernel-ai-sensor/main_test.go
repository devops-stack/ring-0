package main

import (
	"encoding/binary"
	"testing"

	sensorbpf "kernel-ai/sensor/internal/bpf"
	"kernel-ai/sensor/internal/event"
)

func TestRawEventLayoutMatchesBPF(t *testing.T) {
	if size := binary.Size(sensorbpf.RawEvent{}); size != 168 {
		t.Fatalf("RawEvent size = %d, want 168", size)
	}
}

func TestNormalizeProducesVersionedSyscallSpan(t *testing.T) {
	raw := sensorbpf.RawEvent{
		StartNS:    2_000_000_000,
		EndNS:      2_250_000_000,
		DurationNS: 250_000_000,
		PID:        42,
		TID:        43,
		UID:        1000,
		CPU:        2,
		NR:         98,
		Ret:        0,
		CgroupID:   9001,
		HasWakeup:  1,
		WakeupNS:   2_200_000_000,
		WakerPID:   10,
		WakerTID:   11,
		TargetCPU:  2,
	}
	copy(raw.Comm[:], "worker")
	copy(raw.WakerComm[:], "producer")

	got := normalize(raw, 7, 1_700_000_000_000_000_000, map[uint32]string{98: "futex"})

	if got.Schema != event.SchemaV1 || got.Sequence != 7 || got.Kind != "syscall_span" {
		t.Fatalf("unexpected envelope: %#v", got)
	}
	if got.Syscall.Name != "futex" || got.Syscall.DurationUS != 250_000 {
		t.Fatalf("unexpected syscall: %#v", got.Syscall)
	}
	if got.Comm != "worker" || got.Wakeup == nil || got.Wakeup.WakerComm != "producer" {
		t.Fatalf("unexpected task/wakeup: %#v", got)
	}
}
