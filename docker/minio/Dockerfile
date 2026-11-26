# Local MinIO only. Docker Hub no longer serves minio/minio (the tag URL
# returned 404 on 2026-11-26). The binary is the GitHub release, checked
# against the checksum file published next to it. ADR 0005.
FROM debian:bookworm-slim

ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY checksums.txt /tmp/checksums.txt
RUN set -eu \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
       amd64) bin_arch="amd64" ;; \
       arm64) bin_arch="arm64" ;; \
       *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
     esac \
  && file="minio.linux-${bin_arch}.${MINIO_VERSION}" \
  && curl -fsSL "https://github.com/minio/minio/releases/download/${MINIO_VERSION}/${file}" -o /tmp/minio \
  && expected="$(awk -v arch="$bin_arch" '$1 == arch { print $2 }' /tmp/checksums.txt)" \
  && test -n "$expected" \
  && echo "${expected}  /tmp/minio" | sha256sum -c - \
  && install -m 0755 /tmp/minio /usr/local/bin/minio \
  && rm /tmp/minio /tmp/checksums.txt

EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/minio"]
