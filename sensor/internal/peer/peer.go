// Package peer turns the TTL the kernel saw on an inbound SYN into a distance
// in hops, and publishes the result as a snapshot file.
//
// The snapshot is a file rather than a stream because this answers a lookup —
// "how far away is this address" — rather than describing an event. It follows
// the same shape as the other collectors' runtime snapshots so the web app
// reads it the way it reads the rest.
package peer

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// maxPlausibleHops bounds what counts as a believable path. Real internet
// routes are well under thirty hops; the value matters only as the cutoff that
// makes the initial-TTL choice below unambiguous.
const maxPlausibleHops = 30

// Standard initial TTLs, in ascending order. Nothing here is statistical: the
// values are 64 and 127 apart, so for any arriving TTL at most one of them is
// within a plausible path length. A Linux client eleven hops out arrives at 53
// (candidates 11, 75, 202) and a Windows client at the same distance arrives at
// 117 (candidates 11, 138). There is no second reading to weigh.
var initialTTLs = []struct {
	Value  uint8
	Family string
}{
	{64, "Linux, macOS or Android"},
	{128, "Windows"},
	{255, "BSD or network equipment"},
}

// Distance is one peer as published.
type Distance struct {
	Address     string `json:"address"`
	TTL         uint8  `json:"ttl"`
	Hops        int    `json:"hops"`
	InitialTTL  uint8  `json:"initial_ttl"`
	Family      string `json:"family"`
	Connections uint64 `json:"connections"`
	LastSeen    string `json:"last_seen"`
}

// Snapshot is the published file.
type Snapshot struct {
	GeneratedAt string     `json:"generated_at"`
	Peers       []Distance `json:"peers"`
}

// Hops reports how far away a sender is, given the TTL that arrived.
//
// It returns false when no standard initial TTL leaves a plausible path, which
// happens for hosts that set an unusual initial value and for middleboxes that
// rewrite TTL on egress. Those are reported as unknown rather than guessed at.
func Hops(ttl uint8) (hops int, initial uint8, family string, ok bool) {
	if ttl == 0 {
		return 0, 0, "", false
	}
	for _, candidate := range initialTTLs {
		if ttl > candidate.Value {
			continue
		}
		distance := int(candidate.Value) - int(ttl)
		if distance < maxPlausibleHops {
			return distance, candidate.Value, candidate.Family, true
		}
	}
	return 0, 0, "", false
}

// Describe builds the published record for one peer.
func Describe(address string, ttl uint8, connections uint64, lastSeen time.Time) Distance {
	hops, initial, family, ok := Hops(ttl)
	if !ok {
		family = "unknown"
		hops = -1
	}
	return Distance{
		Address:     address,
		TTL:         ttl,
		Hops:        hops,
		InitialTTL:  initial,
		Family:      family,
		Connections: connections,
		LastSeen:    lastSeen.UTC().Format(time.RFC3339Nano),
	}
}

// Write publishes the snapshot, nearest peers first.
//
// Written to a neighbouring temporary file and renamed, so a reader never sees
// half a document: the web app polls this path on its own schedule and has no
// way to coordinate with the writer.
func Write(path string, peers []Distance, now time.Time) error {
	if peers == nil {
		// An empty list, never null: the reader should not have to tell "no
		// peers yet" apart from "the field is missing".
		peers = []Distance{}
	}
	sort.Slice(peers, func(i, j int) bool {
		if peers[i].Hops != peers[j].Hops {
			return peers[i].Hops < peers[j].Hops
		}
		return peers[i].Address < peers[j].Address
	})
	document, err := json.Marshal(Snapshot{
		GeneratedAt: now.UTC().Format(time.RFC3339Nano),
		Peers:       peers,
	})
	if err != nil {
		return fmt.Errorf("encode snapshot: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*")
	if err != nil {
		return fmt.Errorf("create temp snapshot: %w", err)
	}
	name := temporary.Name()
	defer os.Remove(name)
	if _, err := temporary.Write(document); err != nil {
		temporary.Close()
		return fmt.Errorf("write temp snapshot: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temp snapshot: %w", err)
	}
	// Readable by the web app, which runs as a different user.
	if err := os.Chmod(name, 0o644); err != nil {
		return fmt.Errorf("chmod temp snapshot: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		return fmt.Errorf("publish snapshot: %w", err)
	}
	return nil
}
