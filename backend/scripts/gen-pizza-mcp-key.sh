#!/usr/bin/env bash
# basil-14648: print a new ES256 (P-256) signing key for rsv.pizza -> pizza-mcp tokens.
# Writes NOTHING to disk. Pipe it straight into the secret store, e.g.
#   bash backend/scripts/gen-pizza-mcp-key.sh | pbcopy      # then paste into the Vercel env var PIZZA_MCP_SIGNING_KEY
# The matching public key is served at /.well-known/jwks.json once the env var is set.
set -euo pipefail
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt
