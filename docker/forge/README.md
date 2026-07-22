# Forge sandbox status

This directory is a quarantined development experiment. It is not built,
published, or mounted by the production API image. Initial production releases
return an explicit unavailable response for hook compilation jobs.

Do not give the API container a Docker socket. A future implementation needs a
separate authenticated worker/queue boundary, an image pinned by registry digest,
vendored V6 contract dependencies, egress restricted to a method-filtering RPC
proxy, and its own abuse/resource-limit review.

For local investigation only, set `FORGE_SANDBOX_IMAGE` to an approved
`ghcr.io/foundry-rs/foundry@sha256:...` reference and run Compose from this
directory:

```sh
docker compose --profile experimental run --rm forge --version
```

No dependency is cloned during the image build.
