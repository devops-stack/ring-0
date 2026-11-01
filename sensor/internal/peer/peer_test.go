package peer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHopsPicksTheOnlyPlausibleInitialTTL(t *testing.T) {
	cases := []struct {
		ttl     uint8
		hops    int
		initial uint8
	}{
		{64, 0, 64},    // same machine, nothing in between
		{63, 1, 64},    // one router away
		{53, 11, 64},   // the measured distance to a real visitor
		{117, 11, 128}, // the same distance, from a Windows client
		{128, 0, 128},
		{255, 0, 255},
		{250, 5, 255},
	}
	for _, want := range cases {
		hops, initial, family, ok := Hops(want.ttl)
		if !ok {
			t.Fatalf("ttl %d: no plausible initial TTL", want.ttl)
		}
		if hops != want.hops || initial != want.initial {
			t.Errorf("ttl %d: got %d hops from initial %d, want %d from %d",
				want.ttl, hops, initial, want.hops, want.initial)
		}
		if family == "" {
			t.Errorf("ttl %d: no family named", want.ttl)
		}
	}
}

// The whole approach rests on there being exactly one candidate, so assert it
// directly rather than trusting the table above to have covered it.
func TestEveryArrivingTTLHasAtMostOneCandidate(t *testing.T) {
	for ttl := 1; ttl <= 255; ttl++ {
		candidates := 0
		for _, initial := range initialTTLs {
			if uint8(ttl) > initial.Value {
				continue
			}
			if int(initial.Value)-ttl < maxPlausibleHops {
				candidates++
			}
		}
		if candidates > 1 {
			t.Fatalf("ttl %d has %d plausible initial values, the hop count is not determined", ttl, candidates)
		}
	}
}

func TestUnusualInitialTTLIsReportedUnknownRatherThanGuessed(t *testing.T) {
	// 100 is 28 below none of the standard values: 128-100 is 28, which is
	// inside the plausible range, so pick something that is not.
	if _, _, _, ok := Hops(30); ok {
		t.Error("ttl 30 is 34 hops below 64 and should not be claimed as known")
	}
	if _, _, _, ok := Hops(0); ok {
		t.Error("ttl 0 cannot have arrived and should not be claimed as known")
	}
	described := Describe("203.0.113.9", 30, 2, time.Unix(0, 0))
	if described.Hops != -1 || described.Family != "unknown" {
		t.Errorf("unknown distance should be published as such, got %+v", described)
	}
}

func TestWritePublishesNearestFirstAndIsReadableByOthers(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "peer-distance.json")
	peers := []Distance{
		Describe("203.0.113.9", 53, 4, time.Unix(0, 0)),
		Describe("172.31.16.1", 63, 1, time.Unix(0, 0)),
	}
	if err := Write(path, peers, time.Unix(0, 0)); err != nil {
		t.Fatalf("write: %v", err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(snapshot.Peers) != 2 {
		t.Fatalf("want 2 peers, got %d", len(snapshot.Peers))
	}
	if snapshot.Peers[0].Address != "172.31.16.1" {
		t.Errorf("nearest peer should come first, got %s", snapshot.Peers[0].Address)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o644 {
		t.Errorf("the web app runs as another user and must be able to read this, got mode %v", mode)
	}

	// Nothing but the snapshot may survive, or the runtime directory fills up
	// with temporary files at one per tick.
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("want only the snapshot left behind, got %d entries", len(entries))
	}
}
