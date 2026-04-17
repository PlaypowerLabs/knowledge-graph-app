#!/usr/bin/env python3
"""Second-pass probe: relationship labels + endpoint label pairs."""
import json
from collections import Counter, defaultdict
from pathlib import Path

RELS = Path(__file__).resolve().parent.parent / "data" / "relationships.jsonl"

label_counts = Counter()
endpoints = defaultdict(Counter)
prop_keys = defaultdict(set)
samples = {}
total = 0

with RELS.open("r", encoding="utf-8") as f:
    for line in f:
        total += 1
        rec = json.loads(line)
        lbl = rec.get("label", "<none>")
        label_counts[lbl] += 1
        sl = tuple(sorted(rec.get("source_labels", []) or []))
        el = tuple(sorted(rec.get("target_labels", []) or []))
        endpoints[lbl][(sl, el)] += 1
        prop_keys[lbl].update((rec.get("properties", {}) or {}).keys())
        if lbl not in samples:
            samples[lbl] = rec

print(f"total relationships: {total:,}\n")
print("relationship label counts:")
for lbl, c in label_counts.most_common():
    print(f"  {lbl:40s} {c:>12,}")

print("\nsource -> target label pairs (top 10 per relationship label):")
for lbl, _ in label_counts.most_common():
    print(f"  [{lbl}]")
    for (sl, el), c in endpoints[lbl].most_common(10):
        print(f"    {'+'.join(sl) or '<none>'} -> {'+'.join(el) or '<none>'}: {c:,}")

print("\nproperty keys per relationship label:")
for lbl, keys in sorted(prop_keys.items(), key=lambda x: -label_counts[x[0]]):
    print(f"  {lbl}: {sorted(keys)}")

print("\nsample per relationship label:")
for lbl, rec in sorted(samples.items(), key=lambda x: -label_counts[x[0]]):
    print(f"--- {lbl} ---")
    print(json.dumps(rec, indent=2)[:1400])
    print()
