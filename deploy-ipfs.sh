#!/bin/bash
set -e

echo "Building project..."
npm run build

echo ""
echo "Uploading to IPFS via web3.storage..."

# Upload the dist directory
CID=$(w3 up dist --no-wrap 2>&1 | grep -E "^baf" | head -1)

if [ -z "$CID" ]; then
    echo "Error: Failed to get CID from upload"
    echo "Make sure you have:"
    echo "  1. Run 'w3 login your@email.com' to authenticate"
    echo "  2. Run 'w3 space create <name>' to create a space"
    echo "  3. Verified your email and set up billing at https://console.web3.storage"
    exit 1
fi

echo ""
echo "Upload complete!"

# Warm public gateways so the first visitor (and wallet-app handoffs, which use
# ipfs.io) don't hit a cold CID — large bundles take ~50s cold, ~1s warmed.
# Failures are ignored; warming is best-effort.
echo ""
echo "Warming gateways..."
for BASE in "https://ipfs.io/ipfs/${CID}" "https://${CID}.ipfs.dweb.link" "https://${CID}.ipfs.w3s.link"; do
    while IFS= read -r -d '' FILE; do
        REL="${FILE#dist/}"
        START=$(date +%s)
        # Cold sourcing 504/520s regularly; each retry resumes from whatever the
        # gateway cached, so a few passes land the big files.
        STATUS="failed"
        for ATTEMPT in 1 2 3; do
            if curl -sf --max-time 90 -o /dev/null "${BASE}/${REL}"; then
                STATUS="ok"
                break
            fi
        done
        echo "  ${BASE%%/ipfs/*} ${REL} ${STATUS} $(( $(date +%s) - START ))s"
    done < <(find dist -type f \( -name "*.js" -o -name "*.css" -o -name "*.html" \) -print0)
done

# Browser-native IPFS (inbrowser.link and other service-worker gateways) discovers blocks via
# routing records the pinning service can lag on announcing for hours ("No providers were found").
# Those clients also read trustless gateways directly, so pulling the whole DAG as a CAR seeds the
# cache they actually use. Cold sourcing regularly times out mid-DAG; each pass resumes from the
# gateway's cache, so retry until the full DAG lands (>1MB in one pass) or five passes elapse.
for PASS in 1 2 3 4 5; do
    START=$(date +%s)
    SIZE=$(curl -sf --max-time 300 -o /dev/null -w '%{size_download}' "https://trustless-gateway.link/ipfs/${CID}?format=car&dag-scope=all" || echo "")
    if [ -n "$SIZE" ]; then
        echo "  trustless CAR pass ${PASS}: $(( SIZE / 1000000 ))MB $(( $(date +%s) - START ))s"
        if [ "$SIZE" -gt 1000000 ]; then
            break
        fi
    else
        echo "  trustless CAR pass ${PASS} failed — continuing"
    fi
    sleep 5
done

echo ""
echo "Your site is live at:"
echo "  IPFS: ipfs://${CID}"
echo "  Gateway: https://${CID}.ipfs.w3s.link"
echo "  Gateway: https://${CID}.ipfs.dweb.link"
echo "  Gateway: https://ipfs.io/ipfs/${CID}"
echo ""
echo "To use with ENS, set your contenthash to:"
echo "  ipfs://${CID}"
