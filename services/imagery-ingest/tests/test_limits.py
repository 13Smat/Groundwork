import unittest

from groundwork_imagery_ingest.errors import IngestError
from groundwork_imagery_ingest.limits import MAX_INGEST_AOI_SQ_M, assert_ingest_scope, geometry_area_sq_m


def polygon(west: float, south: float, east: float, north: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [west, south],
                [west, north],
                [east, north],
                [east, south],
                [west, south],
            ]
        ],
    }


FIXTURE = polygon(-81.705322265625, 35.746512259919, -81.699829101563, 35.75097043945)
# Seeded North Carolina extent from migration 0003. Larger than one county.
NORTH_CAROLINA = polygon(-84.32, 33.84, -75.46, 36.59)


class LimitsTest(unittest.TestCase):
    def test_fixture_chip_is_under_the_cap_and_the_state_extent_is_not(self) -> None:
        chip = geometry_area_sq_m(FIXTURE)
        state = geometry_area_sq_m(NORTH_CAROLINA)
        self.assertLess(chip, 1_000_000)
        self.assertGreater(state, MAX_INGEST_AOI_SQ_M)
        assert_ingest_scope(None, FIXTURE)
        with self.assertRaises(IngestError) as raised:
            assert_ingest_scope(None, NORTH_CAROLINA)
        self.assertEqual(raised.exception.code, "aoi_too_large")

    def test_county_and_aoi_are_exclusive(self) -> None:
        assert_ingest_scope("37023", None)
        with self.assertRaises(IngestError) as both:
            assert_ingest_scope("37023", FIXTURE)
        self.assertEqual(both.exception.code, "scope_both")
        with self.assertRaises(IngestError) as missing:
            assert_ingest_scope(None, None)
        self.assertEqual(missing.exception.code, "scope_missing")

    def test_state_fips_is_not_a_county(self) -> None:
        with self.assertRaises(IngestError) as raised:
            assert_ingest_scope("37000", None)
        self.assertEqual(raised.exception.code, "state_fips")


if __name__ == "__main__":
    unittest.main()
