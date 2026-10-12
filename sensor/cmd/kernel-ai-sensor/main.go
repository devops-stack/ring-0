package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
	"golang.org/x/sys/unix"

	sensorbpf "kernel-ai/sensor/internal/bpf"
	"kernel-ai/sensor/internal/event"
	"kernel-ai/sensor/internal/peer"
)

type config struct {
	socketPath           string
	securitySocketPath   string
	peerSnapshotPath     string
	peerSnapshotInterval time.Duration
	minDuration          time.Duration
	printEvents          bool
}

type client struct {
	conn  net.Conn
	queue chan []byte
}

type broker struct {
	mu      sync.Mutex
	clients map[*client]struct{}
	dropped atomic.Uint64
}

func newBroker() *broker {
	return &broker{clients: make(map[*client]struct{})}
}

func (b *broker) publish(payload []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for subscriber := range b.clients {
		select {
		case subscriber.queue <- payload:
		default:
			b.dropped.Add(1)
		}
	}
}

func (b *broker) remove(subscriber *client) {
	b.mu.Lock()
	if _, ok := b.clients[subscriber]; ok {
		delete(b.clients, subscriber)
		close(subscriber.queue)
	}
	b.mu.Unlock()
	_ = subscriber.conn.Close()
}

func (b *broker) writeLoop(subscriber *client) {
	defer b.remove(subscriber)
	for payload := range subscriber.queue {
		_ = subscriber.conn.SetWriteDeadline(time.Now().Add(time.Second))
		if _, err := subscriber.conn.Write(payload); err != nil {
			return
		}
	}
}

func (b *broker) serve(ctx context.Context, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o775); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	listener, err := net.Listen("unixpacket", path)
	if err != nil {
		return err
	}
	if err := os.Chmod(path, 0o660); err != nil {
		_ = listener.Close()
		return err
	}
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	go func() {
		<-ctx.Done()
		_ = os.Remove(path)
	}()
	for {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			if ctx.Err() != nil {
				return nil
			}
			return acceptErr
		}
		subscriber := &client{conn: conn, queue: make(chan []byte, 64)}
		b.mu.Lock()
		b.clients[subscriber] = struct{}{}
		b.mu.Unlock()
		go b.writeLoop(subscriber)
	}
}

// latencyNames are traced for the visualisation stream: what a process is
// waiting on. They only matter when they are slow, so they keep the
// --min-duration floor.
func latencyNames() map[uint32]string {
	return map[uint32]string{
		unix.SYS_READ:            "read",
		unix.SYS_WRITE:           "write",
		unix.SYS_CLOSE:           "close",
		unix.SYS_FUTEX:           "futex",
		unix.SYS_EPOLL_PWAIT:     "epoll_pwait",
		unix.SYS_PPOLL:           "ppoll",
		unix.SYS_PSELECT6:        "pselect6",
		unix.SYS_CLOCK_NANOSLEEP: "clock_nanosleep",
		unix.SYS_ACCEPT:          "accept",
		unix.SYS_ACCEPT4:         "accept4",
		unix.SYS_CONNECT:         "connect",
		unix.SYS_OPENAT:          "openat",
		unix.SYS_EXECVE:          "execve",
		unix.SYS_CLONE:           "clone",
		unix.SYS_RECVFROM:        "recvfrom",
		unix.SYS_RECVMSG:         "recvmsg",
		unix.SYS_SENDTO:          "sendto",
		unix.SYS_SENDMSG:         "sendmsg",
		unix.SYS_IO_URING_ENTER:  "io_uring_enter",
	}
}

