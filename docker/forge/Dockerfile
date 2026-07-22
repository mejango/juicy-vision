# Unsupported development experiment. The caller must supply an approved,
# immutable `ghcr.io/foundry-rs/foundry@sha256:...` base. Project dependencies
# must be vendored into the read-only workspace; this image performs no clones.
ARG FOUNDRY_IMAGE
FROM ${FOUNDRY_IMAGE}

USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["forge"]
CMD ["--version"]
