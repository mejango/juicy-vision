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
echo ""
echo "Your site is live at:"
echo "  IPFS: ipfs://${CID}"
echo "  Gateway: https://${CID}.ipfs.w3s.link"
echo "  Gateway: https://${CID}.ipfs.dweb.link"
echo "  Gateway: https://ipfs.io/ipfs/${CID}"
echo ""
echo "To use with ENS, set your contenthash to:"
echo "  ipfs://${CID}"
