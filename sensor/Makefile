.PHONY: generate test build install

BINARY := build/kernel-ai-sensor
INSTALL_PATH ?= /opt/ring0/kernel-ai/bin/kernel-ai-sensor

generate:
	go generate ./internal/bpf

test:
	go test ./...
	go vet ./...

build:
	mkdir -p build
	CGO_ENABLED=0 go build -trimpath -o $(BINARY) ./cmd/kernel-ai-sensor

install: build
	install -D -m 0755 $(BINARY) $(INSTALL_PATH)
