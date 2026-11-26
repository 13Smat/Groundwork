import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import rasterio
from rio_cogeo.cogeo import cog_validate

from groundwork_imagery_ingest.cog import convert_to_cog, read_capture_fields, write_solid_geotiff
from groundwork_imagery_ingest.errors import IngestError
from groundwork_imagery_ingest.fetchers import FetchRequest
from groundwork_imagery_ingest.pipeline import run_ingest
from groundwork_imagery_ingest.upload import MemoryUploader

# WebMercatorQuad z=16 x=17894 y=25791, from db/seed/fixtures/rgbir-cog.json.
MERCATOR = (-9095394.86970973, 4265797.674539169, -9094783.373483447, 4266409.17076545)
COLOR = (220, 30, 40, 180)
AOI = {
    "type": "Polygon",
    "coordinates": [
        [
            [-81.705322265625, 35.746512259919],
            [-81.705322265625, 35.75097043945],
            [-81.699829101563, 35.75097043945],
            [-81.699829101563, 35.746512259919],
            [-81.705322265625, 35.746512259919],
        ]
    ],
}


class CogTest(unittest.TestCase):
    def test_four_band_geotiff_becomes_a_cog_that_keeps_nir(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.tif"
            cog = root / "out.tif"
            write_solid_geotiff(
                source,
                width=64,
                height=64,
                crs="EPSG:3857",
                bounds=MERCATOR,
                color=COLOR,
                capture_date="2026-01-15",
                leaf="off",
            )
            source_valid, _errors, _warnings = cog_validate(source, quiet=True)
            self.assertFalse(source_valid)
            fields = read_capture_fields(source, None)
            convert_to_cog(source, cog, fields["capture_date"], fields["leaf"])
            cog_valid, errors, _warnings = cog_validate(cog, quiet=True)
            self.assertTrue(cog_valid, errors)
            with rasterio.open(cog) as dataset:
                self.assertEqual(dataset.count, 4)
                self.assertEqual(dataset.descriptions[3], "NIR")
                center = dataset.read(4)[dataset.height // 2, dataset.width // 2]
                self.assertEqual(int(center), COLOR[3])
                red = dataset.read(1)[dataset.height // 2, dataset.width // 2]
                self.assertEqual(int(red), COLOR[0])
            self.assertEqual(fields["capture_date"], "2026-01-15")
            self.assertEqual(fields["leaf"], "off")
            self.assertEqual(fields["gsd_cm"], 775.44)
            self.assertEqual(fields["footprint"]["type"], "Polygon")
            ring = fields["footprint"]["coordinates"][0]
            lons = [point[0] for point in ring]
            lats = [point[1] for point in ring]
            self.assertLess(min(lons), -81.70)
            self.assertGreater(max(lons), -81.70)
            self.assertLess(min(lats), 35.75)
            self.assertGreater(max(lats), 35.74)

    def test_three_band_raster_is_refused(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "rgb.tif"
            write_solid_geotiff(
                path,
                width=8,
                height=8,
                crs="EPSG:3857",
                bounds=MERCATOR,
                color=COLOR,
                capture_date="2026-01-15",
                leaf="off",
            )
            import rasterio

            with rasterio.open(path) as src:
                profile = src.profile.copy()
                profile.update(count=3)
                data = src.read(range(1, 4))
            rgb = Path(tmp) / "three.tif"
            with rasterio.open(rgb, "w", **profile) as dst:
                dst.write(data)
            with self.assertRaises(IngestError) as raised:
                read_capture_fields(rgb, None)
            self.assertEqual(raised.exception.code, "not_four_bands")

    def test_pipeline_reports_the_cog_fields_and_uploads_the_key(self) -> None:
        with TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.tif"
            write_solid_geotiff(
                source,
                width=32,
                height=32,
                crs="EPSG:3857",
                bounds=MERCATOR,
                color=COLOR,
                capture_date="2026-01-15",
                leaf="off",
            )
            uploader = MemoryUploader()
            key = "imagery/captures/018f5a00-0000-7000-8000-000000000201.tif"
            report = run_ingest(
                FetchRequest("fixture", 2026, None, AOI, source),
                key,
                uploader,
            )
            self.assertTrue(report["ok"])
            self.assertEqual(report["bands"], "RGBIR")
            self.assertEqual(report["band_count"], 4)
            self.assertEqual(report["capture_date"], "2026-01-15")
            self.assertEqual(report["leaf"], "off")
            self.assertEqual(report["cog_key"], key)
            self.assertGreater(report["gsd_cm"], 0)
            stored = uploader.objects[key]
            self.assertGreater(len(stored), 0)
            cog_valid, errors, _warnings = cog_validate(source, quiet=True)
            self.assertFalse(cog_valid)
            out = Path(tmp) / "stored.tif"
            out.write_bytes(stored)
            stored_valid, stored_errors, _warnings = cog_validate(out, quiet=True)
            self.assertTrue(stored_valid, stored_errors or errors)


if __name__ == "__main__":
    unittest.main()
