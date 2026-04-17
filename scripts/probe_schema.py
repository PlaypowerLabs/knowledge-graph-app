#!/usr/bin/env python3
"""Probe nodes.jsonl and relationships.jsonl to summarize the KG schema.

Outputs:
  - node label counts (single-label buckets; multi-label combos tracked separately)
  - relationship type counts
  - one sample record per label / type
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
NODES = DATA_DIR / "nodes.jsonl"
RELS = DATA_DIR / "relationships.jsonl"


def probe_nodes(path: Path):
    label_counts = Counter()
    label_combo_counts = Counter()
    samples = {}
    prop_keys = defaultdict(set)
    total = 0
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            total += 1
            rec = json.loads(line)
            labels = rec.get("labels", []) or ["<none>"]
            label_combo_counts[tuple(sorted(labels))] += 1
            for lbl in labels:
                label_counts[lbl] += 1
                if lbl not in samples:
                    samples[lbl] = rec
                props = rec.get("properties", {}) or {}
                prop_keys[lbl].update(props.keys())
    return total, label_counts, label_combo_counts, samples, prop_keys


def probe_rels(path: Path):
    type_counts = Counter()
    samples = {}
    endpoints = defaultdict(Counter)  # rel_type -> Counter[(start_label, end_label)]
    total = 0
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            total += 1
            rec = json.loads(line)
            t = rec.get("type", "<none>")
            type_counts[t] += 1
            if t not in samples:
                samples[t] = rec
            sl = tuple(sorted(rec.get("start", {}).get("labels", []) or []))
            el = tuple(sorted(rec.get("end", {}).get("labels", []) or []))
            endpoints[t][(sl, el)] += 1
    return total, type_counts, samples, endpoints


def main():
    if not NODES.exists() or not RELS.exists():
        print(f"missing data files in {DATA_DIR}", file=sys.stderr)
        sys.exit(1)

    print("=== NODES ===")
    n_total, n_counts, n_combos, n_samples, n_props = probe_nodes(NODES)
    print(f"total nodes: {n_total:,}\n")
    print("label counts:")
    for lbl, c in n_counts.most_common():
        print(f"  {lbl:40s} {c:>12,}")
    print("\nlabel combinations (top 15):")
    for combo, c in n_combos.most_common(15):
        print(f"  {'+'.join(combo):60s} {c:>12,}")
    print("\nproperty keys per label:")
    for lbl, keys in sorted(n_props.items(), key=lambda x: -n_counts[x[0]]):
        print(f"  {lbl}: {sorted(keys)}")
    print("\nsample per label:")
    for lbl, rec in sorted(n_samples.items(), key=lambda x: -n_counts[x[0]]):
        print(f"--- {lbl} ---")
        print(json.dumps(rec, indent=2)[:1200])
        print()

    print("\n=== RELATIONSHIPS ===")
    r_total, r_counts, r_samples, r_endpoints = probe_rels(RELS)
    print(f"total relationships: {r_total:,}\n")
    print("type counts:")
    for t, c in r_counts.most_common():
        print(f"  {t:40s} {c:>12,}")
    print("\nendpoint label pairs per type (top 5 per type):")
    for t, _ in r_counts.most_common():
        print(f"  [{t}]")
        for (sl, el), c in r_endpoints[t].most_common(5):
            print(f"    {'+'.join(sl) or '<none>'} -> {'+'.join(el) or '<none>'}: {c:,}")
    print("\nsample per type:")
    for t, rec in sorted(r_samples.items(), key=lambda x: -r_counts[x[0]]):
        print(f"--- {t} ---")
        print(json.dumps(rec, indent=2)[:1200])
        print()


if __name__ == "__main__":
    main()
