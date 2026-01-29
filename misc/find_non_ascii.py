#!/usr/bin/env python3

# This script is meant for finding non-ascii characters in story exports.
import argparse
import sys
import unicodedata
from collections import defaultdict

def scan_file(path: str):
    data = defaultdict(lambda: {"lines": set(), "count": 0})
    try:
        with open(path, "r", encoding="utf-8", errors="strict") as handle:
            for line_no, line in enumerate(handle, start=1):
                for ch in line:
                    if ord(ch) > 127:
                        entry = data[ch]
                        entry["count"] += 1
                        entry["lines"].add(line_no)
    except FileNotFoundError:
        raise FileNotFoundError(f"File not found: {path}")
    except UnicodeDecodeError as exc:
        raise UnicodeDecodeError(
            exc.encoding,
            exc.object,
            exc.start,
            exc.end,
            f"Invalid UTF-8 data in {path}: {exc.reason}",
        )
    return data

def write_report(data, output_path: str):
    items = sorted(data.items(), key=lambda item: (ord(item[0]), item[0]))
    with open(output_path, "w", encoding="utf-8") as out:
        for ch, info in items:
            lines = sorted(info["lines"])
            name = unicodedata.name(ch, "UNKNOWN")
            lines_str = ", ".join(str(n) for n in lines)
            out.write(
                f"U+{ord(ch):04X} \"{ch}\" {name}: lines {lines_str} "
                f"(occurrences {info['count']}, lines {len(lines)})\n"
            )

def main(argv):
    parser = argparse.ArgumentParser(
        description="Report non-ASCII characters in a text file with their line numbers."
    )
    parser.add_argument("path", help="Path to the text file to scan.")
    parser.add_argument(
        "--output",
        default="/home/bart/ai_rpg/tmp/non_ascii_report.txt",
        help="Output report path.",
    )
    args = parser.parse_args(argv)

    data = scan_file(args.path)
    if not data:
        print("No non-ASCII characters found.")
        return 0

    write_report(data, args.output)
    print(f"Report written to {args.output}")
    print(f"Unique non-ASCII characters: {len(data)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
