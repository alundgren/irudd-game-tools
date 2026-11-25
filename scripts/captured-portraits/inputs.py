"""Pinned HSRD-100 registrations; intermediate files live with the local source scans."""

from pathlib import Path
import os

CACHE = Path(os.environ["CAPTURED_PORTRAIT_CACHE"])
SYSTEM_SKINS = Path(os.environ["CAPTURED_SYSTEM_SKINS"])
SOURCE_COMMIT = "9cc5e9c138dd310dc88c95c80e5db0a3ecb7971a"
FRAMES = {
    "HSR0023-Body-017": 0.9,
    "HSR0028-Body-058": -0.9,
    "HSR0102-Body-052": -0.9,
    "HSR0040-Body-004": 0.9,
    "HSR0042-Body-018": 0.9,
    "HSR0112-Body-036": -0.9,
    "HSR0015-Body-054": -0.9,
    "HSR0027-Body-053": -0.9,
    "HSR0081-Body-074": 0.9,
}
