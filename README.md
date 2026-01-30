# Vera - Voice AI Assistant for Elderly Users

A voice-first AI assistant designed to help elderly users manage their emails through natural conversation. Built with **Gemini 3** for the Google Gemini 3 Hackathon.

## Why Vera?

My mom loves technology but when it comes to using it, she's unsure which button to press, and scam or malicious emails scare her. Vera removes the button barrier and puts her mind at ease when a scary email comes in.

Instead of navigating complex email interfaces, she simply talks to Vera:

> "Vera, do I have any important emails?"
>
> "You have one email from your daughter Sarah about Thanksgiving, and a reminder about your doctor's appointment on Friday. Would you like me to read them?"

## Features

- **Natural Voice Conversation** - Speak naturally, Vera understands context
- **Email Management** - Search, read, reply, forward, and compose emails (Gmail & Outlook)
- **Scam Protection** - Proactive warnings about suspicious emails
- **Smart Prioritization** - Family messages, medical appointments, and bills highlighted first
- **Reconnection Memory** - Remembers conversation context if connection drops
- **Web Search** - Current weather, news, stock prices via Google Search
- **Attachment Reading** - Can read PDFs and text files aloud

## Gemini 3 Integration

Vera is powered by **Gemini 3 Flash** with native tool use:

| Capability | Gemini 3 Feature |
|------------|------------------|
| Natural conversation | Gemini 3 LLM with low temperature for consistent responses |
| Web search | `google.tools.GoogleSearch()` - native provider tool |
| Calculations | `google.tools.ToolCodeExecution()` - Python execution |
| Email tools | Custom function tools for Gmail/Outlook APIs |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Mobile App (React Native / Expo)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ OAuth        │  │ Email        │  │   LiveKit        │   │
│  │ (Gmail/MSFT) │  │ Service      │  │ (Voice + WebRTC) │   │
│  └──────────────┘  └──────────────┘  └────────┬─────────┘   │
└───────────────────────────────────────────────┼─────────────┘
                                                │
                                    WebRTC (Echo Cancellation)
                                                │
┌───────────────────────────────────────────────┼─────────────┐
│                     Server (Docker)           ▼             │
│  ┌──────────────┐              ┌────────────────────────┐   │
│  │LiveKit Server│◄────────────►│   Vera Agent (Python)  │   │
│  │  (WebRTC)    │              │   + Gemini 3 Flash     │   │
│  └──────────────┘              └────────────────────────┘   │
│                                         │                   │
│  ┌──────────────┐                       │                   │
│  │    Redis     │◄──────────────────────┘                   │
│  │ (Sessions)   │   Reconnection memory                     │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- Google API Key with Gemini 3 access
- Deepgram API Key (for STT/TTS)

### 1. Start the Server

```bash
cd server
cp .env.example .env
# Edit .env with your API keys
docker compose up -d
```

### 2. Run the Mobile App

```bash
cd vera-mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios
```

## Project Structure

```
Vera/
├── server/               # Backend (Docker)
│   ├── docker-compose.yml
│   ├── livekit.yaml      # LiveKit config
│   └── agent/
│       └── vera_agent.py # Voice agent + Gemini 3
│
└── vera-mobile/          # React Native (Expo) app
    └── app/
```

## Email Tools

Vera provides these email capabilities via Gemini 3 function calling:

| Tool | Description |
|------|-------------|
| `search_emails` | Find emails by sender, subject, or content |
| `get_email_details` | Read full email content |
| `compose_email` | Write and send new emails |
| `reply_to_email` | Reply to existing emails |
| `forward_email` | Forward emails with attachments |
| `mark_email_spam` | Move suspicious emails to junk |
| `get_email_attachments` | Read PDF/text attachments |
| `remember_contact` | Save contacts for quick lookup |

## Safety Features

- **Scam detection** - Warns about phishing, money requests, urgency tactics
- **Confirmation required** - Always reads drafts back before sending
- **Simple language** - No technical jargon (no "URL", "auth", "2FA")
- **Interruption support** - Stops immediately when user speaks

## Documentation

- [Server Setup](server/README.md) - Backend deployment guide
- [Mobile App](vera-mobile/README.md) - React Native app details

## Tech Stack

- **LLM**: Gemini 3 Flash (`gemini-3-flash-preview`)
- **STT**: Deepgram Nova 3
- **TTS**: Deepgram Aura 2 (Thalia voice)
- **Voice**: LiveKit Agents SDK
- **Mobile**: React Native (Expo)
- **Session Storage**: Redis

## Roadmap

- Inline phishing/"risky sender" warnings before reading suspicious emails
- Voice-driven calendar and task actions
- Offline triage mode with on-device summaries

## License

MIT

---

Built for the [Gemini 3 Hackathon](https://ai-futures-hackathon.devpost.com/) - February 2026
