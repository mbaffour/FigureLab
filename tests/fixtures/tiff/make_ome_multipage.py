#!/usr/bin/env python3
"""Build cal_ome_multi.ome.tif — a 3-plane OME-TIFF that carries its calibration
ONLY in page 0's ImageDescription, with no resolution tags anywhere.

That is what Bio-Formats and tifffile actually emit, and it is the case
_tiffCalibration used to get wrong: it read ImageDescription from the CURRENT
page's IFD, so planes 2 and 3 found no PhysicalSizeX, fell through to the
resolution tags that are not there, and arrived uncalibrated with their scale
bar switched on and nothing to draw it from.

Needs tifffile + numpy (not installed system-wide; use a scratchpad venv).
Run from this directory:  python make_ome_multipage.py
"""
# TIFF ASCII tags are 7-bit, so the unit is spelled "um" rather than "\u00b5m";
# the reader treats the two the same.
import numpy as np, tifffile, json, os

W = H = 64
PX = 0.25                      # µm per pixel, on page 0 only

planes = np.stack([
    np.full((H, W), 40 + 60 * i, dtype=np.uint8) for i in range(3)
])
for i in range(3):             # a marker square so the panels are distinguishable
    planes[i, 8:24, 8:24] = 220

ome = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">'
    '<Image ID="Image:0" Name="series">'
    f'<Pixels ID="Pixels:0" DimensionOrder="XYCZT" Type="uint8" '
    f'SizeX="{W}" SizeY="{H}" SizeC="1" SizeZ="1" SizeT="3" '
    f'PhysicalSizeX="{PX}" PhysicalSizeXUnit="um" '
    f'PhysicalSizeY="{PX}" PhysicalSizeYUnit="um">'
    + ''.join(f'<Plane TheC="0" TheZ="0" TheT="{t}" DeltaT="{t*30.0}" DeltaTUnit="s"/>'
              for t in range(3))
    + '</Pixels></Image></OME>'
)

out = 'cal_ome_multi.ome.tif'
with tifffile.TiffWriter(out) as tw:
    for i, p in enumerate(planes):
        # description on page 0 only; resolution deliberately omitted everywhere
        tw.write(p, description=(ome if i == 0 else None), contiguous=False,
                 metadata=None, photometric='minisblack')

print(f'wrote {out} ({os.path.getsize(out)} bytes)')
man = {'cal_ome_multi': {'pages': 3, 'umPerPx': PX, 'source': 'OME-TIFF',
                         'deltaT': [0.0, 30.0, 60.0]}}
json.dump(man, open('ome_multi_manifest.json', 'w'), indent=1)
print('wrote ome_multi_manifest.json')
