#!/bin/bash

# Vera Server Setup Script
# Sets up self-hosted LiveKit server with Gemini voice agent

set -e

echo "🎙️ Vera Server Setup"
echo "===================="
echo ""

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed."
    echo "   Install from: https://docker.com/get-started"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is required but not installed."
    exit 1
fi

echo "✅ Docker found"

# Generate LiveKit keys if .env doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Generating LiveKit API keys..."

    KEYS=$(docker run --rm livekit/livekit-server generate-keys 2>/dev/null | grep -E "API Key|API Secret")
    API_KEY=$(echo "$KEYS" | grep "API Key" | awk '{print $NF}')
    API_SECRET=$(echo "$KEYS" | grep "API Secret" | awk '{print $NF}')

    if [ -z "$API_KEY" ] || [ -z "$API_SECRET" ]; then
        echo "❌ Failed to generate keys. Creating template .env file..."
        cp .env.example .env
        echo ""
        echo "⚠️  Please edit .env and add your keys manually"
        echo "   Run: docker run --rm livekit/livekit-server generate-keys"
        exit 1
    fi

    # Create .env file
    cat > .env << EOF
# LiveKit Server Configuration (auto-generated)
LIVEKIT_API_KEY=$API_KEY
LIVEKIT_API_SECRET=$API_SECRET

# Google Gemini API Key
# Get from: https://aistudio.google.com/apikey
GOOGLE_API_KEY=

# Server URL (for iOS app)
LIVEKIT_URL=ws://localhost:7880
EOF

    echo "✅ Generated API keys"
    echo ""
    echo "⚠️  You still need to add your Google API key!"
    echo "   Edit .env and add GOOGLE_API_KEY"
    echo ""
else
    echo "✅ .env file exists"
fi

# Check for Google API key
source .env 2>/dev/null || true
if [ -z "$GOOGLE_API_KEY" ]; then
    echo ""
    echo "⚠️  GOOGLE_API_KEY is not set in .env"
    echo "   Get one from: https://aistudio.google.com/apikey"
    echo ""
    read -p "Enter your Google API key (or press Enter to skip): " GOOGLE_KEY
    if [ -n "$GOOGLE_KEY" ]; then
        sed -i '' "s/GOOGLE_API_KEY=.*/GOOGLE_API_KEY=$GOOGLE_KEY/" .env
        echo "✅ API key saved"
    fi
fi

echo ""
echo "🚀 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

# Check service health
echo ""
echo "📊 Service Status:"
docker-compose ps

echo ""
echo "✅ Vera server is running!"
echo ""
echo "📱 Next steps for iOS app:"
echo "   1. Add LiveKit Swift SDK via SPM:"
echo "      https://github.com/livekit/client-sdk-swift"
echo ""
echo "   2. Generate a user token for testing:"
echo "      docker run --rm -e LIVEKIT_KEYS=\$LIVEKIT_API_KEY:\$LIVEKIT_API_SECRET \\"
echo "        livekit/livekit-server create-join-token --room vera --identity user"
echo ""
echo "📝 View logs: docker-compose logs -f"
echo "🛑 Stop:      docker-compose down"
