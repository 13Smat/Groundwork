# Tiles

TiTiler service that reads our COGs. Not implemented. `docker-compose.yml` runs upstream TiTiler as a local placeholder with no fixture COG and no auth. When this service exists, a capture whose source has `allows_tracing` false, or whose `verified_at` is unset, returns 403. Do not weaken that.
