# Vera Mobile (React Native / Expo)

Voice AI assistant for elderly users. Built with Expo and LiveKit.

## Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`
- Xcode (for iOS) / Android Studio (for Android)
- Docker (for the backend server)

## Quick Start

### 1. Install Dependencies

```bash
cd vera-mobile
npm install
```

### 2. Start the Backend Server

```bash
cd ../server
./setup.sh
```

This starts LiveKit Server + Vera Agent. See `../server/README.md`.

### 3. Build the Development Client

LiveKit requires native modules, so you need a custom dev client (not Expo Go).

```bash
# For iOS
npx expo prebuild --platform ios
npx expo run:ios

# For Android
npx expo prebuild --platform android
npx expo run:android
```

Or use EAS Build:
```bash
eas build --profile development --platform ios
```

### 4. Run the App

Once you have the dev client installed:
```bash
npm start
```

Scan the QR code with your dev client app.

## Project Structure

```
vera-mobile/
├── app/                    # Expo Router screens
│   ├── _layout.tsx        # Root layout
│   ├── index.tsx          # Home screen
│   └── admin.tsx          # Admin panel
├── src/
│   ├── components/        # UI components
│   │   ├── VADOrb.tsx    # Voice activity indicator
│   │   └── CameraPreview.tsx
│   ├── services/          # API services
│   │   ├── authService.ts    # OAuth (Gmail/Outlook)
│   │   ├── emailService.ts   # Email API calls
│   │   └── tokenService.ts   # LiveKit tokens
│   ├── hooks/
│   │   └── useLiveKit.ts # LiveKit connection hook
│   └── store/
│       └── veraStore.ts  # Zustand state
├── app.json              # Expo config
└── package.json
```

## Configuration

### LiveKit Server URL

Edit `src/hooks/useLiveKit.ts`:
```typescript
const LIVEKIT_URL = __DEV__
  ? 'ws://localhost:7880'      // Local development
  : 'wss://your-server.com';   // Production
```

### OAuth Credentials

The Gmail and Outlook OAuth credentials are in `src/services/authService.ts`.
Update these with your own from Google Cloud Console and Azure.

## Features

- **Voice AI**: Natural conversation via LiveKit + Gemini 3
- **Echo Cancellation**: Handled automatically by WebRTC
- **Email Integration**: Gmail and Outlook via OAuth
- **Large UI**: Designed for elderly users with vision/hearing challenges
- **Camera**: For document reading (future feature)

## Troubleshooting

### "LiveKit SDK not found"
Make sure you've run `npx expo prebuild` and built the dev client.
LiveKit requires native modules that aren't in Expo Go.

### Connection failed
1. Check the backend is running: `docker-compose ps`
2. Verify the LiveKit URL matches your server
3. Generate a fresh token if needed

### OAuth not working
1. Check redirect URIs match in Google Cloud Console / Azure
2. Verify the scheme in `app.json` matches your OAuth config
