"""
Vercel Serverless Function entrypoint for CardioShield-AgeLess
"""
import sys
import os

parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from server import app

class VercelPathFixMiddleware:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        matched = environ.get("HTTP_X_MATCHED_PATH")
        if not matched:
            raw = environ.get("REQUEST_URI") or environ.get("RAW_URI") or ""
            if raw:
                matched = raw.split("?")[0]
        if matched and matched not in ("/api/index.py", "/api/index"):
            environ["PATH_INFO"] = matched
        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathFixMiddleware(app.wsgi_app)
app.debug = False
