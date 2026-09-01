// Package bpf contains generated bindings for the kernel sensor programs.
package bpf

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -target bpfel -cflags "-O2 -g -Wall -Werror -I/usr/include/aarch64-linux-gnu" sensor sensor.bpf.c
