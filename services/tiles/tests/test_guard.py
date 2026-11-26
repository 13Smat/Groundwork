import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from groundwork_tiles.guard import (  # noqa: E402
    assert_cog_key,
    assert_storage_endpoint,
    host_is_forbidden,
    reject_external_cog_url,
    sign_payload,
    signature_payload,
    signatures_match,
    vsis3_path,
)


class GuardTests(unittest.TestCase):
    def test_forbidden_hosts(self) -> None:
        self.assertTrue(host_is_forbidden("maps.googleapis.com"))
        self.assertTrue(host_is_forbidden("tile.googleapis.com"))
        self.assertTrue(host_is_forbidden("api.mapbox.com"))
        self.assertTrue(host_is_forbidden("services.nconemap.gov"))
        self.assertTrue(host_is_forbidden("data-nconemap.opendata.arcgis.com"))
        self.assertFalse(host_is_forbidden("127.0.0.1"))
        self.assertFalse(host_is_forbidden("minio"))

    def test_storage_endpoint_refuses_state_and_google_hosts(self) -> None:
        self.assertEqual(assert_storage_endpoint("http://minio:9000"), "minio:9000")
        self.assertEqual(assert_storage_endpoint("http://127.0.0.1:9000"), "127.0.0.1:9000")
        with self.assertRaises(ValueError):
            assert_storage_endpoint("https://services.nconemap.gov/secure/rest")
        with self.assertRaises(ValueError):
            assert_storage_endpoint("https://maps.googleapis.com")
        with self.assertRaises(ValueError):
            assert_storage_endpoint("https://api.mapbox.com")

    def test_cog_key_rejects_urls(self) -> None:
        self.assertEqual(assert_cog_key("imagery/fixtures/rgbir-cog.tif"), "imagery/fixtures/rgbir-cog.tif")
        for key in (
            "https://services.nconemap.gov/tile.tif",
            "s3://groundwork/imagery/fixtures/rgbir-cog.tif",
            "../secret.tif",
            "/imagery/fixtures/rgbir-cog.tif",
            "imagery/googleapis.com/tile.tif",
        ):
            with self.assertRaises(ValueError):
                assert_cog_key(key)

    def test_external_url_query_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            reject_external_cog_url(["url"])
        reject_external_cog_url(["workspaceId", "exp", "sig"])

    def test_signature_vector_matches_the_api(self) -> None:
        payload = signature_payload(
            "018f5a00-0000-7000-8000-000000000108",
            "WebMercatorQuad",
            16,
            17894,
            25791,
            "018f5a00-0000-7000-8000-0000000000aa",
            1700000000,
        )
        self.assertEqual(
            payload,
            "018f5a00-0000-7000-8000-000000000108.WebMercatorQuad.16.17894.25791.018f5a00-0000-7000-8000-0000000000aa.1700000000",
        )
        signature = sign_payload(payload, "local-tile-signing-secret")
        self.assertEqual(signature, "gl1Nm8i64xqQMplCHwjcE-VA9md1HmPRQA2qop-7fHs")
        self.assertTrue(signatures_match(signature, signature))
        self.assertFalse(signatures_match(signature, signature[:-1] + "A"))

    def test_vsis3_path_stays_in_the_bucket(self) -> None:
        self.assertEqual(
            vsis3_path("groundwork", "imagery/fixtures/rgbir-cog.tif"),
            "/vsis3/groundwork/imagery/fixtures/rgbir-cog.tif",
        )


if __name__ == "__main__":
    unittest.main()
