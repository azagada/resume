#!/usr/bin/env python3
"""Copy the USWDS files this site uses into site/assets/uswds/.

Downloads a USWDS 3 release from the npm registry, checks it against the
registry's published checksum, and copies in only what the site loads: the
minified CSS and JavaScript, the icon sprite, and every font and image the
CSS points to. Everything in site/assets/uswds/ is replaced, so don't edit files
there; put your own styles in site/assets/css/site.css instead.

    python3 scripts/update-uswds.py           # newest 3.x release
    python3 scripts/update-uswds.py 3.14.0    # a specific release

Needs Python 3.8 or newer. Node.js isn't required.
"""

import base64
import hashlib
import io
import json
import posixpath
import re
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

REGISTRY_URL = "https://registry.npmjs.org/@uswds/uswds"
MAJOR_VERSION = 3
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "site" / "assets" / "uswds"

# Files index.html links to directly (paths inside the package's dist/ folder).
# Fonts and images are found by reading the url() references in the CSS.
LINKED_FILES = [
    "css/uswds.min.css",
    "js/uswds-init.min.js",
    "js/uswds.min.js",
    "img/sprite.svg",
]


def fetch(url, accept=None):
    headers = {"Accept": accept} if accept else {}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
        return response.read()


def resolve_release(requested):
    """Return (version, dist info) for the requested or newest stable 3.x release."""
    # The abbreviated metadata document is much smaller than the full one.
    metadata = json.loads(fetch(REGISTRY_URL, accept="application/vnd.npm.install-v1+json"))
    versions = metadata["versions"]
    if requested:
        if requested not in versions:
            sys.exit(f"USWDS {requested} isn't on npm. Check the version number and try again.")
        return requested, versions[requested]["dist"]
    stable = [v for v in versions if re.fullmatch(rf"{MAJOR_VERSION}\.\d+\.\d+", v)]
    newest = max(stable, key=lambda v: tuple(int(part) for part in v.split(".")))
    return newest, versions[newest]["dist"]


def verify(data, integrity):
    algorithm, _, expected = integrity.partition("-")
    actual = base64.b64encode(hashlib.new(algorithm, data).digest()).decode()
    if actual != expected:
        sys.exit("The download doesn't match the registry's checksum, so nothing was changed.")


def css_asset_paths(css):
    """Paths (relative to dist/) of the fonts and images the stylesheet references."""
    paths = set()
    for ref in re.findall(r"url\(\s*['\"]?([^'\")]+?)['\"]?\s*\)", css):
        if ref.startswith(("data:", "#", "http:", "https:", "//")):
            continue
        path = posixpath.normpath(posixpath.join("css", ref.split("#")[0].split("?")[0]))
        if path.startswith("../") or path.startswith("/"):
            sys.exit(f"Unexpected asset path in uswds.min.css: {ref}")
        paths.add(path)
    return paths


def main():
    requested = sys.argv[1] if len(sys.argv) > 1 else None
    version, dist = resolve_release(requested)
    print(f"Downloading USWDS {version} from npm…")
    package = fetch(dist["tarball"])
    verify(package, dist["integrity"])

    with tarfile.open(fileobj=io.BytesIO(package), mode="r:gz") as tar:
        def read(path):
            return tar.extractfile(tar.getmember(f"package/{path}")).read()

        css = read("dist/css/uswds.min.css").decode("utf-8")
        wanted = sorted(set(LINKED_FILES) | css_asset_paths(css))
        files = {path: read(f"dist/{path}") for path in wanted}
        license_text = read("LICENSE.md")

    if DEST.exists():
        shutil.rmtree(DEST)
    for path, content in files.items():
        target = DEST / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (DEST / "LICENSE.md").write_bytes(license_text)
    (DEST / "VERSION").write_text(f"{version}\n")

    size_mb = sum(len(content) for content in files.values()) / 1_000_000
    print(f"Copied {len(files)} files ({size_mb:.1f} MB) into {DEST.relative_to(ROOT)}/")
    print(f"USWDS {version} is ready. Reload the page to see it.")


if __name__ == "__main__":
    main()
