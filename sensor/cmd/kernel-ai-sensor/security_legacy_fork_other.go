//go:build !amd64

package main

// This architecture has no vfork syscall — glibc implements vfork() on top of
// clone, which securityNames() already traces. Nothing to add.
func legacyForkNames() map[uint32]string {
	return nil
}
