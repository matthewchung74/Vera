"""
Vera Agent - Voice AI Assistant for Elderly Users
Uses LiveKit Agents with Deepgram STT/TTS + Gemini LLM
Now with email search tools!
"""

import logging
import asyncio
import json
import aiohttp
from datetime import datetime, timedelta
from typing import Any, Optional
from dotenv import load_dotenv

from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    function_tool,
    RunContext,
)
from livekit.agents.voice import AgentSession, Agent
from livekit.plugins import google, silero, deepgram
from livekit import rtc

load_dotenv()

logger = logging.getLogger("vera-agent")
logger.setLevel(logging.INFO)

# Vera's base system instructions
VERA_BASE_INSTRUCTIONS = """You are Vera, a warm and helpful voice assistant designed for elderly users.

Your personality:
- Speak clearly and at a moderate pace
- Use simple, direct language
- Be patient and reassuring
- Always confirm you understood before taking action
- If you don't understand, politely ask for clarification

Your capabilities:
- Have natural conversations
- Answer questions
- Provide companionship
- Help with general tasks
- Search and read the user's emails using the tools provided

Important behaviors:
- Keep responses concise but warm
- Don't use technical jargon
- If the user seems confused, offer to repeat or explain differently
- Address the user respectfully
- Never use emojis, asterisks, or complex formatting in your speech

When discussing emails:
- Use the search_emails tool to find specific emails
- Use get_email_details tool to read the full content of an email
- Prioritize emails from family members or about medical appointments
- Warn clearly about any suspicious or scam emails
- Summarize the key point of each email simply
- If asked about "important" emails, search for personal messages, bills, and appointments
"""


