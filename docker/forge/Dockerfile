# Forge Sandbox Container
# Purpose: Secure, isolated environment for compiling and testing Solidity smart contracts
#
# Security features:
# - Based on official Foundry image
# - Non-root user for execution
# - Read-only root filesystem
# - Limited capabilities
# - Pre-cached dependencies only

FROM ghcr.io/foundry-rs/foundry:latest

# Install additional dependencies
RUN apk add --no-cache \
    git \
    bash \
    jq

# Create non-root user for running forge
RUN addgroup -g 1000 forge && \
    adduser -u 1000 -G forge -h /home/forge -D forge

# Create workspace directory
RUN mkdir -p /workspace && chown forge:forge /workspace

# Create lib directory for pre-cached dependencies
RUN mkdir -p /opt/forge-libs && chown forge:forge /opt/forge-libs

# Switch to non-root user
USER forge
WORKDIR /home/forge

# Pre-cache common dependencies
# These will be available to all projects via remappings
RUN cd /opt/forge-libs && \
    git clone --depth 1 https://github.com/foundry-rs/forge-std.git && \
    git clone --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts.git && \
    git clone --depth 1 -b 5.x https://github.com/Bananapus/juice-contracts-v5.git

# Create default foundry.toml for projects
RUN echo '[profile.default]\n\
src = "src"\n\
out = "out"\n\
libs = ["lib"]\n\
solc = "0.8.28"\n\
optimizer = true\n\
optimizer_runs = 200\n\
\n\
[profile.default.remappings]\n\
forge-std/ = "/opt/forge-libs/forge-std/src/"\n\
@openzeppelin/contracts/ = "/opt/forge-libs/openzeppelin-contracts/contracts/"\n\
@jb/ = "/opt/forge-libs/juice-contracts-v5/src/"\n\
\n\
[fuzz]\n\
runs = 256\n\
\n\
[invariant]\n\
runs = 256\n' > /home/forge/foundry.toml

# Set environment
ENV FOUNDRY_PROFILE=default
ENV FOUNDRY_LIBS=/opt/forge-libs

# Default working directory for projects
WORKDIR /workspace

# Default command - override in docker run
CMD ["forge", "--version"]