// securityNames are traced for the ML sequence stages. Duration is irrelevant
// here — the signal is that the call happened at all, and in what order — so
// these are stored with a zero floor and routed to the security socket.
//
// The map below is the arch-independent core. Syscalls that exist in only one
// ABI live in legacyForkNames(), which is build-tagged, because the unix.SYS_*
// constants for them do not compile on architectures that lack them.
//
// openat and mprotect are deliberately absent, matching the audit rule set
// that built the existing profile. Measured here, openat alone is 2400/s —
// 25x every other security syscall combined — and as a bare token it carries
// almost nothing: its signal is the path argument, which the n-gram contract
// does not yet transport. Add it back together with argument-aware tokens.
func securityNames() map[uint32]string {
	names := map[uint32]string{
		unix.SYS_EXECVE:            "execve",
		unix.SYS_EXECVEAT:          "execveat",
		unix.SYS_CLONE:             "clone",
		unix.SYS_CLONE3:            "clone3",
		unix.SYS_CONNECT:           "connect",
		unix.SYS_ACCEPT:            "accept",
		unix.SYS_ACCEPT4:           "accept4",
		unix.SYS_BIND:              "bind",
		unix.SYS_LISTEN:            "listen",
		unix.SYS_UNLINKAT:          "unlinkat",
		unix.SYS_RENAMEAT:          "renameat",
		unix.SYS_RENAMEAT2:         "renameat2",
		unix.SYS_SETUID:            "setuid",
		unix.SYS_SETREUID:          "setreuid",
		unix.SYS_SETRESUID:         "setresuid",
		unix.SYS_SETGID:            "setgid",
		unix.SYS_SETREGID:          "setregid",
		unix.SYS_SETRESGID:         "setresgid",
		unix.SYS_PTRACE:            "ptrace",
		unix.SYS_PROCESS_VM_WRITEV: "process_vm_writev",
		unix.SYS_MEMFD_CREATE:      "memfd_create",
		unix.SYS_USERFAULTFD:       "userfaultfd",
	}
	for nr, name := range legacyForkNames() {
		names[nr] = name
	}
	return names
}

// syscallNames is the union used to label events.
func syscallNames() map[uint32]string {
	names := latencyNames()
	for nr, name := range securityNames() {
		names[nr] = name
	}
	return names
}

func subsystem(name string) string {
	switch name {
	case "read", "write", "close", "openat":
		return "fs"
	case "accept", "accept4", "connect", "recvfrom", "recvmsg", "sendto", "sendmsg":
		return "net"
	case "clone", "execve", "futex", "clock_nanosleep":
		return "sched"
	default:
		return "kernel"
	}
}

func comm(value [16]byte) string {
	return string(bytes.TrimRight(value[:], "\x00"))
}

func bootWallOffset() (int64, error) {
	var boot unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_BOOTTIME, &boot); err != nil {
		return 0, err
	}
	return time.Now().UnixNano() - boot.Nano(), nil
}

func fdResource(pid, nr uint32, args [6]uint64, names map[uint32]string) (*uint32, string) {
	switch names[nr] {
	case "read", "write", "close", "accept", "accept4", "connect",
		"recvfrom", "recvmsg", "sendto", "sendmsg", "epoll_pwait", "io_uring_enter":
	default:
		return nil, ""
	}
	if args[0] > 65535 {
		return nil, ""
	}
	fd := uint32(args[0])
	target, _ := os.Readlink(fmt.Sprintf("/proc/%d/fd/%d", pid, fd))
	return &fd, target
}

func normalize(raw sensorbpf.RawEvent, sequence uint64, offset int64, names map[uint32]string) event.KernelEventV1 {
	name := names[raw.NR]
	if name == "" {
		name = fmt.Sprintf("syscall_%d", raw.NR)
	}
	fd, target := fdResource(raw.PID, raw.NR, raw.Args, names)
	normalized := event.KernelEventV1{
		Schema:    event.SchemaV1,
		Sequence:  sequence,
		Kind:      "syscall_span",
		Source:    "ebpf-ringbuf",
		Timestamp: time.Unix(0, offset+int64(raw.EndNS)).UTC().Format(time.RFC3339Nano),
		StartNS:   raw.StartNS,
		EndNS:     raw.EndNS,
		PID:       raw.PID,
		TID:       raw.TID,
		UID:       raw.UID,
		CPU:       raw.CPU,
		CgroupID:  raw.CgroupID,
		Comm:      comm(raw.Comm),
		Subsystem: subsystem(name),
		Syscall: event.SyscallSpan{
			NR:         raw.NR,
			Name:       name,
			Args:       raw.Args,
			Return:     raw.Ret,
			DurationUS: raw.DurationNS / 1000,
			FD:         fd,
			FDTarget:   target,
		},
	}
	if raw.HasWakeup != 0 {
		normalized.Wakeup = &event.Wakeup{
			AtNS:      raw.WakeupNS,
			WakerPID:  raw.WakerPID,
			WakerTID:  raw.WakerTID,
			WakerComm: comm(raw.WakerComm),
			WakeeTID:  raw.TID,
			TargetCPU: raw.TargetCPU,
		}
	}
	return normalized
}

