"""Compare two offline models on public, reference-labelled speech samples."""
import argparse
import gc
import json
from pathlib import Path
import re
import sys
import unicodedata

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Engine


def words(text):
    text = text.translate(str.maketrans({"ي": "ی", "ك": "ک", "\u200c": " "}))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[^\w\s]", "", text).split()


def distance(left, right):
    row = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        next_row = [i]
        for j, b in enumerate(right, 1):
            next_row.append(min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (a != b)))
        row = next_row
    return row[-1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("samples", type=Path, help="JSON array with file/reference fields")
    parser.add_argument("--baseline", type=Path, required=True, help="Local CTranslate2 baseline model")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    from faster_whisper.audio import decode_audio
    import numpy as np

    samples = json.loads(args.samples.read_text())
    results = {"note": "Small public smoke sample; not a general Persian accuracy benchmark.", "samples": samples, "models": {}}
    root = Path(__file__).resolve().parents[1]
    paths = {
        "baseline": args.baseline,
        "large-v3-turbo": root / "models/large-v3-turbo",
    }
    for name, path in paths.items():
        engine = Engine(path, 4)
        engine.load()
        assert engine.model is not None, engine.error
        records = []
        total_errors = total_words = 0
        for sample in samples:
            audio = decode_audio(sample["file"], sampling_rate=16000)
            raw = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
            result = engine.transcribe(raw, "fa", True)
            reference = words(sample["reference"])
            errors = distance(reference, words(result["text"]))
            total_errors += errors
            total_words += len(reference)
            record = {**result, "audio_seconds": round(len(audio) / 16000, 2), "word_errors": errors,
                      "reference_words": len(reference)}
            records.append(record)
            print(name, json.dumps(record, ensure_ascii=False), flush=True)
        results["models"][name] = {"records": records, "word_errors": total_errors,
                                   "reference_words": total_words, "wer": round(total_errors / total_words, 4)}
        del engine
        gc.collect()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print("Saved", args.output, flush=True)


if __name__ == "__main__":
    main()