class VeraAgent(Agent):
    """Custom Vera agent with email search tools."""

    def __init__(self, gmail_token: str = "", outlook_token: str = ""):
        super().__init__(instructions=VERA_BASE_INSTRUCTIONS)
        self.gmail_token = gmail_token
        self.outlook_token = outlook_token
        self._email_cache = {}  # Cache for email details

    async def on_enter(self):
        """Called when agent becomes active."""
        logger.info("Vera agent entered - waiting before greeting")
        await asyncio.sleep(1.5)
        logger.info("Generating greeting")

        has_email = bool(self.gmail_token or self.outlook_token)
        if has_email:
            self.session.generate_reply(
                instructions="Greet the user warmly. Say 'Hello, I'm Vera. Your email is connected and I can help you search through your messages. How can I help you today?'"
            )
        else:
            self.session.generate_reply(
                instructions="Greet the user warmly. Say 'Hello, I'm Vera. How can I help you today?'"
            )

    async def on_user_turn_completed(self, turn_ctx, new_message):
        """Called after user finishes speaking."""
        logger.info(f"USER SAID: {new_message.text_content}")

    @function_tool()
    async def search_emails(
        self,
        context: RunContext,
        query: str,
        days_back: int = 30,
    ) -> str:
        """Search the user's emails for specific content.

        Args:
            query: Search term like 'Delta flight', 'doctor appointment', 'Amazon', or sender name
            days_back: How many days back to search (default 30)
        """
        logger.info(f"[TOOL] search_emails called: query='{query}', days_back={days_back}")

        results = []

        # Search Gmail
        if self.gmail_token:
            try:
                gmail_results = await self._search_gmail(query, days_back)
                results.extend(gmail_results)
                logger.info(f"[TOOL] Gmail returned {len(gmail_results)} results")
            except Exception as e:
                logger.error(f"[TOOL] Gmail search error: {e}")

        # Search Outlook
        if self.outlook_token:
            try:
                outlook_results = await self._search_outlook(query, days_back)
                results.extend(outlook_results)
                logger.info(f"[TOOL] Outlook returned {len(outlook_results)} results")
            except Exception as e:
                logger.error(f"[TOOL] Outlook search error: {e}")

        if not results:
            if not self.gmail_token and not self.outlook_token:
                return "No email accounts are connected. Please connect Gmail or Outlook in the app settings."
            return f"No emails found matching '{query}' in the last {days_back} days."

        # Format results
        output = f"Found {len(results)} email(s) matching '{query}':\n\n"
        for i, email in enumerate(results[:10], 1):  # Limit to 10 results
            output += f"{i}. From: {email['from']}\n"
            output += f"   Subject: {email['subject']}\n"
            output += f"   Date: {email['date']}\n"
            output += f"   ID: {email['id']}\n\n"
            # Cache for later detail lookup
            self._email_cache[email['id']] = email

        return output

    @function_tool()
    async def get_email_details(
        self,
        context: RunContext,
        email_id: str,
    ) -> str:
        """Get the full content of a specific email.

        Args:
            email_id: The email ID from a previous search result
        """
        logger.info(f"[TOOL] get_email_details called: email_id='{email_id}'")

        # Check cache first
        if email_id in self._email_cache:
            email = self._email_cache[email_id]
            if 'body' in email:
                return f"From: {email['from']}\nSubject: {email['subject']}\nDate: {email['date']}\n\nContent:\n{email['body']}"

        # Fetch from Gmail
        if email_id.startswith('gmail_') and self.gmail_token:
            try:
                email = await self._get_gmail_email(email_id.replace('gmail_', ''))
                if email:
                    return f"From: {email['from']}\nSubject: {email['subject']}\nDate: {email['date']}\n\nContent:\n{email['body']}"
            except Exception as e:
                logger.error(f"[TOOL] Gmail fetch error: {e}")

        # Fetch from Outlook
        if email_id.startswith('outlook_') and self.outlook_token:
            try:
                email = await self._get_outlook_email(email_id.replace('outlook_', ''))
                if email:
                    return f"From: {email['from']}\nSubject: {email['subject']}\nDate: {email['date']}\n\nContent:\n{email['body']}"
            except Exception as e:
                logger.error(f"[TOOL] Outlook fetch error: {e}")

        return f"Could not find email with ID: {email_id}"

    @function_tool()
    async def get_recent_emails(
        self,
        context: RunContext,
        count: int = 5,
    ) -> str:
        """Get the most recent emails from the user's inbox.

        Args:
            count: Number of recent emails to retrieve (default 5, max 10)
        """
        logger.info(f"[TOOL] get_recent_emails called: count={count}")

        count = min(count, 10)  # Cap at 10
        results = []

        # Get from Gmail
        if self.gmail_token:
            try:
                gmail_results = await self._get_recent_gmail(count)
                results.extend(gmail_results)
            except Exception as e:
                logger.error(f"[TOOL] Gmail recent error: {e}")

        # Get from Outlook
        if self.outlook_token:
            try:
                outlook_results = await self._get_recent_outlook(count)
                results.extend(outlook_results)
            except Exception as e:
                logger.error(f"[TOOL] Outlook recent error: {e}")

        if not results:
            if not self.gmail_token and not self.outlook_token:
                return "No email accounts are connected."
            return "No recent emails found."

        # Sort by date and take top N
        results.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
        results = results[:count]

        output = f"Your {len(results)} most recent emails:\n\n"
        for i, email in enumerate(results, 1):
            output += f"{i}. From: {email['from']}\n"
            output += f"   Subject: {email['subject']}\n"
            output += f"   Date: {email['date']}\n\n"
            self._email_cache[email['id']] = email

        return output

    # ==================== Gmail API Methods ====================

    async def _search_gmail(self, query: str, days_back: int) -> list:
        """Search Gmail using the API."""
        after_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y/%m/%d')
        search_query = f"{query} after:{after_date}"

        async with aiohttp.ClientSession() as session:
            # Search for messages
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages"
            params = {"q": search_query, "maxResults": 10}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    logger.error(f"Gmail search failed: {resp.status}")
                    return []
                data = await resp.json()

            messages = data.get("messages", [])
            results = []

            # Fetch details for each message
            for msg in messages[:10]:
                email = await self._get_gmail_message_summary(session, msg["id"])
                if email:
                    results.append(email)

            return results

    async def _get_gmail_message_summary(self, session: aiohttp.ClientSession, msg_id: str) -> dict:
        """Get summary of a Gmail message."""
        url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
        params = {"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]}
        headers = {"Authorization": f"Bearer {self.gmail_token}"}

        async with session.get(url, params=params, headers=headers) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()

        headers_list = data.get("payload", {}).get("headers", [])
        email = {
            "id": f"gmail_{msg_id}",
            "from": "",
            "subject": "",
            "date": "",
            "timestamp": int(data.get("internalDate", 0)) // 1000,
        }

        for h in headers_list:
            if h["name"] == "From":
                email["from"] = h["value"]
            elif h["name"] == "Subject":
                email["subject"] = h["value"]
            elif h["name"] == "Date":
                email["date"] = h["value"]

        return email

    async def _get_gmail_email(self, msg_id: str) -> dict:
        """Get full Gmail message including body."""
        async with aiohttp.ClientSession() as session:
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
            params = {"format": "full"}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()

        headers_list = data.get("payload", {}).get("headers", [])
        email = {"id": f"gmail_{msg_id}", "from": "", "subject": "", "date": "", "body": ""}

        for h in headers_list:
            if h["name"] == "From":
                email["from"] = h["value"]
            elif h["name"] == "Subject":
                email["subject"] = h["value"]
            elif h["name"] == "Date":
                email["date"] = h["value"]

        # Extract body (simplified - handles plain text)
        email["body"] = self._extract_gmail_body(data.get("payload", {}))
        return email

    def _extract_gmail_body(self, payload: dict) -> str:
        """Extract text body from Gmail payload."""
        import base64

        if "body" in payload and payload["body"].get("data"):
            return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="ignore")

        if "parts" in payload:
            for part in payload["parts"]:
                if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
                    return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="ignore")

        return "(Could not extract email body)"

    async def _get_recent_gmail(self, count: int) -> list:
        """Get recent Gmail messages."""
        async with aiohttp.ClientSession() as session:
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages"
            params = {"maxResults": count}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            messages = data.get("messages", [])
            results = []

            for msg in messages:
                email = await self._get_gmail_message_summary(session, msg["id"])
                if email:
                    results.append(email)

            return results

    # ==================== Outlook API Methods ====================

    async def _search_outlook(self, query: str, days_back: int) -> list:
        """Search Outlook using Microsoft Graph API."""
        after_date = (datetime.now() - timedelta(days=days_back)).isoformat() + "Z"

        async with aiohttp.ClientSession() as session:
            url = "https://graph.microsoft.com/v1.0/me/messages"
            params = {
                "$search": f'"{query}"',
                "$filter": f"receivedDateTime ge {after_date}",
                "$top": 10,
                "$select": "id,from,subject,receivedDateTime",
            }
            headers = {"Authorization": f"Bearer {self.outlook_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    logger.error(f"Outlook search failed: {resp.status}")
                    return []
                data = await resp.json()

            results = []
            for msg in data.get("value", []):
                email = {
                    "id": f"outlook_{msg['id']}",
                    "from": msg.get("from", {}).get("emailAddress", {}).get("address", "Unknown"),
                    "subject": msg.get("subject", "(No subject)"),
                    "date": msg.get("receivedDateTime", ""),
                    "timestamp": 0,  # Would need to parse date
                }
                results.append(email)

            return results

    async def _get_outlook_email(self, msg_id: str) -> dict:
        """Get full Outlook message including body."""
        async with aiohttp.ClientSession() as session:
            url = f"https://graph.microsoft.com/v1.0/me/messages/{msg_id}"
            params = {"$select": "id,from,subject,receivedDateTime,body"}
            headers = {"Authorization": f"Bearer {self.outlook_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return None
                msg = await resp.json()

        return {
            "id": f"outlook_{msg_id}",
            "from": msg.get("from", {}).get("emailAddress", {}).get("address", "Unknown"),
            "subject": msg.get("subject", "(No subject)"),
            "date": msg.get("receivedDateTime", ""),
            "body": msg.get("body", {}).get("content", "(No content)"),
        }

    async def _get_recent_outlook(self, count: int) -> list:
        """Get recent Outlook messages."""
        async with aiohttp.ClientSession() as session:
            url = "https://graph.microsoft.com/v1.0/me/messages"
            params = {
                "$top": count,
                "$orderby": "receivedDateTime desc",
                "$select": "id,from,subject,receivedDateTime",
            }
            headers = {"Authorization": f"Bearer {self.outlook_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            results = []
            for msg in data.get("value", []):
                email = {
                    "id": f"outlook_{msg['id']}",
                    "from": msg.get("from", {}).get("emailAddress", {}).get("address", "Unknown"),
                    "subject": msg.get("subject", "(No subject)"),
                    "date": msg.get("receivedDateTime", ""),
                    "timestamp": 0,
                }
                results.append(email)

            return results


async def wait_for_tokens(room, timeout=5.0) -> dict:
    """Wait for OAuth tokens from client metadata."""

    # Check existing participants first
    for participant in room.remote_participants.values():
        if participant.metadata:
            try:
                metadata = json.loads(participant.metadata)
                if "gmail_token" in metadata or "outlook_token" in metadata:
                    logger.info("Found existing token metadata")
                    return metadata
            except json.JSONDecodeError:
                pass

    # Wait for metadata update event
    logger.info("Waiting for token metadata from client...")
    event = asyncio.Event()
    result = {}

    def on_metadata_changed(participant: rtc.Participant, old_metadata: str, new_metadata: str):
        if new_metadata:
            try:
                metadata = json.loads(new_metadata)
                if "gmail_token" in metadata or "outlook_token" in metadata:
                    result.update(metadata)
                    logger.info("Received token metadata from client")
                    event.set()
            except json.JSONDecodeError:
                pass

    room.on("participant_metadata_changed", on_metadata_changed)

    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        logger.info("Timeout waiting for token metadata")

    room.off("participant_metadata_changed", on_metadata_changed)
    return result


async def entrypoint(ctx: JobContext):
    """Main entry point for the Vera voice agent."""

    logger.info(f"Vera agent starting for room: {ctx.room.name}")

    # Wait for participant to connect, then connect to room
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Wait for OAuth tokens from client
    tokens = await wait_for_tokens(ctx.room, timeout=5.0)
    gmail_token = tokens.get("gmail_token", "")
    outlook_token = tokens.get("outlook_token", "")

    logger.info(f"Tokens received - Gmail: {'yes' if gmail_token else 'no'}, Outlook: {'yes' if outlook_token else 'no'}")

    # Create agent session
    session = AgentSession(
        stt=deepgram.STT(
            model="nova-3",
            language="en-US",
        ),
        llm=google.LLM(
            model="gemini-2.0-flash",
            temperature=0.7,
        ),
        tts=deepgram.TTS(
            model="aura-2-thalia-en",
        ),
        vad=silero.VAD.load(),
        turn_detection="vad",
        allow_interruptions=True,
        min_interruption_duration=0.5,
    )

    # Add event handlers for debugging
    @session.on("agent_state_changed")
    def on_agent_state_changed(state):
        logger.info(f">>> Agent state changed: {state}")

    @session.on("error")
    def on_error(error):
        logger.error(f">>> Session error: {error}")

    # Start the session with custom agent
    await session.start(
        room=ctx.room,
        agent=VeraAgent(gmail_token=gmail_token, outlook_token=outlook_token),
    )

    logger.info(f"Vera is now listening with email tools...")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
