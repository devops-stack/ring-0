"""CLI: ``python -m kernel_ai.ml.sequence_deep markov [--synthetic|--corpus PATH]``."""

from __future__ import annotations

import argparse
import json
import logging
import sys

from kernel_ai.ml.config import MLConfig


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Stage 8 deep-sequence training")
    parser.add_argument("backend", choices=("markov", "lstm", "transformer"))
    parser.add_argument("--corpus", type=str, default=None, help="text corpus (one seq/line)")
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="train Markov on built-in normal sequences (local/CI)",
    )
    parser.add_argument(
        "--min-transitions",
        type=int,
        default=50,
        help="refuse to write artifact below this many transitions",
    )
    parser.add_argument("--no-ngrams", action="store_true", help="do not read ml_syscall_ngrams")
    args = parser.parse_args(argv)
    cfg = MLConfig()

    if args.backend != "markov":
        from kernel_ai.ml.sequence_deep.lstm import train_lstm_stub

        try:
            train_lstm_stub(cfg)
        except SystemExit as exc:
            if isinstance(exc.code, str):
                print(exc.code, file=sys.stderr)
                return 2
            raise
        return 0

    from kernel_ai.ml.sequence_deep.train_markov import train_markov

    try:
        metrics = train_markov(
            cfg,
            corpus_path=args.corpus,
            use_ngrams=not args.no_ngrams and not args.synthetic and not args.corpus,
            use_synthetic=bool(args.synthetic),
            min_transitions=args.min_transitions,
        )
    except SystemExit as exc:
        if isinstance(exc.code, str):
            print(exc.code, file=sys.stderr)
            return 2
        raise
    print(json.dumps(metrics, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
