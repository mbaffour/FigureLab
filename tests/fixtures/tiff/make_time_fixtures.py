#!/usr/bin/env python3
"""Generate the acquisition-time TIFF fixtures (time_*.tif) and their manifest.

The other fixtures in this folder were written with tifffile too; this script is kept
so the time ones can be regenerated or extended rather than being opaque bytes.

    pip install tifffile numpy
    python make_time_fixtures.py

Each file carries exactly one kind of time metadata, so a failure names the reader that
broke: OME Plane DeltaT, an ImageJ frame interval, a bare TIFF DateTime tag, or none.
"""
import json
import os

import numpy as np
import tifffile

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = np.stack([np.full((24, 40), v, np.uint8) for v in (40, 120, 200)])

# 1. OME-TIFF time series: three planes at 0, 300 and 600 seconds.
tifffile.imwrite(
    os.path.join(HERE, "time_ome.ome.tif"),
    FRAMES,
    metadata={"axes": "TYX", "Plane": {"DeltaT": [0.0, 300.0, 600.0], "DeltaTUnit": ["s", "s", "s"]}},
)

# 2. OME-TIFF recording DeltaT in minutes, to prove the unit is honoured.
tifffile.imwrite(
    os.path.join(HERE, "time_ome_min.ome.tif"),
    FRAMES,
    metadata={"axes": "TYX", "Plane": {"DeltaT": [0.0, 2.0, 4.0], "DeltaTUnit": ["min", "min", "min"]}},
)

# 3. ImageJ stack with a 2.5 s frame interval and no per-plane times.
tifffile.imwrite(
    os.path.join(HERE, "time_imagej.tif"),
    FRAMES,
    imagej=True,
    metadata={"finterval": 2.5, "unit": "micron", "axes": "TYX"},
)

# 4. A single page whose only time is the baseline DateTime tag.
tifffile.imwrite(
    os.path.join(HERE, "time_datetime.tif"), FRAMES[0], datetime="2026:09:14 10:23:45"
)
tifffile.imwrite(
    os.path.join(HERE, "time_datetime_later.tif"), FRAMES[1], datetime="2026:09:14 10:38:45"
)

# 5. No time metadata at all — must stay untagged rather than be guessed at.
tifffile.imwrite(os.path.join(HERE, "time_none.tif"), FRAMES[0])

manifest = {
    "time_ome.ome": {"pages": 3, "deltaT": [0.0, 300.0, 600.0], "source": "OME Plane DeltaT"},
    "time_ome_min.ome": {"pages": 3, "deltaT": [0.0, 120.0, 240.0], "source": "OME Plane DeltaT"},
    "time_imagej": {"pages": 3, "deltaT": [0.0, 2.5, 5.0], "source": "ImageJ frame interval"},
    "time_datetime": {"pages": 1, "acqTimeISO": "2026-09-14T10:23:45.000Z", "source": "TIFF DateTime"},
    "time_datetime_later": {"pages": 1, "acqTimeISO": "2026-09-14T10:38:45.000Z", "source": "TIFF DateTime"},
    "time_none": {"pages": 1, "source": ""},
}
with open(os.path.join(HERE, "time_manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=1)
print("wrote", len(manifest), "fixtures + time_manifest.json")
