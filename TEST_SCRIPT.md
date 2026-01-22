# Vera End-to-End Test Script

## Prerequisites
- [ ] Server running: `cd server && docker compose up -d`
- [ ] App running in simulator: `cd vera-mobile && npx expo run:ios`
- [ ] At least one email account connected (Gmail or Outlook)

---

## Test 1: Basic Connection
**Goal:** Verify Vera connects and greets properly

1. Open the app
2. Tap the orb to connect
3. Wait for connection

**Expected:**
- Status shows "Connected" (green dot)
- Vera says: "Hello, I'm Vera. How can I help you today?"
- No cutting off mid-sentence

**Pass:** [ ] Yes  [ ] No

---

## Test 2: Token Passing
**Goal:** Verify email tokens are passed to agent

1. Check Docker logs: `docker logs server-vera-agent-1 --tail 20`

**Expected log entries:**
```
Tokens received - Gmail: yes, Outlook: yes  (or whichever is connected)
```

**Pass:** [ ] Yes  [ ] No

---

## Test 3: List Recent Emails
**Goal:** Verify Vera can list emails

1. Say: "What are my recent emails?"

**Expected:**
- Vera lists 5 recent emails with sender and subject
- Does NOT read email IDs out loud
- Offers to read any of them

**Pass:** [ ] Yes  [ ] No

---

## Test 4: Search Emails
**Goal:** Verify email search works

1. Say: "Do I have any emails from [known sender]?"
   (Use a sender you know is in your inbox, e.g., "Amazon", "Robinhood", a family member)

**Expected:**
- Vera searches and reports results
- If found, lists matching emails
- If not found, says no matches in last 30 days

**Pass:** [ ] Yes  [ ] No

---

## Test 5: Read Specific Email
**Goal:** Verify Vera can read email content

1. After listing emails, say: "Read me the first one" or "Tell me more about the [subject] email"

**Expected:**
- Vera fetches full email content
- Summarizes the key points clearly
- Does NOT read technical details like email IDs

**Pass:** [ ] Yes  [ ] No

---

## Test 6: Interruption Handling
**Goal:** Verify Vera stops when interrupted

1. Ask Vera a question that will generate a long response
2. Interrupt her mid-sentence by speaking

**Expected:**
- Vera stops speaking within ~1.5 seconds
- Listens to your interruption
- Responds to the new input

**Pass:** [ ] Yes  [ ] No

---

## Test 7: No Email Access
**Goal:** Verify graceful handling when no tokens

1. Disconnect email accounts in admin page
2. Reconnect to Vera
3. Say: "What are my emails?"

**Expected:**
- Vera explains she cannot access email
- Suggests connecting accounts in settings

**Pass:** [ ] Yes  [ ] No

---

## Test 8: Scam Detection (if applicable)
**Goal:** Verify Vera warns about suspicious emails

1. If you have any spam/phishing emails, ask Vera to read them

**Expected:**
- Vera warns clearly: "This looks like a trick" or similar
- Advises not to click or respond

**Pass:** [ ] Yes  [ ] No

---

## Quick Log Commands

```bash
# Watch agent logs in real-time
docker logs -f server-vera-agent-1

# Check recent agent activity
docker logs server-vera-agent-1 --tail 50

# Check app logs (Metro bundler output)
# Look at the terminal running `npx expo run:ios`
```

---

## Results Summary

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| 1. Connection | | |
| 2. Token Passing | | |
| 3. List Emails | | |
| 4. Search Emails | | |
| 5. Read Email | | |
| 6. Interruption | | |
| 7. No Access | | |
| 8. Scam Detection | | |
