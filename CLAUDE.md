# Vera - Voice AI for Elderly Users

## Gemini 3 Hackathon Requirements (CRITICAL)

**Deadline: February 9, 2026 at 5:00 PM PST**

### Judging Criteria
| Criteria | Weight | Focus |
|----------|--------|-------|
| Technical Execution | 40% | Quality development, Gemini 3 leverage, code functionality |
| Innovation/Wow Factor | 30% | Originality and novel problem-solving |
| Potential Impact | 20% | Real-world usefulness and market significance |
| Presentation/Demo | 10% | Clear problem definition and effective communication |

### Submission Requirements
- [ ] Text description (~200 words) explaining Gemini 3 feature integration
- [ ] Public project link (working product or interactive demo)
- [ ] Public code repository
- [ ] Demo video (~3 minutes max)

### Technology Mandate
- **MUST use Gemini 3 API** - central to functionality
- Application must be entirely NEW (no existing applications)
- No category restrictions (games, productivity, scientific, etc.)

### Prize Pool: $100,000
- Grand Prize: $50,000 + AI Futures Fund interview
- Second Place: $20,000 + interview
- Third Place: $10,000 + interview
- 10 Honorable Mentions: $2,000 each

---

## Project Overview

Vera is a voice AI assistant that helps elderly users (primarily an 88-year-old woman with hearing loss) manage emails through natural conversation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Mobile App (React Native / Expo)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ authService  │  │ emailService │  │   useLiveKit     │   │
│  │ (OAuth)      │  │ (Gmail/MSFT) │  │ (Voice + WebRTC) │   │
│  └──────────────┘  └──────────────┘  └────────┬─────────┘   │
└───────────────────────────────────────────────┼─────────────┘
                                                │
                                    WebRTC (Echo Cancellation)
                                                │
┌───────────────────────────────────────────────┼─────────────┐
│                     Server (Docker)           ▼             │
│  ┌──────────────┐              ┌────────────────────────┐   │
│  │LiveKit Server│◄────────────►│   Vera Agent (Python)  │   │
│  │  (WebRTC)    │              │   + Gemini 3 LLM       │   │
│  └──────────────┘              └────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
Vera/
├── vera-mobile/          # React Native (Expo) app
│   ├── app/              # Screens (Expo Router)
│   └── src/
│       ├── components/   # VADOrb
│       ├── services/     # Auth, Email, Token
│       └── hooks/        # useLiveKit
│
├── server/               # Backend (Docker)
│   ├── docker-compose.yml
│   ├── livekit.yaml      # LiveKit config
│   └── agent/
│       └── vera_agent.py # Python voice agent + Gemini 3
```

## Running

### 1. Start Server
```bash
cd server && docker compose up -d
```

### 2. Run Mobile App
```bash
cd vera-mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios
```

---

## Vera AI Personality

**Role:** Protective, calm, and clear digital companion for an 88-year-old woman with hearing loss and technology anxiety.

**Voice & Tone:**
- Speak simply. Use short sentences.
- Never use technical jargon (No: "URL," "Browser," "Auth," "2FA")
- Use: "Website," "Internet," "Security Code"
- Tone: Warm, patient, slow, and authoritative on safety
- If she interrupts, stop immediately

**Core Mission:**
1. **Filter Noise:** Only tell her about personal family emails, unpaid bills, or medical appointments
2. **Protect:** If you see a scam, be firm: "This is a trick. Do not click."
3. **Clarify:** Summarize the bottom line: "Do I owe money?" or "Is this for me?"

**Colors:**
- RED = Scam/Warning
- GREEN = Family
- YELLOW = Bills
