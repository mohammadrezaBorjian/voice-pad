#!/usr/bin/env python3
"""Local, offline Whisper server. Recordings are processed in RAM only."""
import argparse
import json
import logging
import os
from pathlib import Path
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

APP_ID = "voice-pad"
STATIC = Path(__file__).resolve().parent / "static"
DEFAULT_MODEL = Path(__file__).resolve().parent / "models/large-v3-turbo"
SAMPLE_RATE = 16000
MAX_SECONDS = 16
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
    "/audio.mjs": ("audio.mjs", "text/javascript; charset=utf-8"),
    "/recorder.js": ("recorder.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
}
LANGUAGES = {"fa", "en", "auto"}


class Engine:
    def __init__(self, model_path, threads):
        self.model_path = Path(model_path).expanduser().resolve()
        self.threads = threads
        self.model = None
        self.error = None
        self.lock = threading.Lock()
        self.token = secrets.token_urlsafe(32)

    def load(self):
        try:
            for name in ("model.bin", "config.json", "tokenizer.json"):
                if not (self.model_path / name).is_file():
                    raise FileNotFoundError("Missing local model file: " + name)
            from faster_whisper import WhisperModel

            self.model = WhisperModel(
                str(self.model_path), device="cpu", compute_type="int8",
                cpu_threads=self.threads, num_workers=1, local_files_only=True,
            )
            logging.info("Offline Whisper model ready")
        except Exception:
            self.error = "مدل محلی آماده نشد. مسیر مدل و محیط Python را بررسی کنید."
            logging.exception("Cannot load local Whisper")

    def transcribe(self, raw, language, final):
        import numpy as np

        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        started = time.monotonic()
        if float(np.sqrt(np.mean(audio ** 2))) < 0.0001:
            return {"text": "", "language": language, "seconds": 0}
        segments, info = self.model.transcribe(
            audio, language=None if language == "auto" else language,
            task="transcribe", beam_size=5 if final else 1,
            vad_filter=True, vad_parameters={"min_silence_duration_ms": 350,
                                              "speech_pad_ms": 200},
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return {"text": text, "language": info.language,
                "seconds": round(time.monotonic() - started, 2)}


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    server_version = "VoicePad/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, *_args):
        # Do not log recording data or transcribed text.
        pass

    def reply(self, status, data, content_type="application/json; charset=utf-8"):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "microphone=(self)")
        self.send_header("Content-Security-Policy", "default-src 'self'; "
                         "script-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "connect-src 'self'; img-src 'self' data:; "
                         "frame-ancestors 'none'; base-uri 'none'")
        try:
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def valid_host(self):
        port = self.server.server_port
        return self.headers.get("Host") in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def do_GET(self):
        if not self.valid_host():
            return self.reply(403, {"error": "invalid_host"})
        path = urlsplit(self.path).path
        engine = self.server.engine
        if path == "/api/status":
            return self.reply(200, {"app": APP_ID, "ready": engine.model is not None,
                                    "error": engine.error, "token": engine.token,
                                    "model": engine.model_path.name, "device": "cpu"})
        asset = ASSETS.get(path)
        if asset:
            name, mime = asset
            return self.reply(200, (STATIC / name).read_bytes(), mime)
        self.reply(404, {"error": "not_found"})

    def do_POST(self):
        engine = self.server.engine
        port = self.server.server_port
        origin = self.headers.get("Origin")
        allowed_origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
        token = self.headers.get("X-Voice-Token", "")
        if (not self.valid_host() or (origin and origin not in allowed_origins)
                or not secrets.compare_digest(token, engine.token)):
            self.close_connection = True
            return self.reply(403, {"error": "دسترسی مجاز نیست. صفحه را دوباره باز کنید."})
        parsed = urlsplit(self.path)
        if parsed.path != "/api/transcribe":
            return self.reply(404, {"error": "not_found"})
        query = parse_qs(parsed.query)
        language = query.get("language", ["fa"])[0]
        final = query.get("final", ["1"])[0] == "1"
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if (language not in LANGUAGES or length < SAMPLE_RATE // 2
                or length > SAMPLE_RATE * MAX_SECONDS * 2 or length % 2
                or self.headers.get("Content-Type") != "application/octet-stream"):
            self.close_connection = True
            return self.reply(400, {"error": "بستهٔ صدا معتبر نیست."})
        if engine.model is None:
            self.close_connection = True
            return self.reply(503, {"error": engine.error or "مدل در حال آماده‌شدن است."})
        if not engine.lock.acquire(blocking=False):
            self.close_connection = True
            return self.reply(429, {"error": "مدل در حال پردازش است. کمی صبر کنید."})
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                return self.reply(400, {"error": "صدا کامل دریافت نشد."})
            self.reply(200, engine.transcribe(raw, language, final))
        except (TimeoutError, ConnectionError):
            self.close_connection = True
        except Exception:
            logging.exception("Transcription failed")
            self.reply(500, {"error": "تبدیل صدا انجام نشد. دوباره تلاش کنید."})
        finally:
            engine.lock.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOICE_PAD_PORT", 8791)))
    parser.add_argument("--model", default=os.environ.get("VOICE_PAD_MODEL", str(DEFAULT_MODEL)))
    parser.add_argument("--threads", type=int, default=min(4, os.cpu_count() or 2))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = Server(("127.0.0.1", args.port), Handler)
    server.engine = Engine(args.model, args.threads)
    threading.Thread(target=server.engine.load, daemon=True).start()
    logging.info("Voice Pad: http://127.0.0.1:%s", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
