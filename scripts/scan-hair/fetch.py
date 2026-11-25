"""Fetch one pose's LOD1 scan from the pinned dataset revision into source/<pose>/."""
import sys, zipfile
from pathlib import Path
from huggingface_hub import hf_hub_download
pose = sys.argv[1]; lod = sys.argv[2] if len(sys.argv) > 2 else 'LOD1'
here = Path(__file__).resolve().parents[2] / '.reference-cache' / 'scan-hair11'; dest = here / 'source' / pose; dest.mkdir(parents=True, exist_ok=True)
path = hf_hub_download('digitalrealitylab/HSRD-100', f'data/{pose[:7]}/{pose}/scans/{pose}-Scan-{lod}.zip', repo_type='dataset',
                       revision='9cc5e9c138dd310dc88c95c80e5db0a3ecb7971a', local_dir=here / 'source' / 'download')
with zipfile.ZipFile(path) as z:
    for info in z.infolist():
        name = Path(info.filename).name
        if name and Path(name).suffix.lower() in ('.obj', '.png', '.jpg', '.json'):
            (dest / name).write_bytes(z.read(info))
            print(name, info.file_size)
