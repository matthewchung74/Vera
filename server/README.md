# Vera Server - LiveKit Voice AI Backend

Self-hosted LiveKit server with Gemini 3-powered voice agent for Vera.

## Quick Start

### 1. Generate LiveKit API Keys

```bash
docker run --rm livekit/livekit-server generate-keys
```

Copy the output and save it.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add:
- `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from step 1
- `GOOGLE_API_KEY` - your Gemini API key

### 3. Start Services

```bash
docker-compose up -d
```

This starts:
- **LiveKit Server** on port 7880 (WebSocket) and 7881 (RTC)
- **Vera Agent** - Python voice assistant with Gemini 3
- **Redis** - for job distribution

### 4. Verify

Check logs:
```bash
docker-compose logs -f vera-agent
```

You should see:
```
vera-agent  | INFO: Vera agent starting...
```

## Architecture

```
iOS App (Vera)
     │
     │ WebRTC (with echo cancellation)
     ▼
┌─────────────────┐
│  LiveKit Server │  ◄── Handles all WebRTC, audio routing
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Vera Agent    │  ◄── Python + Gemini 3
│  (LiveKit SDK)  │
└─────────────────┘
```

## iOS App Configuration

Update your iOS app to connect to LiveKit instead of using local SpeechManager:

```swift
// In iOS app, use LiveKit Swift SDK
let room = Room()
try await room.connect(url: "ws://YOUR_SERVER:7880", token: token)
```

## Production Deployment

For production:
1. Use HTTPS/WSS with proper SSL certificates
2. Deploy behind a reverse proxy (nginx, Caddy)
3. Update `LIVEKIT_URL` to your public domain
4. Consider using LiveKit's TURN server for NAT traversal

## Troubleshooting

### Agent not connecting
- Check `LIVEKIT_URL` matches your server
- Verify API keys match between server and agent

### Audio issues
- LiveKit handles echo cancellation automatically via WebRTC
- Check iOS app is publishing audio track correctly

### Logs
```bash
# All services
docker-compose logs -f

# Just agent
docker-compose logs -f vera-agent

# Just server
docker-compose logs -f livekit-server
```
