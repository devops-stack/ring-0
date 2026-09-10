// Data-bound mechanism drawings used by the central page inspectors.
// Missing telemetry stays visibly unknown; architecture is never filled with
// plausible-looking descriptors or cache hits.
(function initKernelMechanisms() {
    if (window.KernelMechanisms) return;

    const NS = 'http://www.w3.org/2000/svg';
    const EPOLL_CALLS = new Set(['epoll_wait', 'epoll_pwait', 'epoll_pwait2']);
    const VFS_CALLS = new Set([
        'open', 'openat', 'openat2', 'read', 'write', 'pread64', 'pwrite64',
        'readv', 'writev', 'stat', 'fstat', 'newfstatat', 'mmap'
    ]);
    const FUTEX_OPS = {
        0: 'WAIT',
        1: 'WAKE',
        3: 'REQUEUE',
        4: 'CMP_REQUEUE',
        5: 'WAKE_OP',
        6: 'LOCK_PI',
        7: 'UNLOCK_PI',
        9: 'WAIT_BITSET',
        10: 'WAKE_BITSET',
        13: 'LOCK_PI2'
    };

    function textValue(value, fallback = 'UNKNOWN') {
        return value === undefined || value === null || value === '' ? fallback : String(value);
    }

    function clip(value, length) {
        const text = textValue(value);
        return text.length > length ? `${text.slice(0, length - 1)}…` : text;
    }

    function add(parent, tag, attrs, text) {
        const node = document.createElementNS(NS, tag);
        Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
        if (text !== undefined) node.textContent = text;
        parent.appendChild(node);
        return node;
    }

    function shell(label) {
        const section = document.createElement('section');
        section.className = 'kei-mechanism';
        section.setAttribute('aria-label', label);
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 390 190');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', label);
        section.appendChild(svg);
        return { section, svg };
    }

    function eventMask(value) {
        const mask = parseInt(String(value || ''), 16);
        if (!Number.isFinite(mask)) return 'MASK UNKNOWN';
        const labels = [];
        if (mask & 0x001) labels.push('IN');
        if (mask & 0x004) labels.push('OUT');
        if (mask & 0x008) labels.push('ERR');
        if (mask & 0x010) labels.push('HUP');
        if (mask & 0x40000000) labels.push('ONESHOT');
        if (mask & 0x80000000) labels.push('ET');
        return labels.length ? labels.join(' · ') : `0x${value}`;
    }

    function descriptorTarget(descriptor) {
        if (!descriptor) return null;
        return descriptor.remote_address
            || descriptor.local_address
            || descriptor.target
            || null;
    }

    function epollSet(model) {
        const data = model.fdsData || {};
        const sets = Array.isArray(data.epoll_sets) ? data.epoll_sets : [];
        const args = model.syscall && Array.isArray(model.syscall.args)
            ? model.syscall.args
            : [];
        const requested = model.epfd !== undefined ? Number(model.epfd) : Number(args[0]);
        return sets.find(item => Number(item.epfd) === requested) || sets[0] || null;
    }

    function buildEpoll(model) {
        const { section, svg } = shell(
            'Observed Linux eventpoll object and its registered file descriptors'
        );
        const task = model.task || {};
        const call = model.syscall || {};
        const set = epollSet(model);
        const loaded = Boolean(model.fdsData);
        const observable = Boolean(set && set.observable);
        const registrations = observable && Array.isArray(set.registrations)
            ? set.registrations
            : [];
        const args = Array.isArray(call.args) ? call.args : [];
        const epfd = set ? set.epfd : (model.epfd !== undefined ? model.epfd : args[0]);
        const returned = call.ret !== undefined && call.ret !== null ? call.ret : '—';

        add(svg, 'text', { x: 12, y: 15, class: 'kei-mech-copy' }, 'EVENTPOLL · LIVE FDINFO');
        add(svg, 'text', { x: 378, y: 15, class: 'kei-mech-hot', 'text-anchor': 'end' },
            `READY ${returned}`);
        add(svg, 'path', { d: 'M12 23 H378', class: 'kei-mech-rule' });

        add(svg, 'rect', { x: 12, y: 31, width: 112, height: 34, class: 'kei-mech-user' });
        add(svg, 'text', { x: 20, y: 44, class: 'kei-mech-copy' }, 'WAITING TASK');
        add(svg, 'text', { x: 20, y: 57, class: 'kei-mech-value' },
            `${clip(task.comm, 12)} · PID ${textValue(task.pid, '—')}`);
        add(svg, 'path', { d: 'M124 48 H158', class: 'kei-mech-live' });
        add(svg, 'circle', { cx: 141, cy: 48, r: 2, class: 'kei-mech-port' });

        add(svg, 'path', {
            d: 'M158 30 H225 L235 40 V76 H158 Z',
            class: set ? 'kei-mech-amber' : 'kei-mech-unknown'
        });
        add(svg, 'text', { x: 168, y: 45, class: 'kei-mech-copy' }, 'STRUCT EVENTPOLL');
        add(svg, 'text', { x: 168, y: 61, class: set ? 'kei-mech-hot' : 'kei-mech-unknown-copy' },
            epfd !== undefined && epfd !== null ? `EPFD ${epfd}` : 'EPFD UNKNOWN');
        add(svg, 'text', { x: 168, y: 71, class: 'kei-mech-copy' },
            args[2] !== undefined ? `MAXEVENTS ${args[2]}` : '/PROC FDINFO');

        add(svg, 'text', { x: 378, y: 36, class: 'kei-mech-copy', 'text-anchor': 'end' },
            'REGISTERED TARGET FDS');
        const shown = registrations.slice(0, 5);
        if (shown.length) {
            shown.forEach((registration, index) => {
                const y = 48 + index * 25;
                const target = descriptorTarget(registration);
                add(svg, 'path', {
                    d: `M235 54 C263 54 251 ${y + 6} 276 ${y + 6}`,
                    class: 'kei-mech-live'
                });
                add(svg, 'path', {
                    d: `M276 ${y - 4} H372 L378 ${y + 2} V${y + 17} H276 Z`,
                    class: 'kei-mech-block'
                });
                add(svg, 'text', { x: 283, y: y + 7, class: 'kei-mech-hot' },
                    `TFD ${registration.fd} · ${clip(registration.type || 'fd', 10)}`);
                add(svg, 'text', { x: 283, y: y + 16, class: 'kei-mech-copy' },
                    `${eventMask(registration.events)} · ${clip(target, 25)}`);
            });
            if (registrations.length > shown.length) {
                add(svg, 'text', { x: 378, y: 181, class: 'kei-mech-copy', 'text-anchor': 'end' },
                    `+${registrations.length - shown.length} MORE REGISTERED`);
            }
        } else {
            const stateClass = loaded && observable ? 'kei-mech-absent' : 'kei-mech-unknown';
            add(svg, 'path', {
                d: 'M276 61 H372 L378 67 V94 H276 Z',
                class: stateClass
            });
            add(svg, 'text', {
                x: 327, y: 75, class: loaded && observable ? 'kei-mech-copy' : 'kei-mech-unknown-copy',
                'text-anchor': 'middle'
            }, loaded && observable ? 'EMPTY WATCH SET' : 'MEMBERSHIP NOT OBSERVED');
            add(svg, 'text', { x: 327, y: 87, class: 'kei-mech-copy', 'text-anchor': 'middle' },
                loaded ? '/PROC FDINFO UNREADABLE' : 'READING /PROC…');
            add(svg, 'path', { d: 'M235 54 C263 54 251 77 276 77', class: stateClass });
        }

        add(svg, 'path', { d: 'M12 157 H378', class: 'kei-mech-boundary' });
        add(svg, 'text', { x: 12, y: 172, class: 'kei-mech-copy' },
            'READY LIST IS KERNEL-OWNED · REGISTRATION COMES FROM /PROC/PID/FDINFO');
        add(svg, 'text', { x: 12, y: 184, class: 'kei-mech-copy' },
            observable ? `${registrations.length} TARGET${registrations.length === 1 ? '' : 'S'} OBSERVED`
                : 'UNKNOWN IS NOT PRESENTED AS AN EMPTY SET');
        return section;
    }

    function mntNamespace(fdsData) {
        const fingerprint = fdsData && fdsData.namespace_fingerprint;
        const namespaces = fingerprint && Array.isArray(fingerprint.namespaces)
            ? fingerprint.namespaces
            : [];
        return namespaces.find(item => item.id === 'mnt') || null;
    }

    function vfsDescriptor(model) {
        if (model.vfsDescriptor) return model.vfsDescriptor;
        const data = model.fdsData || {};
        const descriptors = Array.isArray(data.descriptors) ? data.descriptors : [];
        const resource = model.resource || {};
        if (resource.fd !== undefined && resource.fd !== null) {
            const byFd = descriptors.find(item => Number(item.fd) === Number(resource.fd));
            if (byFd) return byFd;
        }
        if (resource.target) {
            return descriptors.find(item => item.target === resource.target) || null;
        }
        return null;
    }

    function buildVfs(model) {
        const { section, svg } = shell(
            'Observed VFS path resolution separated from unobserved page-cache and block-I/O attribution'
        );
        const task = model.task || {};
        const call = model.syscall || {};
        const descriptor = vfsDescriptor(model);
        const target = (model.resource || {}).target || descriptorTarget(descriptor);
        const vfs = (descriptor && descriptor.vfs) || model.vfs || {};
        const mnt = mntNamespace(model.fdsData);
        const absolute = typeof target === 'string' && target.startsWith('/');
        const parts = absolute ? target.split('/').filter(Boolean) : [];
        const dentry = parts.length ? parts[parts.length - 1] : null;

        add(svg, 'text', { x: 12, y: 15, class: 'kei-mech-copy' }, 'VFS · OBSERVED FILE CONTEXT');
        add(svg, 'text', { x: 378, y: 15, class: 'kei-mech-hot', 'text-anchor': 'end' },
            `${textValue(call.name, 'FILE')}()`);
        add(svg, 'path', { d: 'M12 23 H378', class: 'kei-mech-rule' });
        add(svg, 'text', { x: 12, y: 36, class: 'kei-mech-copy' }, '01 · PATH RESOLUTION');

        const nodes = [
            { label: 'TASK', value: task.pid ? `${clip(task.comm, 8)}:${task.pid}` : null },
            { label: 'MNT NS', value: mnt && mnt.inode ? mnt.inode : null },
            { label: 'MOUNT', value: vfs.mount_id !== undefined ? `ID ${vfs.mount_id}` : null },
            { label: 'DENTRY', value: dentry },
            { label: 'INODE', value: vfs.inode }
        ];
        nodes.forEach((node, index) => {
            const x = 12 + index * 75;
            const known = node.value !== undefined && node.value !== null && node.value !== '';
            add(svg, 'path', {
                d: `M${x} 44 H${x + 62} L${x + 68} 50 V79 H${x} Z`,
                class: known ? (index === 4 ? 'kei-mech-amber' : 'kei-mech-block') : 'kei-mech-unknown'
            });
            add(svg, 'text', { x: x + 7, y: 57, class: 'kei-mech-copy' }, node.label);
            add(svg, 'text', {
                x: x + 7, y: 71, class: known ? (index === 4 ? 'kei-mech-hot' : 'kei-mech-value') : 'kei-mech-unknown-copy'
            }, clip(node.value, 10));
            if (index < nodes.length - 1) {
                add(svg, 'path', {
                    d: `M${x + 68} 62 H${x + 75}`,
                    class: known && nodes[index + 1].value ? 'kei-mech-live' : 'kei-mech-unknown'
                });
            }
        });

        add(svg, 'text', { x: 12, y: 94, class: absolute ? 'kei-mech-value' : 'kei-mech-unknown-copy' },
            absolute ? clip(target, 66) : 'PATH STRING NOT CAPTURED FOR THIS EVENT');
        add(svg, 'path', { d: 'M12 104 H378', class: 'kei-mech-rule' });
        add(svg, 'text', { x: 12, y: 117, class: 'kei-mech-copy' }, '02 · DATA ACCESS · SEPARATE PHASE');

        const dataNodes = [
            { x: 46, label: 'INODE', value: vfs.inode, known: vfs.inode !== undefined },
            { x: 154, label: 'PAGE CACHE', value: 'HIT/MISS UNKNOWN', known: false },
            { x: 282, label: 'BLOCK I/O', value: 'NOT ATTRIBUTED', known: false }
        ];
        dataNodes.forEach((node, index) => {
            add(svg, 'path', {
                d: `M${node.x} 126 H${node.x + 78} L${node.x + 84} 132 V160 H${node.x} Z`,
                class: node.known ? 'kei-mech-amber' : 'kei-mech-unknown'
            });
            add(svg, 'text', { x: node.x + 8, y: 140, class: 'kei-mech-copy' }, node.label);
            add(svg, 'text', {
                x: node.x + 8, y: 153, class: node.known ? 'kei-mech-hot' : 'kei-mech-unknown-copy'
            }, clip(node.value, 20));
            if (index < dataNodes.length - 1) {
                add(svg, 'path', {
                    d: `M${node.x + 84} 143 H${dataNodes[index + 1].x}`,
                    class: 'kei-mech-unknown'
                });
            }
        });
        add(svg, 'text', { x: 12, y: 181, class: 'kei-mech-copy' },
            vfs.device ? `DEVICE ${vfs.device} · FILE IDENTITY OBSERVED` : 'CACHE AND DISK REQUIRE FILEMAP/BLOCK TRACEPOINTS');
        return section;
    }

    function buildPageFault(model) {
        const { section, svg } = shell(
            'Observed process page-fault counters over an architectural MMU path whose address and page-table walk are not captured'
        );
        const task = model.task || {};
        const faults = model.faults || {};
        const minorKnown = faults.minflt !== undefined && faults.minflt !== null;
        const majorKnown = faults.majflt !== undefined && faults.majflt !== null;
        const count = (value) => {
            const number = Number(value);
            return Number.isFinite(number) ? number.toLocaleString('en-US') : 'UNKNOWN';
        };
        const rate = (value) => {
            const number = Number(value);
            if (!Number.isFinite(number)) return 'RATE ARMING';
            if (number >= 1000) return `${(number / 1000).toFixed(1)}k/s`;
            return `${number >= 10 ? Math.round(number) : number.toFixed(1)}/s`;
        };

        add(svg, 'text', { x: 12, y: 15, class: 'kei-mech-copy' }, 'MMU · PAGE FAULT COUNTERS');
        add(svg, 'text', { x: 378, y: 15, class: 'kei-mech-hot', 'text-anchor': 'end' },
            `MAJOR ${rate(faults.majflt_per_sec)}`);
        add(svg, 'path', { d: 'M12 23 H378', class: 'kei-mech-rule' });

        const walk = [
            { x: 12, w: 82, label: 'TASK', value: task.pid ? `${clip(task.comm, 7)}:${task.pid}` : null, known: Boolean(task.pid) },
            { x: 106, w: 76, label: 'VIRTUAL', value: 'ADDR UNKNOWN', known: false },
            { x: 194, w: 72, label: 'TLB', value: 'RESULT UNKNOWN', known: false },
            { x: 278, w: 100, label: 'PAGE TABLE', value: 'PTE UNKNOWN', known: false }
        ];
        walk.forEach((node, index) => {
            add(svg, 'path', {
                d: `M${node.x} 34 H${node.x + node.w - 6} L${node.x + node.w} 40 V70 H${node.x} Z`,
                class: node.known ? 'kei-mech-amber' : 'kei-mech-unknown'
            });
            add(svg, 'text', { x: node.x + 7, y: 48, class: 'kei-mech-copy' }, node.label);
            add(svg, 'text', {
                x: node.x + 7, y: 62,
                class: node.known ? 'kei-mech-hot' : 'kei-mech-unknown-copy'
            }, clip(node.value, 16));
            if (index < walk.length - 1) {
                add(svg, 'path', {
                    d: `M${node.x + node.w} 52 H${walk[index + 1].x}`,
                    class: 'kei-mech-unknown'
                });
            }
        });

        add(svg, 'path', { d: 'M328 70 V85 H244', class: 'kei-mech-unknown' });
        add(svg, 'path', {
            d: 'M139 84 H244 L252 92 V119 H139 Z',
            class: 'kei-mech-block'
        });
        add(svg, 'text', { x: 149, y: 99, class: 'kei-mech-copy' }, 'HANDLE_MM_FAULT()');
        add(svg, 'text', { x: 149, y: 112, class: 'kei-mech-unknown-copy' },
            'NO PER-EVENT TRACE');

        add(svg, 'path', { d: 'M195 119 V132 H92 V140 M195 132 H298 V140', class: 'kei-mech-unknown' });
        const outcomes = [
            {
                x: 12, label: 'MINOR · NO STORAGE I/O',
                value: `${count(faults.minflt)} TOTAL · ${rate(faults.minflt_per_sec)}`,
                known: minorKnown
            },
            {
                x: 207, label: 'MAJOR · STORAGE REQUIRED',
                value: `${count(faults.majflt)} TOTAL · ${rate(faults.majflt_per_sec)}`,
                known: majorKnown
            }
        ];
        outcomes.forEach((node) => {
            add(svg, 'path', {
                d: `M${node.x} 140 H${node.x + 165} L${node.x + 171} 146 V174 H${node.x} Z`,
                class: node.known ? 'kei-mech-amber' : 'kei-mech-unknown'
            });
            add(svg, 'text', { x: node.x + 8, y: 154, class: 'kei-mech-copy' }, node.label);
            add(svg, 'text', {
                x: node.x + 8, y: 168,
                class: node.known ? 'kei-mech-hot' : 'kei-mech-unknown-copy'
            }, node.value);
        });
        add(svg, 'text', { x: 12, y: 186, class: 'kei-mech-copy' },
            '/PROC/PID/STAT IS CUMULATIVE · ADDRESS, TLB AND PTE REQUIRE A FAULT TRACEPOINT');
        return section;
    }

    function futexOperation(model, waiting) {
        if (waiting && waiting.op && waiting.op.name) return waiting.op.name.replace(/^FUTEX_/, '');
        const args = model.syscall && Array.isArray(model.syscall.args) ? model.syscall.args : [];
        const raw = Number(args[1]);
        if (!Number.isFinite(raw)) return 'OP UNKNOWN';
        const command = raw & ~(128 | 256);
        return FUTEX_OPS[command] || `OP ${command}`;
    }

    function buildFutex(model) {
        const { section, svg } = shell(
            'Observed futex word, operation and waiters with the userspace owner explicitly left unknown'
        );
        const task = model.task || {};
        const waiting = model.waitingOn || {};
        const args = model.syscall && Array.isArray(model.syscall.args) ? model.syscall.args : [];
        const word = waiting.word
            || ((model.resource || {}).target && String((model.resource || {}).target).replace(/^uaddr\s+/, ''))
            || (args[0] !== undefined ? `0x${Number(args[0]).toString(16)}` : null);
        const expected = waiting.expected !== undefined && waiting.expected !== null
            ? waiting.expected
            : args[2];
        const operation = futexOperation(model, waiting);
        const waiters = Array.isArray(waiting.waiters) ? waiting.waiters : [];
        const waiterCount = waiting.waiter_count !== undefined ? waiting.waiter_count : waiters.length;
        const seen = model.seenWaking || {};
        const wakers = Array.isArray(seen.wakers) ? seen.wakers : [];
        const eventWakeup = model.wakeup && model.wakeup !== 'N/A' ? String(model.wakeup) : null;
        const firstWaker = wakers[0] && wakers[0].waker;
        const wakerLabel = firstWaker
            ? `${clip(firstWaker.comm, 9)}:${firstWaker.tid || firstWaker.pid}`
            : eventWakeup;

        add(svg, 'text', { x: 12, y: 15, class: 'kei-mech-copy' }, 'FUTEX · CONTENDED SLOW PATH');
        add(svg, 'text', { x: 378, y: 15, class: 'kei-mech-hot', 'text-anchor': 'end' },
            operation);
        add(svg, 'path', { d: 'M12 23 H378', class: 'kei-mech-rule' });

        const top = [
            { x: 12, w: 92, label: 'THREAD', value: task.pid ? `${clip(task.comm, 8)}:${task.tid || task.pid}` : null, known: Boolean(task.pid) },
            { x: 119, w: 116, label: 'USERSPACE WORD', value: word, known: Boolean(word) },
            { x: 250, w: 128, label: 'LOCK OWNER', value: 'NOT RECORDED', known: false }
        ];
        top.forEach((node, index) => {
            add(svg, 'path', {
                d: `M${node.x} 34 H${node.x + node.w - 6} L${node.x + node.w} 40 V70 H${node.x} Z`,
                class: node.known ? 'kei-mech-amber' : 'kei-mech-unknown'
            });
            add(svg, 'text', { x: node.x + 7, y: 48, class: 'kei-mech-copy' }, node.label);
            add(svg, 'text', {
                x: node.x + 7, y: 62,
                class: node.known ? 'kei-mech-hot' : 'kei-mech-unknown-copy'
            }, clip(node.value, 18));
            if (index < top.length - 1) {
                add(svg, 'path', {
                    d: `M${node.x + node.w} 52 H${top[index + 1].x}`,
                    class: index === 0 && node.known ? 'kei-mech-live' : 'kei-mech-unknown'
                });
            }
        });

        add(svg, 'path', { d: 'M12 83 H378', class: 'kei-mech-boundary' });
        add(svg, 'text', { x: 12, y: 94, class: 'kei-mech-copy' }, 'USERSPACE');
        add(svg, 'text', { x: 378, y: 94, class: 'kei-mech-copy', 'text-anchor': 'end' }, 'KERNEL WAIT PATH');

        add(svg, 'path', {
            d: 'M12 102 H117 L125 110 V136 H12 Z',
            class: word ? 'kei-mech-amber' : 'kei-mech-unknown'
        });
        add(svg, 'text', { x: 20, y: 116, class: 'kei-mech-copy' }, 'FUTEX SYSCALL');
        add(svg, 'text', { x: 20, y: 129, class: word ? 'kei-mech-hot' : 'kei-mech-unknown-copy' },
            expected !== undefined ? `${operation} · EXPECT ${expected}` : operation);

        add(svg, 'path', { d: 'M125 119 H145', class: 'kei-mech-live' });
        add(svg, 'path', {
            d: 'M145 102 H247 L255 110 V136 H145 Z',
            class: waiters.length || waiterCount ? 'kei-mech-block' : 'kei-mech-unknown'
        });
        add(svg, 'text', { x: 153, y: 116, class: 'kei-mech-copy' }, 'KERNEL WAIT QUEUE');
        add(svg, 'text', {
            x: 153, y: 129,
            class: waiters.length || waiterCount ? 'kei-mech-value' : 'kei-mech-unknown-copy'
        }, waiting.kind === 'futex' ? `${waiterCount} WAITER${Number(waiterCount) === 1 ? '' : 'S'}` : 'MEMBERSHIP UNKNOWN');

        add(svg, 'path', { d: 'M255 119 H275', class: wakerLabel ? 'kei-mech-live' : 'kei-mech-unknown' });
        add(svg, 'path', {
            d: 'M275 102 H370 L378 110 V136 H275 Z',
            class: wakerLabel ? 'kei-mech-amber' : 'kei-mech-unknown'
        });
        add(svg, 'text', { x: 283, y: 116, class: 'kei-mech-copy' }, 'SEEN WAKER');
        add(svg, 'text', {
            x: 283, y: 129,
            class: wakerLabel ? 'kei-mech-hot' : 'kei-mech-unknown-copy'
        }, clip(wakerLabel, 15));

        const shown = waiters.slice(0, 4);
        add(svg, 'text', { x: 12, y: 153, class: 'kei-mech-copy' },
            shown.length ? 'WAITING THREADS' : 'WAITER IDENTITIES NEED THE PARKED-TASK SNAPSHOT');
        shown.forEach((waiter, index) => {
            const x = 12 + index * 91;
            add(svg, 'rect', {
                x, y: 160, width: 82, height: 17,
                class: waiter.self ? 'kei-mech-amber' : 'kei-mech-block'
            });
            add(svg, 'text', {
                x: x + 6, y: 172,
                class: waiter.self ? 'kei-mech-hot' : 'kei-mech-value'
            }, `${waiter.tid} ${clip(waiter.comm, 7)}`);
        });
        add(svg, 'text', { x: 12, y: 188, class: 'kei-mech-copy' },
            'ORDINARY FUTEX OWNERSHIP STAYS IN USERSPACE · WAKEUP IS OBSERVED, NOT INFERRED');
        return section;
    }

    function buildSlub(model) {
        const { section, svg } = shell(
            'Observed SLUB cache occupancy shown as an aggregate object cassette, not an invented physical slab'
        );
        const cache = model.cache || {};
        const active = Number(cache.active_objs);
        const total = Number(cache.num_objs);
        const occupancy = total > 0 ? Math.max(0, Math.min(1, active / total)) : 0;
        const percent = total > 0 ? `${Math.round(occupancy * 100)}%` : 'UNKNOWN';
        const objectSize = Number(cache.object_size);
        const objectsPerSlab = Number(cache.objs_per_slab);
        const pagesPerSlab = Number(cache.pages_per_slab);
        const numSlabs = Number(cache.num_slabs);

        add(svg, 'text', { x: 12, y: 15, class: 'kei-mech-copy' }, 'SLUB · FIXED-SIZE KERNEL OBJECTS');
        add(svg, 'text', { x: 378, y: 15, class: 'kei-mech-hot', 'text-anchor': 'end' },
            `${percent} ACTIVE`);
        add(svg, 'path', { d: 'M12 23 H378', class: 'kei-mech-rule' });

        // A cache is drawn as a tabbed index folder: the name chooses the
        // object constructor and size before SLUB chooses storage.
        add(svg, 'path', {
            d: 'M12 39 H45 L52 33 H137 L145 41 V76 H12 Z',
            class: cache.name ? 'kei-mech-amber' : 'kei-mech-unknown'
        });
        add(svg, 'text', { x: 21, y: 53, class: 'kei-mech-copy' }, 'KMEM CACHE');
        add(svg, 'text', {
            x: 21, y: 68, class: cache.name ? 'kei-mech-hot' : 'kei-mech-unknown-copy'
        }, clip(cache.name, 19));

        add(svg, 'path', { d: 'M145 55 H173', class: cache.name ? 'kei-mech-live' : 'kei-mech-unknown' });
        add(svg, 'circle', { cx: 159, cy: 55, r: 3, class: 'kei-mech-port' });

        // The axle through the page plates is architectural; their count is
        // the observed pages_per_slab, capped only for drawing.
        add(svg, 'path', { d: 'M173 34 H253 L261 42 V76 H173 Z', class: 'kei-mech-block' });
        add(svg, 'text', { x: 181, y: 49, class: 'kei-mech-copy' }, 'SLAB PAGES');
        add(svg, 'path', { d: 'M185 62 H248', class: 'kei-mech-live' });
        const plateCount = Number.isFinite(pagesPerSlab) && pagesPerSlab > 0
            ? Math.min(4, pagesPerSlab)
            : 0;
        for (let index = 0; index < 4; index += 1) {
            const px = 188 + index * 18;
            add(svg, 'path', {
                d: `M${px} 55 L${px + 7} 62 L${px} 69 L${px - 7} 62 Z`,
                class: index < plateCount ? 'kei-mech-amber' : 'kei-mech-unknown'
            });
        }
        add(svg, 'text', {
            x: 253, y: 72, class: plateCount ? 'kei-mech-value' : 'kei-mech-unknown-copy',
            'text-anchor': 'end'
        }, Number.isFinite(pagesPerSlab) ? `${pagesPerSlab} PAGE${pagesPerSlab === 1 ? '' : 'S'}` : 'UNKNOWN');

        add(svg, 'path', { d: 'M261 55 H283', class: 'kei-mech-live' });
        add(svg, 'path', { d: 'M283 34 H370 L378 42 V76 H283 Z', class: 'kei-mech-block' });
        add(svg, 'text', { x: 291, y: 49, class: 'kei-mech-copy' }, 'OBJECT SIZE');
        add(svg, 'text', {
            x: 291, y: 65, class: Number.isFinite(objectSize) ? 'kei-mech-value' : 'kei-mech-unknown-copy'
        }, Number.isFinite(objectSize) ? `${objectSize.toLocaleString()} BYTES` : 'UNKNOWN');

        add(svg, 'path', { d: 'M12 88 H378', class: 'kei-mech-boundary' });
        add(svg, 'text', { x: 12, y: 101, class: 'kei-mech-copy' }, 'AGGREGATE CACHE OCCUPANCY');
        add(svg, 'text', { x: 378, y: 101, class: 'kei-mech-copy', 'text-anchor': 'end' },
            Number.isFinite(numSlabs) ? `${numSlabs.toLocaleString()} SLABS` : 'SLAB COUNT UNKNOWN');

        const cols = 16;
        const rows = 3;
        const cellW = 19;
        const cellH = 15;
        const startX = 12;
        const startY = 111;
        const activeCells = Math.round(occupancy * cols * rows);
        for (let index = 0; index < cols * rows; index += 1) {
            const x = startX + (index % cols) * 23;
            const y = startY + Math.floor(index / cols) * 20;
            add(svg, 'rect', {
                x, y, width: cellW, height: cellH, rx: 1,
                class: index < activeCells ? 'kei-mech-amber' : 'kei-mech-absent'
            });
            if (index < activeCells) {
                add(svg, 'circle', { cx: x + cellW / 2, cy: y + cellH / 2, r: 1.4, class: 'kei-mech-port' });
            }
        }

        add(svg, 'text', { x: 12, y: 179, class: 'kei-mech-copy' },
            `${Number.isFinite(active) ? active.toLocaleString() : 'UNKNOWN'} ACTIVE / ${Number.isFinite(total) ? total.toLocaleString() : 'UNKNOWN'} CAPACITY`);
        add(svg, 'text', { x: 378, y: 179, class: 'kei-mech-hot', 'text-anchor': 'end' },
            Number.isFinite(objectsPerSlab) ? `${objectsPerSlab} OBJECTS / SLAB` : 'CAPACITY UNKNOWN');
        add(svg, 'text', { x: 12, y: 188, class: 'kei-mech-copy' },
            'CASSETTE IS THE CACHE-WIDE RATIO · PER-SLAB PLACEMENT AND OWNERS ARE NOT EXPORTED');
        return section;
    }

    function buildRcu(model) {
        const { section, svg } = shell(
            'Observed RCU softirq work over an architectural grace-period path whose current readers and callback queue are not exported'
        );
        const rcu = model.rcu || {};
        const total = Number(rcu.total);
        const perSec = Number(rcu.per_sec);
        const cpuCount = Number(model.cpuCount);
        const totalText = Number.isFinite(total) ? total.toLocaleString('en-US') : 'UNKNOWN';
        const rateText = Number.isFinite(perSec) ? `${perSec.toFixed(perSec >= 10 ? 0 : 1)}/s` : 'RATE UNKNOWN';

        add(svg, 'text', { x: 12, y: 15, class: 'kei-mech-copy' }, 'RCU · READ-COPY-UPDATE');
        add(svg, 'text', { x: 378, y: 15, class: 'kei-mech-hot', 'text-anchor': 'end' },
            `${rateText} · ${textValue(rcu.symbol, 'RCU_CORE')}`);
        add(svg, 'path', { d: 'M12 23 H378', class: 'kei-mech-rule' });

        add(svg, 'path', { d: 'M12 34 H103 L111 42 V70 H12 Z', class: 'kei-mech-block' });
        add(svg, 'text', { x: 20, y: 49, class: 'kei-mech-copy' }, 'UPDATER');
        add(svg, 'text', { x: 20, y: 62, class: 'kei-mech-value' }, 'PUBLISH NEW PTR');
        add(svg, 'path', { d: 'M111 52 H137', class: 'kei-mech-live' });

        add(svg, 'path', { d: 'M137 34 H249 L257 42 V70 H137 Z', class: 'kei-mech-amber' });
        add(svg, 'text', { x: 145, y: 49, class: 'kei-mech-copy' }, 'READERS');
        add(svg, 'text', { x: 145, y: 62, class: 'kei-mech-hot' },
            Number.isFinite(cpuCount) ? `${cpuCount} CPU CONTEXTS` : 'CPU COUNT UNKNOWN');
        add(svg, 'path', { d: 'M257 52 H283', class: 'kei-mech-unknown' });

        add(svg, 'path', { d: 'M283 34 H370 L378 42 V70 H283 Z', class: 'kei-mech-unknown' });
        add(svg, 'text', { x: 291, y: 49, class: 'kei-mech-copy' }, 'QUIESCENT');
        add(svg, 'text', { x: 291, y: 62, class: 'kei-mech-unknown-copy' }, 'CPU MASK UNKNOWN');

        add(svg, 'path', { d: 'M12 84 H378', class: 'kei-mech-boundary' });
        add(svg, 'text', { x: 12, y: 96, class: 'kei-mech-copy' }, 'GRACE PERIOD CONTROL');
        add(svg, 'text', { x: 378, y: 96, class: 'kei-mech-unknown-copy', 'text-anchor': 'end' },
            'CURRENT GP NOT EXPORTED');

        const stages = [
            { x: 12, w: 105, label: 'OLD OBJECT', value: 'CALL_RCU()', known: true },
            { x: 143, w: 105, label: 'GP DETECTOR', value: 'STATE UNKNOWN', known: false },
            { x: 273, w: 105, label: 'CALLBACKS', value: 'DEPTH UNKNOWN', known: false }
        ];
        stages.forEach((node, index) => {
            add(svg, 'path', {
                d: `M${node.x} 104 H${node.x + node.w - 7} L${node.x + node.w} 111 V139 H${node.x} Z`,
                class: node.known ? 'kei-mech-block' : 'kei-mech-unknown'
            });
            add(svg, 'text', { x: node.x + 8, y: 119, class: 'kei-mech-copy' }, node.label);
            add(svg, 'text', {
                x: node.x + 8, y: 132,
                class: node.known ? 'kei-mech-value' : 'kei-mech-unknown-copy'
            }, node.value);
            if (index < stages.length - 1) {
                add(svg, 'path', {
                    d: `M${node.x + node.w} 121 H${stages[index + 1].x}`,
                    class: 'kei-mech-unknown'
                });
            }
        });

        add(svg, 'path', { d: 'M12 153 H378', class: 'kei-mech-rule' });
        add(svg, 'text', { x: 12, y: 167, class: 'kei-mech-copy' }, 'OBSERVED RCU SOFTIRQ EXECUTIONS');
        add(svg, 'text', { x: 378, y: 167, class: 'kei-mech-hot', 'text-anchor': 'end' },
            `${totalText} TOTAL · ${rateText}`);
        add(svg, 'text', { x: 12, y: 184, class: 'kei-mech-copy' },
            'ACTIVITY IS REAL · A SOFTIRQ IS NOT PROOF THAT ONE GRACE PERIOD COMPLETED');
        return section;
    }

    function kindFor(model) {
        if (model && model.mechanism === 'epoll') return 'epoll';
        if (model && model.mechanism === 'vfs') return 'vfs';
        if (model && model.mechanism === 'page-fault') return 'page-fault';
        if (model && model.mechanism === 'futex') return 'futex';
        if (model && model.mechanism === 'slub') return 'slub';
        if (model && model.mechanism === 'rcu') return 'rcu';
        const name = String(model && model.syscall && model.syscall.name || '').toLowerCase();
        if (name === 'futex') return 'futex';
        if (EPOLL_CALLS.has(name)) return 'epoll';
        if (VFS_CALLS.has(name)) {
            const target = model && model.resource && model.resource.target;
            if (name.startsWith('open') || (typeof target === 'string' && target.startsWith('/'))) {
                return 'vfs';
            }
        }
        return null;
    }

    function build(model) {
        const kind = kindFor(model);
        if (kind === 'epoll') return buildEpoll(model);
        if (kind === 'vfs') return buildVfs(model);
        if (kind === 'page-fault') return buildPageFault(model);
        if (kind === 'futex') return buildFutex(model);
        if (kind === 'slub') return buildSlub(model);
        if (kind === 'rcu') return buildRcu(model);
        return null;
    }

    window.KernelMechanisms = { build, kindFor };
})();
