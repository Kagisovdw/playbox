# -*- coding: utf-8 -*-
"""Derive dist/playbox.html from index.html for publishing as an Artifact.

The Artifact host wraps the page in its own <!doctype>/<html>/<head>/<body>,
so the published file must be content only. This strips the document scaffold
and keeps the title, the stylesheet link and the body markup.

The manifest and service-worker registration are dropped: the artifact viewer
runs the page in a sandboxed frame where neither applies. Install-to-home-screen
comes from hosting the project folder itself on any static HTTPS host.

Usage:  python tools/build-artifact.py
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build():
    src = io.open(os.path.join(HERE, 'index.html'), encoding='utf-8').read()

    title = re.search(r'<title>(.*?)</title>', src, re.S)
    title = title.group(1) if title else 'Playbox'

    body = re.search(r'<body[^>]*>(.*)</body>', src, re.S)
    if not body:
        sys.exit('index.html: no <body> found')
    body = body.group(1)

    # Drop the service-worker bootstrap - inert inside the artifact frame.
    body = re.sub(r'\n*<script>\s*//\s*Offline support.*?</script>', '', body, flags=re.S)

    page = (
        u'<title>%s</title>\n'
        u'<link rel="stylesheet" href="css/style.css" />\n'
        u'%s' % (title, body.strip())
    )

    out_dir = os.path.join(HERE, 'dist')
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    out = os.path.join(out_dir, 'playbox.html')
    io.open(out, 'w', encoding='utf-8', newline='').write(page + u'\n')

    # Match whole tags only - <header> must not trip the <head> check.
    scaffold = re.findall(r'<!doctype\b|</?(?:html|head|body)(?=[\s>/])', page, re.I)
    if scaffold:
        sys.exit('dist/playbox.html still contains scaffold tags: %s' % sorted(set(scaffold)))

    print('wrote %s (%d bytes)' % (os.path.relpath(out, HERE), len(page)))


if __name__ == '__main__':
    build()
