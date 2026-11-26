import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from groundwork_imagery_ingest.errors import IngestError
from groundwork_imagery_ingest.fetchers import LIVE_FETCH_ENV, TILE_URL_ENV, FetchRequest, fetcher_for
from groundwork_imagery_ingest.hosts import assert_geotiff_url


FIXTURE_AOI = {
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


class HostTest(unittest.TestCase):
    def test_state_portal_and_image_server_urls_are_refused(self) -> None:
        refused = [
            "https://services.nconemap.gov/secure/rest/services/Imagery/tile.tif",
            "https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Helene_2025/ImageServer/tile.tif",
            "https://tiles.arcgis.com/county.tif",
            "https://maps.googleapis.com/county.tif",
            "https://api.mapbox.com/county.tif",
            "https://example.com/wms?request=GetMap&layers=ortho.tif",
            "http://example.com/county.tif",
        ]
        for url in refused:
            with self.assertRaises(IngestError):
                assert_geotiff_url(url)

    def test_https_geotiff_on_an_allowed_host_passes(self) -> None:
        url = "https://storage.example.com/counties/37023/tile.tif"
        self.assertEqual(assert_geotiff_url(url), url)


class FetcherTest(unittest.TestCase):
    def setUp(self) -> None:
        self._env = {
            LIVE_FETCH_ENV: os.environ.get(LIVE_FETCH_ENV),
            TILE_URL_ENV: os.environ.get(TILE_URL_ENV),
        }
        os.environ.pop(LIVE_FETCH_ENV, None)
        os.environ.pop(TILE_URL_ENV, None)

    def tearDown(self) -> None:
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_fixture_fetcher_copies_a_local_file_and_does_not_open_a_url(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.tif"
            source.write_bytes(b"not-a-real-tiff-but-local")
            dest = root / "dest.tif"
            with patch("groundwork_imagery_ingest.fetchers.urllib.request.urlopen") as opened:
                fetched = fetcher_for("fixture").fetch(
                    FetchRequest("fixture", 2026, "37023", None, source),
                    dest,
                )
            opened.assert_not_called()
            self.assertEqual(fetched.path.read_bytes(), source.read_bytes())

    def test_live_programs_do_not_download_unless_opted_in(self) -> None:
        for provider in ("nc_ortho", "nc_helene_2025", "naip"):
            with TemporaryDirectory() as tmp, patch(
                "groundwork_imagery_ingest.fetchers.urllib.request.urlopen"
            ) as opened:
                with self.assertRaises(IngestError) as raised:
                    fetcher_for(provider).fetch(
                        FetchRequest(provider, 2024, "37023", None, None),
                        Path(tmp) / "out.tif",
                    )
            self.assertEqual(raised.exception.code, "live_fetch_disabled")
            opened.assert_not_called()

    def test_opted_in_fetcher_rejects_a_state_host_before_download(self) -> None:
        os.environ[LIVE_FETCH_ENV] = "1"
        os.environ[TILE_URL_ENV] = (
            "https://services.nconemap.gov/secure/rest/services/Imagery/tile.tif"
        )
        with TemporaryDirectory() as tmp, patch(
            "groundwork_imagery_ingest.fetchers.urllib.request.urlopen"
        ) as opened:
            with self.assertRaises(IngestError) as raised:
                fetcher_for("nc_ortho").fetch(
                    FetchRequest("nc_ortho", 2024, None, FIXTURE_AOI, None),
                    Path(tmp) / "out.tif",
                )
        self.assertEqual(raised.exception.code, "tile_host_forbidden")
        opened.assert_not_called()

    def test_opted_in_fetcher_without_a_url_does_not_guess_one(self) -> None:
        os.environ[LIVE_FETCH_ENV] = "1"
        with TemporaryDirectory() as tmp, patch(
            "groundwork_imagery_ingest.fetchers.urllib.request.urlopen"
        ) as opened:
            with self.assertRaises(IngestError) as raised:
                fetcher_for("naip").fetch(
                    FetchRequest("naip", 2023, "37023", None, None),
                    Path(tmp) / "out.tif",
                )
        self.assertEqual(raised.exception.code, "tile_url_missing")
        opened.assert_not_called()

    def test_statewide_aoi_is_refused_before_a_live_download(self) -> None:
        os.environ[LIVE_FETCH_ENV] = "1"
        os.environ[TILE_URL_ENV] = "https://storage.example.com/county.tif"
        state = {
            "type": "Polygon",
            "coordinates": [
                [
                    [-84.32, 33.84],
                    [-84.32, 36.59],
                    [-75.46, 36.59],
                    [-75.46, 33.84],
                    [-84.32, 33.84],
                ]
            ],
        }
        with TemporaryDirectory() as tmp, patch(
            "groundwork_imagery_ingest.fetchers.urllib.request.urlopen"
        ) as opened:
            with self.assertRaises(IngestError) as raised:
                fetcher_for("nc_helene_2025").fetch(
                    FetchRequest("nc_helene_2025", 2025, None, state, None),
                    Path(tmp) / "out.tif",
                )
        self.assertEqual(raised.exception.code, "aoi_too_large")
        opened.assert_not_called()


if __name__ == "__main__":
    unittest.main()
