"""RGB tile reader. The COG keeps the NIR band. Map tiles use bands 1, 2, and 3."""

from __future__ import annotations

from rio_tiler.io import Reader


class RgbReader(Reader):
    def tile(self, tile_x: int, tile_y: int, tile_z: int, tilesize: int | None = None, indexes=None, expression=None, buffer=None, **kwargs):  # type: ignore[no-untyped-def]
        # Ignore caller band indexes and expressions. A signed tile is RGB.
        return super().tile(
            tile_x,
            tile_y,
            tile_z,
            tilesize=tilesize,
            indexes=(1, 2, 3),
            expression=None,
            buffer=buffer,
            **kwargs,
        )
