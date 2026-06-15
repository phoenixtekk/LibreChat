#!/usr/bin/env bash
# Generates a production .env for Analytikul from .env.example with fresh secrets.
# Run on the production host from the repo root. Provider key is read from
# stdin or $AGENT_KEY so it never appears in argv/history.
set -euo pipefail

[ -f .env ] && { echo ".env already exists — refusing to overwrite"; exit 1; }
cp .env.example .env

set_var() {
  local name="$1" value="$2"
  if grep -q "^#*${name}=" .env; then
    sed -i "s|^#*${name}=.*|${name}=${value}|" .env
  else
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}

rand_hex() { openssl rand -hex "$1"; }

AGENT_KEY="${AGENT_KEY:-}"
if [ -z "$AGENT_KEY" ]; then
  read -r AGENT_KEY
fi

set_var APP_TITLE Analytikul
set_var HOST 0.0.0.0
set_var DOMAIN_CLIENT https://analytikul.ai
set_var DOMAIN_SERVER https://analytikul.ai
set_var NO_INDEX false
set_var JWT_SECRET "$(rand_hex 32)"
set_var JWT_REFRESH_SECRET "$(rand_hex 32)"
set_var CREDS_KEY "$(rand_hex 32)"
set_var CREDS_IV "$(rand_hex 16)"
set_var MEILI_MASTER_KEY "$(rand_hex 16)"
set_var POSTGRES_PASSWORD "$(rand_hex 16)"
set_var ANALYTIKUL_VAULT_KEY "$(rand_hex 32)"
# Shared secret authenticating the Node backend to the internal services
# (billing/analytics/memory/gateway/hermes-adapter). Required in prod.
set_var INTERNAL_SERVICE_TOKEN "$(rand_hex 32)"
set_var ANTHROPIC_API_KEY "$AGENT_KEY"
set_var AGENT_DEFAULT_API_KEY "$AGENT_KEY"
set_var AGENT_DEFAULT_PROVIDER anthropic
set_var AGENT_DEFAULT_MODEL claude-sonnet-4-6
set_var AGENT_DEFAULT_BASE_URL https://api.anthropic.com
set_var ALLOW_REGISTRATION true

# Hybrid billing (free = platform-paid but capped; paid = top-up / BYOK).
# CHECK_BALANCE meters every platform-key call against the user's tokenCredits
# (1000 tokenCredits = $0.001). START_BALANCE is the free-tier grant on signup
# (1,000,000 = ~$1.00). Paid plans top up via the billing webhook
# (PLAN_CREDIT_GRANT_*); BYOK users bypass platform cost via the agent vault.
set_var CHECK_BALANCE true
set_var START_BALANCE 1000000
set_var PLAN_CREDIT_GRANT_PRO 50000000
set_var PLAN_CREDIT_GRANT_TEAM 200000000

chmod 600 .env
echo "production .env written ($(grep -c '=' .env) vars), secrets regenerated"
