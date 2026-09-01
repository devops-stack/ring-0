package bpf

import "github.com/cilium/ebpf"

// Objects exposes the generated programs and maps without exposing generator
// implementation names to the sensor daemon.
type Objects = sensorObjects

func LoadObjects(objects *Objects, options *ebpf.CollectionOptions) error {
	return loadSensorObjects(objects, options)
}

// RawEvent must remain byte-for-byte aligned with struct sensor_event in
// sensor.bpf.c. Generated map bindings cannot infer a ring-buffer element type.
type RawEvent struct {
	StartNS    uint64
	EndNS      uint64
	DurationNS uint64
	Args       [6]uint64
	WakeupNS   uint64
	CgroupID   uint64
	Ret        int64
	PID        uint32
	TID        uint32
	UID        uint32
	CPU        uint32
	NR         uint32
	WakerPID   uint32
	WakerTID   uint32
	TargetCPU  uint32
	HasWakeup  uint8
	Pad        [7]uint8
	Comm       [16]byte
	WakerComm  [16]byte
}
