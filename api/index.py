"""
Vercel Serverless Function entrypoint for CardioShield-AgeLess
"""
import sys
import os

# Add parent directory to path so server module can be imported
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from server import app

# Vercel WSGI / ASGI entrypoint
app.debug = False