func parseFlags() config {
	var cfg config
	flag.StringVar(&cfg.socketPath, "socket", "/run/kernel-ai/sensor.sock", "unixpacket output socket")
	flag.StringVar(&cfg.securitySocketPath, "security-socket", "", "unixpacket socket for the security syscall class (empty = class not traced)")
	flag.StringVar(&cfg.peerSnapshotPath, "peer-distance-snapshot", "", "file to publish per-peer TTL distance to (empty = not measured)")
	flag.DurationVar(&cfg.peerSnapshotInterval, "peer-distance-interval", 5*time.Second, "how often to republish the peer distance snapshot")
	flag.DurationVar(&cfg.minDuration, "min-duration", 100*time.Millisecond, "minimum completed syscall duration (latency class only)")
	flag.BoolVar(&cfg.printEvents, "print", false, "also write event JSON to stdout")
	flag.Parse()
	return cfg
}

func run(ctx context.Context, cfg config) error {
	if err := rlimit.RemoveMemlock(); err != nil {
		return fmt.Errorf("remove memlock: %w", err)
	}
	var objects sensorbpf.Objects
	if err := sensorbpf.LoadObjects(&objects, nil); err != nil {
		return fmt.Errorf("load eBPF objects: %w", err)
	}
	defer objects.Close()

	latency := latencyNames()
	security := map[uint32]string{}
	if cfg.securitySocketPath != "" {
		security = securityNames()
	}
	names := latencyNames()
	for nr, name := range security {
		names[nr] = name
	}

	// One floor per syscall. Where the two classes overlap the security floor
	// wins, because a zero floor is the only one that admits both consumers'
	// events; the latency socket re-applies its own floor in userspace below.
	floors := make(map[uint32]uint64, len(names))
	for nr := range latency {
		floors[nr] = uint64(cfg.minDuration)
	}
	for nr := range security {
		floors[nr] = 0
	}
	for nr, floor := range floors {
		if err := objects.WatchedSyscalls.Put(nr, floor); err != nil {
			return fmt.Errorf("watch syscall %d: %w", nr, err)
		}
	}
	self := uint32(os.Getpid())
	if err := objects.IgnoredTgids.Put(self, uint8(1)); err != nil {
		return fmt.Errorf("ignore sensor process: %w", err)
	}

	links := make([]link.Link, 0, 3)
	enterLink, err := link.Tracepoint("raw_syscalls", "sys_enter", objects.TraceSysEnter, nil)
	if err != nil {
		return fmt.Errorf("attach sys_enter: %w", err)
	}
	links = append(links, enterLink)
	exitLink, err := link.Tracepoint("raw_syscalls", "sys_exit", objects.TraceSysExit, nil)
	if err != nil {
		return fmt.Errorf("attach sys_exit: %w", err)
	}
	links = append(links, exitLink)
	wakeupLink, err := link.Tracepoint("sched", "sched_wakeup", objects.TraceSchedWakeup, nil)
	if err != nil {
		return fmt.Errorf("attach sched_wakeup: %w", err)
	}
	links = append(links, wakeupLink)
	if cfg.peerSnapshotPath != "" {
		// The generic handler, not tcp_v4_conn_request: a Go listener reaches
		// this one without passing through the IPv4 wrapper, so the wrapper
		// can miss connections depending on who is listening.
		connLink, err := link.Kprobe("tcp_conn_request", objects.TraceConnRequest, nil)
		if err != nil {
			return fmt.Errorf("attach tcp_conn_request: %w", err)
		}
		links = append(links, connLink)
	}
	defer func() {
		for _, attached := range links {
			_ = attached.Close()
		}
	}()

	reader, err := ringbuf.NewReader(objects.Events)
	if err != nil {
		return fmt.Errorf("open ring buffer: %w", err)
	}
	defer reader.Close()
	go func() {
		<-ctx.Done()
		_ = reader.Close()
	}()

	stream := newBroker()
	go func() {
		if serveErr := stream.serve(ctx, cfg.socketPath); serveErr != nil && ctx.Err() == nil {
			log.Printf("socket server stopped: %v", serveErr)
		}
	}()

	var securityStream *broker
	if cfg.securitySocketPath != "" {
		securityStream = newBroker()
		go func() {
			if serveErr := securityStream.serve(ctx, cfg.securitySocketPath); serveErr != nil && ctx.Err() == nil {
				log.Printf("security socket server stopped: %v", serveErr)
			}
		}()
	}

	offset, err := bootWallOffset()
	if err != nil {
		return fmt.Errorf("clock offset: %w", err)
	}
	if cfg.peerSnapshotPath != "" {
		go publishPeerDistance(ctx, objects.PeerDistance, cfg, offset)
	}

	var sequence uint64
	log.Printf("sensor ready socket=%s syscalls=%d min_duration=%s security_socket=%q security_syscalls=%d",
		cfg.socketPath, len(names), cfg.minDuration, cfg.securitySocketPath, len(security))
	for {
		record, readErr := reader.Read()
		if readErr != nil {
			if errors.Is(readErr, ringbuf.ErrClosed) || ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("read ring buffer: %w", readErr)
		}
		var raw sensorbpf.RawEvent
		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &raw); err != nil {
			log.Printf("decode event: %v", err)
			continue
		}
		sequence++
		normalized := normalize(raw, sequence, offset, names)
		payload, err := json.Marshal(normalized)
		if err != nil {
			continue
		}
		payload = append(payload, '\n')
		if _, ok := security[raw.NR]; ok && securityStream != nil {
			securityStream.publish(payload)
		}
		// The latency floor is no longer enforced in-kernel for syscalls the
		// security class also watches, so re-apply it here. Without this the
		// visualisation stream would suddenly carry every microsecond-long
		// accept4, which is the load the Stage 6 rollback was avoiding.
		if _, ok := latency[raw.NR]; ok && raw.DurationNS >= uint64(cfg.minDuration) {
			stream.publish(payload)
		}
		if cfg.printEvents {
			_, _ = os.Stdout.Write(payload)
		}
	}
}

