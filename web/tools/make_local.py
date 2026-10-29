#!/usr/bin/env python3
"""Wrap review.html in a full HTML document so it runs from a local web server."""
import os
WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
body = open(os.path.join(WEB, "review.html")).read()
head = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        '<style>html{color-scheme:light}[hidden]{display:none!important}body{margin:0}</style>')
open(os.path.join(WEB, "index.html"), "w").write(head + "</head><body>\n" + body + "\n</body></html>\n")
print("wrote index.html")
