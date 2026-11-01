//go:build amd64

package main

import "golang.org/x/sys/unix"

// legacyForkNames are the process-creation syscalls that only exist in the
// x86 ABI. They are a build-tagged file rather than an entry in
// securityNames() because unix.SYS_VFORK is undefined on arm64 and would not
// compile there at all.
//
// vfork earns its place from measurement, not theory: on the amd64 production
// host it produced 80726 observations across 73 distinct trigrams under the
// old audit feed, so leaving it out both loses a process-creation primitive
// and permanently skews the sequence profile.
//
// fork is deliberately absent. It never fired once in 15 days on the same
// host, because glibc routes fork() through clone. Tracing it would only add
// a token the profile has never seen.
func legacyForkNames() map[uint32]string {
	return map[uint32]string{
		unix.SYS_VFORK: "vfork",
	}
}