// publishPeerDistance republishes the whole peer map on an interval.
//
// The map is read rather than drained: an entry is the current answer about an
// address, not a backlog of events, and the kernel side keeps it bounded by
// evicting the least recently used peer.
func publishPeerDistance(ctx context.Context, peers *ebpf.Map, cfg config, offset int64) {
	ticker := time.NewTicker(cfg.peerSnapshotInterval)
	defer ticker.Stop()
	var lastFailure string
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		distances, err := readPeerDistance(peers, offset)
		if err == nil {
			err = peer.Write(cfg.peerSnapshotPath, distances, time.Now())
		}
		if err != nil {
			// Repeated identical failures would otherwise be one journal line
			// every interval for as long as the condition lasts.
			if message := err.Error(); message != lastFailure {
				lastFailure = message
				log.Printf("peer distance snapshot: %v", err)
			}
			continue
		}
		lastFailure = ""
	}
}

func readPeerDistance(peers *ebpf.Map, offset int64) ([]peer.Distance, error) {
	var (
		key       uint32
		value     sensorbpf.PeerDistance
		distances []peer.Distance
	)
	entries := peers.Iterate()
	for entries.Next(&key, &value) {
		// The key holds the address as it sat on the wire, so the bytes are
		// laid back out in the order the kernel read them rather than
		// reinterpreted as a number.
		address := make(net.IP, net.IPv4len)
		binary.NativeEndian.PutUint32(address, key)
		distances = append(distances, peer.Describe(
			address.String(),
			value.MinTtl,
			value.Connections,
			time.Unix(0, int64(value.LastNs)+offset),
		))
	}
	if err := entries.Err(); err != nil {
		return nil, fmt.Errorf("iterate peer map: %w", err)
	}
	return distances, nil
}

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds | log.LUTC)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, parseFlags()); err != nil {
		log.Fatal(err)
	}
}
