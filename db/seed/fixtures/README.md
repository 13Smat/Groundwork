# Fixture COG

`rgbir-cog.tif` is a synthetic 256×256 4-band RGBIR Cloud Optimized GeoTIFF. Band 4 is NIR. The pixels are a flat color so a tile test can recognize them. The georeferencing is one WebMercatorQuad tile at z=16 over Burke County, North Carolina.

It was not downloaded from NC OneMap, NAIP, Google, or Mapbox. Regenerate it with `db/seed/fixtures/build_fixture_cog.py` (rasterio, rio-cogeo, morecantile, numpy). `rgbir-cog.json` records the tile indices, bounds, and color.

`rgbir-source.tif` is the uncompressed 64×64 4-band GeoTIFF the ingest worker converts. It covers the same tile and is not itself a COG. `rgbir-source.json` records its date, leaf tag, and GSD.
