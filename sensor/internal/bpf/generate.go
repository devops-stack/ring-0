// Package bpf contains generated bindings for the kernel sensor programs.
package bpf

// Generated per target architecture rather than once as bpfel: the TTL probe
// is a kprobe, and PT_REGS_PARM2 expands to a different register on x86 than
// on arm64. Everything else in the object is architecture-neutral, so the two
// artifacts differ only in that read.
//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -target amd64,arm64 -cflags "-O2 -g -Wall -Werror -I/usr/include/aarch64-linux-gnu" sensor sensor.bpf.c
