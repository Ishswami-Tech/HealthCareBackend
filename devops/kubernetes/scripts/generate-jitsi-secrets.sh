#!/usr/bin/env bash
# Script to generate Jitsi Meet secrets for Kubernetes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../base" && pwd)"
SECRETS_FILE="$BASE_DIR/secrets.yaml"

echo "🔐 Generating Jitsi Meet secrets..."

# Check if secrets.yaml already exists
if [ -f "$SECRETS_FILE" ]; then
    echo "⚠️  Warning: secrets.yaml already exists at: $SECRETS_FILE"
    read -p "   Do you want to update Jitsi secrets? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "   Skipping secret generation."
        exit 0
    fi
fi

# Generate secure random passwords
echo "   Generating secure random passwords..."

JICOFO_SECRET=$(openssl rand -base64 32 | tr -d '\n')
FOCUS_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
JVB_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
JIGASI_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
JIBRI_RECORDER_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
JIBRI_XMPP_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

# Base64 encode them
JICOFO_SECRET_B64=$(echo -n "$JICOFO_SECRET" | base64 | tr -d '\n')
FOCUS_PASSWORD_B64=$(echo -n "$FOCUS_PASSWORD" | base64 | tr -d '\n')
JVB_PASSWORD_B64=$(echo -n "$JVB_PASSWORD" | base64 | tr -d '\n')
JIGASI_PASSWORD_B64=$(echo -n "$JIGASI_PASSWORD" | base64 | tr -d '\n')
JIBRI_RECORDER_PASSWORD_B64=$(echo -n "$JIBRI_RECORDER_PASSWORD" | base64 | tr -d '\n')
JIBRI_XMPP_PASSWORD_B64=$(echo -n "$JIBRI_XMPP_PASSWORD" | base64 | tr -d '\n')
JWT_SECRET_B64=$(echo -n "$JWT_SECRET" | base64 | tr -d '\n')

echo "✅ Generated Jitsi secrets:"
echo "   - Jicofo Secret: ${JICOFO_SECRET:0:20}..."
echo "   - Focus Password: ${FOCUS_PASSWORD:0:20}..."
echo "   - JVB Password: ${JVB_PASSWORD:0:20}..."
echo "   - JWT Secret: ${JWT_SECRET:0:20}..."

# Create or update secrets.yaml
if [ ! -f "$SECRETS_FILE" ]; then
    echo "   Creating new secrets.yaml from template..."
    cp "$BASE_DIR/secrets.yaml.template" "$SECRETS_FILE"
fi

# Update Jitsi secrets in secrets.yaml
echo "   Updating secrets.yaml with Jitsi secrets..."

# Use sed to replace the Jitsi secret placeholders
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s|jitsi-jicofo-secret: <BASE64_ENCODED_VALUE>|jitsi-jicofo-secret: $JICOFO_SECRET_B64|g" "$SECRETS_FILE"
    sed -i '' "s|jitsi-focus-password: <BASE64_ENCODED_VALUE>|jitsi-focus-password: $FOCUS_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i '' "s|jitsi-jvb-password: <BASE64_ENCODED_VALUE>|jitsi-jvb-password: $JVB_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i '' "s|jitsi-jigasi-password: <BASE64_ENCODED_VALUE>|jitsi-jigasi-password: $JIGASI_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i '' "s|jitsi-jibri-recorder-password: <BASE64_ENCODED_VALUE>|jitsi-jibri-recorder-password: $JIBRI_RECORDER_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i '' "s|jitsi-jibri-xmpp-password: <BASE64_ENCODED_VALUE>|jitsi-jibri-xmpp-password: $JIBRI_XMPP_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i '' "s|jitsi-jwt-secret: <BASE64_ENCODED_VALUE>|jitsi-jwt-secret: $JWT_SECRET_B64|g" "$SECRETS_FILE"
else
    # Linux
    sed -i "s|jitsi-jicofo-secret: <BASE64_ENCODED_VALUE>|jitsi-jicofo-secret: $JICOFO_SECRET_B64|g" "$SECRETS_FILE"
    sed -i "s|jitsi-focus-password: <BASE64_ENCODED_VALUE>|jitsi-focus-password: $FOCUS_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i "s|jitsi-jvb-password: <BASE64_ENCODED_VALUE>|jitsi-jvb-password: $JVB_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i "s|jitsi-jigasi-password: <BASE64_ENCODED_VALUE>|jitsi-jigasi-password: $JIGASI_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i "s|jitsi-jibri-recorder-password: <BASE64_ENCODED_VALUE>|jitsi-jibri-recorder-password: $JIBRI_RECORDER_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i "s|jitsi-jibri-xmpp-password: <BASE64_ENCODED_VALUE>|jitsi-jibri-xmpp-password: $JIBRI_XMPP_PASSWORD_B64|g" "$SECRETS_FILE"
    sed -i "s|jitsi-jwt-secret: <BASE64_ENCODED_VALUE>|jitsi-jwt-secret: $JWT_SECRET_B64|g" "$SECRETS_FILE"
fi

echo "✅ Jitsi secrets updated in: $SECRETS_FILE"
echo ""
echo "📋 Next steps:"
echo "   1. Review the secrets.yaml file"
echo "   2. Apply secrets: kubectl apply -f $SECRETS_FILE"
echo "   3. Deploy Jitsi: kubectl apply -k $BASE_DIR"
echo ""
echo "⚠️  IMPORTANT: Keep secrets.yaml secure and do NOT commit it to version control!"
