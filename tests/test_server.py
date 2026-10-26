import importlib.util
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("voice_server", Path(__file__).parents[1] / "server.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class FakeEngine:
    model = object()
    model_path = Path("test-small")
    error = None
    token = "test-token"

    def __init__(self):
        self.lock = threading.Lock()

    def transcribe(self, raw, language, final):
        return {"text": "سلام", "language": language, "final": final, "bytes": len(raw)}


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.Server(("127.0.0.1", 0), app.Handler)
        cls.server.engine = FakeEngine()
        cls.url = "http://127.0.0.1:" + str(cls.server.server_port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, data=None, headers=None):
        request = urllib.request.Request(self.url + path, data=data, headers=headers or {})
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as response_error:
            response = response_error
        with response:
            return response.status, response.headers, response.read()

    def post(self, body=b"\0" * 16000, **headers):
        return self.request("/api/transcribe?language=fa&final=1", body, {
            "Content-Type": "application/octet-stream", "X-Voice-Token": "test-token", **headers,
        })

    def test_static_assets_and_status(self):
        for path in app.ASSETS:
            code, headers, raw = self.request(path)
            self.assertEqual(code, 200)
            self.assertTrue(raw)
            self.assertEqual(headers["Cache-Control"], "no-store")
        code, _, raw = self.request("/api/status")
        self.assertEqual(json.loads(raw)["app"], "voice-pad")
        self.assertEqual(self.request("/../server.py")[0], 404)

    def test_valid_audio_and_language(self):
        code, _, raw = self.post()
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(raw)["text"], "سلام")
        code, _, raw = self.request("/api/transcribe?language=en&final=0", b"\0" * 16000, {
            "Content-Type": "application/octet-stream", "X-Voice-Token": "test-token",
        })
        self.assertEqual(code, 200)
        self.assertFalse(json.loads(raw)["final"])
        self.assertEqual(json.loads(raw)["language"], "en")

    def test_rejects_foreign_origin_host_and_missing_token(self):
        self.assertEqual(self.post(Origin="https://example.org")[0], 403)
        self.assertEqual(self.post(Host="example.org")[0], 403)
        self.assertEqual(self.request("/api/status", headers={"Host": "example.org"})[0], 403)
        self.assertEqual(self.request("/api/transcribe", b"\0" * 16000)[0], 403)

    def test_audio_size_and_backpressure(self):
        self.assertEqual(self.post(body=b"\0" * 100)[0], 400)
        self.assertEqual(self.post(body=b"\0" * 8001)[0], 400)
        self.assertEqual(self.post(body=b"\0" * (16000 * 17 * 2))[0], 400)
        self.server.engine.lock.acquire()
        try:
            self.assertEqual(self.post()[0], 429)
        finally:
            self.server.engine.lock.release()


if __name__ == "__main__":
    unittest.main()
