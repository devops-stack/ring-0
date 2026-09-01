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

	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
	"golang.org/x/sys/unix"

	sensorbpf "kernel-ai/sensor/internal/bpf"
	"kernel-ai/sensor/internal/event"
)

type config struct {
	socketPath  string
	minDuration time.Duration
	printEvents bool
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

func syscallNames() map[uint32]string {
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
		unix.SYS_RECVFROM:        "recvfrom",
		unix.SYS_RECVMSG:         "recvmsg",
		unix.SYS_SENDTO:          "sendto",
		unix.SYS_SENDMSG:         "sendmsg",
		unix.SYS_OPENAT:          "openat",
		unix.SYS_EXECVE:          "execve",
		unix.SYS_CLONE:           "clone",
		unix.SYS_IO_URING_ENTER:  "io_uring_enter",
	}
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
	flag.DurationVar(&cfg.minDuration, "min-duration", 100*time.Millisecond, "minimum completed syscall duration")
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

	names := syscallNames()
	enabled := uint8(1)
	for nr := range names {
		key := nr
		if err := objects.WatchedSyscalls.Put(key, enabled); err != nil {
			return fmt.Errorf("watch syscall %d: %w", nr, err)
		}
	}
	self := uint32(os.Getpid())
	if err := objects.IgnoredTgids.Put(self, enabled); err != nil {
		return fmt.Errorf("ignore sensor process: %w", err)
	}
	configKey := uint32(0)
	minimumNS := uint64(cfg.minDuration)
	if err := objects.Config.Put(configKey, minimumNS); err != nil {
		return fmt.Errorf("set minimum duration: %w", err)
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

	offset, err := bootWallOffset()
	if err != nil {
		return fmt.Errorf("clock offset: %w", err)
	}
	var sequence uint64
	log.Printf("sensor ready socket=%s syscalls=%d min_duration=%s", cfg.socketPath, len(names), cfg.minDuration)
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
		stream.publish(payload)
		if cfg.printEvents {
			_, _ = os.Stdout.Write(payload)
		}
	}
}

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds | log.LUTC)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, parseFlags()); err != nil {
		log.Fatal(err)
	}
}
