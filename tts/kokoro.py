# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["kokoro-onnx==0.6.1"]
# ///
"""Clausper's Kokoro voice: a local neural text-to-speech runner.

Reads sentences on standard input, one per line, writes one 16-bit mono WAV per
sentence into --out, and prints each file's path on its own line as soon as it
is written, so Clausper can play the first sentence while the next is made.

Runs on this Mac only. It opens the two model files it is given and nothing
else, and makes no network calls. Clausper runs it with `uv run --offline`
from a private temporary folder; the packages are the ones pinned, with hashes,
in kokoro.py.lock beside this file.

    uv run --script kokoro.py --model M --voices V --out DIR [--voice af_heart] [--speed 1.0]
    uv run --script kokoro.py --model M --voices V --list
"""

import argparse
import os
import sys
import wave

# American (a) and British (b) English voices; other prefixes are other languages.
LANGS = {"a": "en-us", "b": "en-gb"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--out")
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--list", action="store_true", help="print the English voice names and exit")
    args = parser.parse_args()

    # Imported here so a bad argument fails fast, before the model loads.
    import numpy as np
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(args.model, args.voices)
    english = sorted(name for name in kokoro.get_voices() if name[:1] in LANGS)

    if args.list:
        print("\n".join(english))
        return 0

    if args.out is None or not os.path.isdir(args.out):
        print("--out must be an existing folder", file=sys.stderr)
        return 2
    if args.voice not in english:
        print(f"unknown voice {args.voice!r}; try one of: {', '.join(english)}", file=sys.stderr)
        return 2
    speed = min(2.0, max(0.5, args.speed))
    lang = LANGS[args.voice[0]]

    index = 0
    for line in sys.stdin:
        sentence = line.strip()
        if sentence == "":
            continue
        index += 1
        samples, rate = kokoro.create(sentence, voice=args.voice, speed=speed, lang=lang)
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        path = os.path.join(args.out, f"{index:03d}.wav")
        with wave.open(path, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes(pcm)
        print(path, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
