# Bucket init for the local MinIO build. mc is the GitHub release. ADR 0005.
FROM debian:bookworm-slim

ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z

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
  && file="mc.linux-${bin_arch}.${MC_VERSION}" \
  && curl -fsSL "https://github.com/minio/mc/releases/download/${MC_VERSION}/${file}" -o /tmp/mc \
  && expected="$(awk -v arch="$bin_arch" '$1 == arch { print $2 }' /tmp/checksums.txt)" \
  && test -n "$expected" \
  && echo "${expected}  /tmp/mc" | sha256sum -c - \
  && install -m 0755 /tmp/mc /usr/local/bin/mc \
  && rm /tmp/mc /tmp/checksums.txt

COPY init.sh /usr/local/bin/init.sh
RUN chmod 0755 /usr/local/bin/init.sh

ENTRYPOINT ["/usr/local/bin/init.sh"]
