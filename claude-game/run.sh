#!/bin/sh
cd "$(dirname "$0")" && (xdg-open http://localhost:8000 &) && python -m http.server 8000
