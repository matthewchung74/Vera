# Vera iOS - Native Swift Voice AI

Native iOS app for Vera, the voice AI assistant for elderly users. Built with SwiftUI and LiveKit.

## Prerequisites

1. **Server running**: Make sure the LiveKit server and Vera agent are running:
   ```bash
   cd ../server && docker compose up -d
   ```

2. **Xcode 15+** installed

## Quick Start

1. **Open the project in Xcode**:
   ```bash
   open VoiceAgent.xcodeproj
   ```

2. **Select your target device** (iPhone recommended for microphone)

3. **Run the app** (Cmd+R)

4. **Tap "Talk to Vera"** to start a conversation

## Configuration

### Local Development (Default)
The app connects to `http://localhost:8080/token` by default. This works when:
- Running on iOS Simulator (localhost maps to your Mac)
- Running on a device on the same network (update URL to your Mac's IP)

### For Physical Device Testing
Edit `VoiceAgentApp.swift` and change the token server URL to your Mac's local IP:
```swift
private static let tokenServerURL = URL(string: "http://192.168.x.x:8080/token")!
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Vera iOS (This App)             │
│  ┌─────────────────────────────────┐    │
│  │     LiveKit Swift SDK           │    │
│  │  - WebRTC audio (echo cancel)   │    │
│  │  - Real-time voice streaming    │    │
│  └─────────────────────────────────┘    │
└──────────────────┬──────────────────────┘
                   │ WebRTC
                   ▼
┌──────────────────────────────────────────┐
│           Server (Docker)                │
│  ┌────────────┐  ┌───────────────────┐   │
│  │  LiveKit   │◄►│   Vera Agent      │   │
│  │  Server    │  │ + Gemini 3 Flash  │   │
│  └────────────┘  └───────────────────┘   │
└──────────────────────────────────────────┘
```

## Files

- `VoiceAgentApp.swift` - App entry point, LiveKit session configuration
- `VoiceAgent/App/` - Main views (StartView, AppView)
- `VoiceAgent/Media/AgentView.swift` - Audio visualizer for Vera's voice
- `VoiceAgent/Localizable.xcstrings` - UI text (customized for Vera)

## Features

This app uses LiveKit's Swift SDK with:
- **Voice input** - Speak to Vera using your microphone
- **Audio visualizer** - See when Vera is listening or speaking
- **Echo cancellation** - Built-in WebRTC audio processing
- **Background audio** - Continues working when app is backgrounded

Video and text input are disabled by default (voice-only for simplicity).

## Troubleshooting

### "Connection failed"
- Ensure server is running: `docker compose ps`
- Check token server: `curl http://localhost:8080/token?identity=test&room=vera-room`

### No audio on Simulator
- iOS Simulator can use Mac's microphone
- Grant microphone permission when prompted
- For best results, use a physical iPhone

### App crashes on launch
- Clean build folder (Cmd+Shift+K)
- Delete derived data and rebuild

## Based on LiveKit Template

This app is based on the [LiveKit agent-starter-swift](https://github.com/livekit-examples/agent-starter-swift) template, customized for Vera.
