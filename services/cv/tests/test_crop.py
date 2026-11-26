"""Chip crop against the committed fixture COG. Raster tests need the imagery venv."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from groundwork_cv.crop import ChipError, assert_cog_key, assert_storage_endpoint, crop_chip

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "db" / "seed" / "fixtures" / "rgbir-cog.tif"
META = json.loads((ROOT / "db" / "seed" / "fixtures" / "rgbir-cog.json").read_text())


def _rasterio():
    try:
        import rasterio
    except ImportError:
        return None
    return rasterio


class CropGuardTest(unittest.TestCase):
    def test_cog_key_rejects_urls(self) -> None:
        self.assertEqual(assert_cog_key("imagery/fixtures/rgbir-cog.tif"), "imagery/fixtures/rgbir-cog.tif")
        for key in (
            "https://example.com/a.tif",
            "s3://groundwork/a.tif",
            "../secret.tif",
            "imagery/googleapis.com/a.tif",
        ):
            with self.assertRaises(ChipError) as caught:
                assert_cog_key(key)
            self.assertEqual(caught.exception.code, "cog_key_invalid")

    def test_storage_endpoint_refuses_google_and_mapbox(self) -> None:
        self.assertEqual(assert_storage_endpoint("http://127.0.0.1:9000"), "127.0.0.1:9000")
        for endpoint in (
            "https://storage.googleapis.com",
            "https://api.mapbox.com",
            "https://services.nconemap.gov/tile",
        ):
            with self.assertRaises(ChipError) as caught:
                assert_storage_endpoint(endpoint)
            self.assertEqual(caught.exception.code, "storage_forbidden")


@unittest.skipUnless(_rasterio(), "rasterio is installed in the imagery venv")
class CropFixtureTest(unittest.TestCase):
    def test_fixture_chip_stays_within_4096_and_matches_the_tile(self) -> None:
        bounds = META["bounds"]
        chip = crop_chip(
            str(FIXTURE),
            west=bounds["west"],
            south=bounds["south"],
            east=bounds["east"],
            north=bounds["north"],
        )
        self.assertLessEqual(chip["width"], 4096)
        self.assertLessEqual(chip["height"], 4096)
        self.assertEqual(chip["width"], META["width"])
        self.assertEqual(chip["height"], META["height"])
        self.assertEqual(chip["crs_epsg"], 3857)
        self.assertEqual(len(chip["transform"]), 6)
        self.assertGreater(chip["ground_pixel_m"], 1)
        self.assertLess(chip["ground_pixel_m"], 3)
        self.assertGreater(len(chip["chip_base64"]), 16)

    def test_max_side_shrinks_the_chip(self) -> None:
        bounds = META["bounds"]
        chip = crop_chip(
            str(FIXTURE),
            west=bounds["west"],
            south=bounds["south"],
            east=bounds["east"],
            north=bounds["north"],
            max_side=64,
        )
        self.assertLessEqual(chip["width"], 64)
        self.assertLessEqual(chip["height"], 64)
        self.assertGreater(chip["ground_pixel_m"], 1)

    def test_a_bbox_outside_the_raster_is_refused(self) -> None:
        with self.assertRaises(ChipError) as caught:
            crop_chip(str(FIXTURE), west=0, south=0, east=0.01, north=0.01)
        self.assertEqual(caught.exception.code, "chip_outside")

    def test_a_remote_url_is_not_a_local_cog(self) -> None:
        from groundwork_cv.crop import main

        code = main(
            [
                "--cog",
                "https://tiles.example.com/a.tif",
                "--west",
                "-81.71",
                "--south",
                "35.74",
                "--east",
                "-81.69",
                "--north",
                "35.76",
            ]
        )
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
