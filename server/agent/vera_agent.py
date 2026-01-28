"""
Vera Agent - Voice AI Assistant for Elderly Users
Uses LiveKit Agents with Deepgram STT/TTS + Gemini LLM
Now with email search tools!
"""

import logging
import asyncio
import json
import time
import uuid
import re
import base64
import aiohttp
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
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
from livekit.agents.voice import AgentSession, Agent, room_io
from livekit.plugins import google, silero, deepgram
from livekit import rtc

load_dotenv()

logger = logging.getLogger("vera-agent")
logger.setLevel(logging.INFO)

# Kin terms for contact resolution
KIN_TERMS = {"mom", "mother", "dad", "father", "daughter", "son", "sister", "brother",
             "grandma", "grandpa", "grandmother", "grandfather", "husband", "wife",
             "aunt", "uncle", "cousin", "niece", "nephew"}

# Cache TTL for email cache
CACHE_TTL_MINUTES = 10

# Attachment limits
MAX_ATTACHMENT_SIZE_MB = 5
MAX_FORWARD_SIZE_MB = 10
MAX_PDF_PAGES = 5
MAX_PDF_WORDS = 2000
ATTACHMENT_TIMEOUT_SECONDS = 10

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
- Compose and send new emails using compose_email tool
- Reply to emails using reply_to_email tool
- Forward emails using forward_email tool
- Mark emails as spam using mark_email_spam tool
- Read attachments using get_email_attachments tool
- Remember contacts using remember_contact tool

Important behaviors:
- Keep responses concise but warm
- Don't use technical jargon
- If the user seems confused, offer to repeat or explain differently
- Address the user respectfully
- Never use emojis, asterisks, or complex formatting in your speech
- NEVER read out loud any technical details like email IDs, codes, or system information
- When listing emails, just say the sender and subject - never mention the email ID

When discussing emails:
- Use the search_emails tool to find specific emails
- Use get_email_details tool to read the full content of an email (use the email ID internally, never say it out loud)
- Prioritize emails from family members or about medical appointments
- Warn clearly about any suspicious or scam emails
- Summarize the key point of each email simply
- If asked about "important" emails, search for personal messages, bills, and appointments
- When the user asks to read a specific email, use the Email ID from the tool results to call get_email_details

SENDING GUARDRAILS (critical):
- When composing, replying or forwarding: ALWAYS read the draft back to the user
- Ask "Send it?" and wait for explicit confirmation ("yes", "send it", "go ahead")
- If user says "no", "change", or "cancel" - stop and ask what they want instead
- NEVER send without explicit user confirmation

COMPOSE RULES:
- When user says "send an email to X" or "write an email to X", use compose_email tool
- No attachments supported for new emails - say "I can't attach files to new emails yet" if asked
- Empty subject: ask "You didn't give me a subject. Send anyway?"
- Empty message: ask "The message is empty. Send anyway?"
- Always confirm recipient, subject, and message preview before sending

REPLY RULES:
- Replies do NOT include attachments unless user explicitly says "include the attachments"
- Include quoted original text in the reply

FORWARD RULES:
- Forwards INCLUDE all attachments by default
- If total attachment size exceeds 10 MB, list the large files and ask "Should I skip these large files?"
- Always confirm recipient before sending

ATTACHMENT READING:
- You can only read PDFs and plain text files (.txt)
- For PDFs: limit to first 5 pages or about 2,000 words
- Maximum file size: 5 MB
- For other file types (Word, Excel, images, ZIP): say "I can't read this type of file. Want me to forward it to someone who can?"
- If a file is too large or fails to read: "That file was too large to read safely. Want me to forward it instead?"

CONTACT RESOLUTION:
- If a recipient name isn't in my memory, ask: "I don't have [name]'s email. What is it?"
- If multiple contacts match (e.g., two Sarahs), ask: "Which one? Sarah Jones or Sarah Kim?"
- After learning a new contact, ask: "Want me to remember this for next time?"

EMAIL REFERENCE HANDLING:
- If the user refers to an email that isn't in my recent results, ask: "I need to look that up. Should I search your recent messages?"
- NEVER guess which email or contact the user means - always confirm or search again

SPAM AND SCAM SAFETY:
- If a message looks suspicious (unknown sender asking for money, urgent threats, too-good-to-be-true offers), proactively suggest: "This looks like it might be a scam. Want me to move it to junk?"
- Wait for user confirmation before marking as spam
"""


class VeraAgent(Agent):
    """Custom Vera agent with email search tools."""

    def __init__(self, gmail_token: str = "", outlook_token: str = "", room: Optional[rtc.Room] = None):
        super().__init__(instructions=VERA_BASE_INSTRUCTIONS)
        self.gmail_token = gmail_token
        self.outlook_token = outlook_token
        self._email_cache = {}  # Cache for email details
        self._cache_timestamp = None  # When cache was last populated
        self._contacts = {}  # Session contacts: {"sarah": "sarah@gmail.com"}
        self._kin_map = {}  # Relation → name: {"daughter": "sarah", "mom": "mary"}
        self._room = room
        self._published_texts = set()  # Track published transcripts to avoid dupes

    def _learn_contact_from_email(self, from_field: str) -> None:
        """Auto-learn contact from email 'From' field like 'Karen Smith <karen@gmail.com>'."""
        if not from_field:
            return

        import re
        # Parse "Name <email>" or just "email"
        match = re.match(r'^([^<]+?)\s*<([^>]+)>$', from_field.strip())
        if match:
            name = match.group(1).strip().strip('"\'')
            email = match.group(2).strip().lower()
        else:
            # Just an email address
            email = from_field.strip().lower()
            # Extract name from email (before @)
            name = email.split('@')[0].replace('.', ' ').replace('_', ' ').title()

        if not name or not email:
            return

        # Normalize name for lookup
        normalized = self._normalize_name(name)

        # Also store first name only for easier lookup
        first_name = normalized.split()[0] if ' ' in normalized else normalized

        # Don't overwrite existing contacts
        if normalized not in self._contacts:
            self._contacts[normalized] = email
            logger.info(f"[CONTACTS] Auto-learned: {normalized} -> {email}")

        if first_name != normalized and first_name not in self._contacts:
            self._contacts[first_name] = email
            logger.info(f"[CONTACTS] Auto-learned (first name): {first_name} -> {email}")

    async def _publish_transcript(self, transcript_type: str, text: str) -> None:
        """Publish transcript message to clients via data channel."""
        if not self._room or not self._room.local_participant:
            logger.warning("[TRANSCRIPT] No room or local participant, skipping publish")
            return

        # Sanitize text - remove any technical IDs (gmail_xxx, outlook_xxx patterns)
        sanitized_text = re.sub(r'(gmail_|outlook_)[A-Za-z0-9_-]+', '[email]', text)

        # Truncate if needed (keep under 1KB for reliability)
        if len(sanitized_text) > 900:
            sanitized_text = sanitized_text[:897] + "..."

        # Dedupe - avoid publishing same text multiple times
        text_hash = hash(f"{transcript_type}:{sanitized_text[:100]}")
        if text_hash in self._published_texts:
            logger.info(f"[TRANSCRIPT] Skipping duplicate: {sanitized_text[:30]}...")
            return
        self._published_texts.add(text_hash)
        # Keep set bounded to avoid memory leak
        if len(self._published_texts) > 100:
            self._published_texts.clear()

        timestamp = int(time.time() * 1000)
        msg_id = f"{timestamp}-{transcript_type[:4]}-{uuid.uuid4().hex[:4]}"

        payload = {
            "id": msg_id,
            "type": f"{transcript_type}_transcript",
            "text": sanitized_text,
            "timestamp": timestamp,
        }

        try:
            data = json.dumps(payload).encode('utf-8')
            await self._room.local_participant.publish_data(
                data,
                reliable=True,
                topic="transcript"
            )
            logger.info(f"[TRANSCRIPT] Published {transcript_type}: {sanitized_text[:50]}...")
        except Exception as e:
            logger.error(f"[TRANSCRIPT] Failed to publish: {e}")

    async def _publish_attachment(self, attachment: dict) -> None:
        """Publish attachment metadata to clients via data channel.

        Args:
            attachment: dict with keys:
                - id: unique attachment ID
                - name: filename
                - mimeType: MIME type
                - size: size in bytes
                - dataAvailable: bool indicating if data is included
                - data: base64-encoded content (optional, for small files)
        """
        if not self._room or not self._room.local_participant:
            logger.warning("[ATTACHMENT] No room or local participant, skipping publish")
            return

        timestamp = int(time.time() * 1000)
        has_data = attachment.get("data") and len(attachment.get("data", "")) < 1024 * 1024

        payload = {
            "id": attachment.get("id", f"att_{uuid.uuid4().hex[:8]}"),
            "type": "attachment",
            "name": attachment.get("name", "unknown"),
            "mimeType": attachment.get("mimeType", "application/octet-stream"),
            "size": attachment.get("size", 0),
            "timestamp": timestamp,
            "dataAvailable": has_data,  # True only if data is actually included
        }

        # Include base64 data if provided and not too large (< 1MB)
        if has_data:
            payload["data"] = attachment["data"]

        try:
            data = json.dumps(payload).encode('utf-8')
            await self._room.local_participant.publish_data(
                data,
                reliable=True,
                topic="attachment"
            )
            logger.info(f"[ATTACHMENT] Published: {payload['name']} ({payload['size']} bytes, dataAvailable={has_data})")
        except Exception as e:
            logger.error(f"[ATTACHMENT] Failed to publish: {e}")

    # ==================== Contact & Cache Helpers ====================

    def _normalize_name(self, name: str) -> str:
        """Lowercase, strip punctuation."""
        return re.sub(r'[^\w\s]', '', name.lower()).strip()

    def _resolve_contact(self, ref: str) -> Optional[str]:
        """'my daughter' or 'sarah' → email address.
        Returns None if not found, 'AMBIGUOUS:name1,name2' if multiple matches."""
        normalized = self._normalize_name(ref)

        # Strip "my " prefix
        if normalized.startswith("my "):
            normalized = normalized[3:]

        # Check kin map first: "daughter" → "sarah" → email
        if normalized in self._kin_map:
            name = self._kin_map[normalized]
            if name in self._contacts:
                return self._contacts[name]

        # Direct name lookup
        if normalized in self._contacts:
            return self._contacts[normalized]

        # Partial match handling
        matches = [k for k in self._contacts if normalized in k or k in normalized]
        if len(matches) == 1:
            return self._contacts[matches[0]]
        if len(matches) > 1:
            return f"AMBIGUOUS:{','.join(matches)}"  # Signal to ask user

        return None

    async def _search_for_contact(self, name: str) -> Optional[str]:
        """Search past emails to find someone's email address.
        Returns email if found, None otherwise."""
        logger.info(f"[CONTACTS] Searching for contact: {name}")

        # Search for emails from this person
        search_query = f"from:{name}"
        results = []

        # Try Gmail
        if self.gmail_token:
            try:
                gmail_results, _ = await self._search_gmail(search_query, days_back=365)
                results.extend(gmail_results)
            except Exception as e:
                logger.error(f"[CONTACTS] Gmail search failed: {e}")

        # Try Outlook
        if self.outlook_token:
            try:
                outlook_results, _ = await self._search_outlook(name, days_back=365)
                results.extend(outlook_results)
            except Exception as e:
                logger.error(f"[CONTACTS] Outlook search failed: {e}")

        # Check if we learned the contact from the search results
        normalized = self._normalize_name(name)
        if normalized in self._contacts:
            logger.info(f"[CONTACTS] Found {name} -> {self._contacts[normalized]}")
            return self._contacts[normalized]

        # Also check first name
        first_name = normalized.split()[0] if ' ' in normalized else normalized
        if first_name in self._contacts:
            logger.info(f"[CONTACTS] Found {name} via first name -> {self._contacts[first_name]}")
            return self._contacts[first_name]

        logger.info(f"[CONTACTS] Could not find contact: {name}")
        return None

    def _is_cache_expired(self) -> bool:
        """Check if email cache has expired."""
        if not self._cache_timestamp:
            return True
        return (time.time() - self._cache_timestamp) > (CACHE_TTL_MINUTES * 60)

    def _clear_cache_if_expired(self):
        """Clear email cache if TTL has passed."""
        if self._is_cache_expired():
            self._email_cache = {}
            self._cache_timestamp = None

    def _resolve_email_ref(self, email_ref: str) -> Optional[dict]:
        """Resolve email reference to cached email dict.
        Returns None if not found in cache."""
        self._clear_cache_if_expired()

        email_id = email_ref.strip()

        # Handle number references
        number_words = {"first": "1", "second": "2", "third": "3", "fourth": "4", "fifth": "5",
                        "1st": "1", "2nd": "2", "3rd": "3", "4th": "4", "5th": "5",
                        "sixth": "6", "seventh": "7", "eighth": "8", "ninth": "9", "tenth": "10"}
        if email_id.lower() in number_words:
            email_id = f"#{number_words[email_id.lower()]}"
        elif email_id.isdigit():
            email_id = f"#{email_id}"
        elif email_id.startswith("#") and email_id[1:].isdigit():
            pass  # Already in correct format

        # Check cache
        if email_id in self._email_cache:
            email = self._email_cache[email_id]
            # If this is a shortcut (#1, #2), return the actual email
            if isinstance(email, dict):
                return email

        # Check direct ID lookup
        if email_ref.startswith('gmail_') or email_ref.startswith('outlook_'):
            if email_ref in self._email_cache:
                return self._email_cache[email_ref]

        return None

    async def on_enter(self):
        """Called when agent becomes active."""
        logger.info("Vera agent entered - waiting before greeting")
        await asyncio.sleep(1.5)
        logger.info("Speaking greeting directly")

        # Direct speech output - not LLM generated, prevents proactive additions
        # Disable interruptions for greeting to prevent echo from cutting it off
        await self.session.say("Hello, I'm Vera. How can I help you today?", allow_interruptions=False)

    async def on_user_turn_completed(self, turn_ctx, new_message):
        """Called after user finishes speaking."""
        text = new_message.text_content or ""
        logger.info(f"[{datetime.now().strftime('%H:%M:%S')}] USER: {text}")
        # Note: Don't publish custom transcript - LiveKit handles it via TranscriptionReceived

    async def on_agent_speech_committed(self, message):
        """Called when agent finishes speaking - log what Vera said."""
        text = message.text_content or ""
        logger.info(f"[{datetime.now().strftime('%H:%M:%S')}] VERA: {text}")
        # Note: Don't publish custom transcript - LiveKit handles it via TranscriptionReceived

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
        gmail_auth_failed = False
        outlook_auth_failed = False

        # Search Gmail
        if self.gmail_token:
            try:
                gmail_results, auth_ok = await self._search_gmail(query, days_back)
                if auth_ok:
                    results.extend(gmail_results)
                    logger.info(f"[TOOL] Gmail returned {len(gmail_results)} results")
                else:
                    gmail_auth_failed = True
                    logger.error("[TOOL] Gmail authentication failed (401)")
            except Exception as e:
                logger.error(f"[TOOL] Gmail search error: {e}")

        # Search Outlook
        if self.outlook_token:
            try:
                outlook_results, auth_ok = await self._search_outlook(query, days_back)
                if auth_ok:
                    results.extend(outlook_results)
                    logger.info(f"[TOOL] Outlook returned {len(outlook_results)} results")
                else:
                    outlook_auth_failed = True
                    logger.error("[TOOL] Outlook authentication failed (401)")
            except Exception as e:
                logger.error(f"[TOOL] Outlook search error: {e}")

        # Handle auth failures - be clear with user
        if gmail_auth_failed and outlook_auth_failed:
            return "I cannot access your email right now. Your email connections have expired. Please go to the settings in the app and reconnect your Gmail and Outlook accounts."
        if gmail_auth_failed and not self.outlook_token:
            return "I cannot access your Gmail right now. The connection has expired. Please go to the settings in the app and reconnect your Gmail account."
        if outlook_auth_failed and not self.gmail_token:
            return "I cannot access your Outlook right now. The connection has expired. Please go to the settings in the app and reconnect your Outlook account."

        if not results:
            if not self.gmail_token and not self.outlook_token:
                return "No email accounts are connected. Please connect Gmail or Outlook in the app settings."

            # Build message about which accounts were searched
            searched = []
            if self.gmail_token and not gmail_auth_failed:
                searched.append("Gmail")
            if self.outlook_token and not outlook_auth_failed:
                searched.append("Outlook")

            if not searched:
                return "I cannot access any email accounts right now. Please reconnect them in the app settings."

            return f"I searched your {' and '.join(searched)} but found no emails matching '{query}' in the last {days_back} days."

        # Format results - IDs are for internal tool use only, never spoken aloud
        # Clear old cache and set new timestamp
        self._email_cache = {}
        self._cache_timestamp = time.time()

        output = f"Found {len(results)} email(s) matching '{query}':\n\n"
        for i, email in enumerate(results[:10], 1):  # Limit to 10 results
            output += f"{i}. From: {email['from']}\n"
            output += f"   Subject: {email['subject']}\n"
            output += f"   Date: {email['date']}\n"
            # Cache for later detail lookup
            self._email_cache[email['id']] = email
            # Store mapping from list number to ID for easy reference
            self._email_cache[f"#{i}"] = email

        output += "(To read an email, use the number like 'read email 1' or 'the first one')"
        return output

    @function_tool()
    async def get_email_details(
        self,
        context: RunContext,
        email_ref: str,
    ) -> str:
        """Get the full content of a specific email.

        Args:
            email_ref: Reference to the email. Can be:
                       - A number from the list (e.g., "1", "2", "3")
                       - Words like "first", "second", "third"
                       - The full email ID if known
        """
        logger.info(f"[TOOL] get_email_details called: email_ref='{email_ref}'")
        logger.info(f"[TOOL] Cache has {len(self._email_cache)} items")

        # Convert reference to cache key
        email_id = email_ref.strip()

        # Handle number references
        number_words = {"first": "1", "second": "2", "third": "3", "fourth": "4", "fifth": "5",
                        "1st": "1", "2nd": "2", "3rd": "3", "4th": "4", "5th": "5"}
        if email_id.lower() in number_words:
            email_id = f"#{number_words[email_id.lower()]}"
        elif email_id.isdigit():
            email_id = f"#{email_id}"
        elif email_id.startswith("#") and email_id[1:].isdigit():
            pass  # Already in correct format

        logger.info(f"[TOOL] Resolved to cache key: {email_id}")

        # Check cache first
        if email_id in self._email_cache:
            email = self._email_cache[email_id]
            logger.info(f"[TOOL] Found in cache: {email.get('subject', 'no subject')}")
            if 'body' in email:
                body_preview = email['body'][:200] if email['body'] else 'empty'
                logger.info(f"[TOOL] Returning cached email, body preview: {body_preview}")
                return f"From: {email['from']}\nSubject: {email['subject']}\nDate: {email['date']}\n\nContent:\n{email['body']}"
            # No body yet - use the actual email ID to fetch full content
            actual_id = email.get('id', '')
            if actual_id:
                logger.info(f"[TOOL] No body in cache, fetching with actual ID: {actual_id}")
                email_id = actual_id

        # Fetch from Gmail
        if email_id.startswith('gmail_') and self.gmail_token:
            logger.info(f"[TOOL] Fetching from Gmail API...")
            try:
                email = await self._get_gmail_email(email_id.replace('gmail_', ''))
                if email:
                    body_preview = email.get('body', '')[:200] if email.get('body') else 'empty'
                    logger.info(f"[TOOL] Gmail returned email, body preview: {body_preview}")
                    return f"From: {email['from']}\nSubject: {email['subject']}\nDate: {email['date']}\n\nContent:\n{email['body']}"
                else:
                    logger.warning(f"[TOOL] Gmail returned None for email_id: {email_id}")
            except Exception as e:
                logger.error(f"[TOOL] Gmail fetch error: {e}")

        # Fetch from Outlook
        if email_id.startswith('outlook_') and self.outlook_token:
            logger.info(f"[TOOL] Fetching from Outlook API...")
            try:
                email = await self._get_outlook_email(email_id.replace('outlook_', ''))
                if email:
                    body_preview = email.get('body', '')[:200] if email.get('body') else 'empty'
                    logger.info(f"[TOOL] Outlook returned email, body preview: {body_preview}")
                    return f"From: {email['from']}\nSubject: {email['subject']}\nDate: {email['date']}\n\nContent:\n{email['body']}"
                else:
                    logger.warning(f"[TOOL] Outlook returned None for email_id: {email_id}")
            except Exception as e:
                logger.error(f"[TOOL] Outlook fetch error: {e}")

        logger.warning(f"[TOOL] Could not find email: {email_id}")
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
        gmail_auth_failed = False
        outlook_auth_failed = False

        # Get from Gmail
        if self.gmail_token:
            try:
                gmail_results, auth_ok = await self._get_recent_gmail(count)
                if auth_ok:
                    results.extend(gmail_results)
                    logger.info(f"[TOOL] Gmail returned {len(gmail_results)} recent emails")
                else:
                    gmail_auth_failed = True
                    logger.error("[TOOL] Gmail authentication failed (401)")
            except Exception as e:
                logger.error(f"[TOOL] Gmail recent error: {e}")

        # Get from Outlook
        if self.outlook_token:
            try:
                outlook_results, auth_ok = await self._get_recent_outlook(count)
                if auth_ok:
                    results.extend(outlook_results)
                    logger.info(f"[TOOL] Outlook returned {len(outlook_results)} recent emails")
                else:
                    outlook_auth_failed = True
                    logger.error("[TOOL] Outlook authentication failed (401)")
            except Exception as e:
                logger.error(f"[TOOL] Outlook recent error: {e}")

        # Handle auth failures - be clear with user
        if gmail_auth_failed and outlook_auth_failed:
            return "I cannot access your email right now. Your email connections have expired. Please go to the settings in the app and reconnect your Gmail and Outlook accounts."
        if gmail_auth_failed and not self.outlook_token:
            return "I cannot access your Gmail right now. The connection has expired. Please go to the settings in the app and reconnect your Gmail account."
        if outlook_auth_failed and not self.gmail_token:
            return "I cannot access your Outlook right now. The connection has expired. Please go to the settings in the app and reconnect your Outlook account."

        if not results:
            if not self.gmail_token and not self.outlook_token:
                return "No email accounts are connected. Please connect Gmail or Outlook in the app settings."

            # Build message about which accounts were searched
            searched = []
            if self.gmail_token and not gmail_auth_failed:
                searched.append("Gmail")
            if self.outlook_token and not outlook_auth_failed:
                searched.append("Outlook")

            if not searched:
                return "I cannot access any email accounts right now. Please reconnect them in the app settings."

            return f"I checked your {' and '.join(searched)} but found no recent emails."

        # Sort by date and take top N
        results.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
        results = results[:count]

        # Clear old cache and set new timestamp
        self._email_cache = {}
        self._cache_timestamp = time.time()

        # Format results - never mention email IDs to user
        output = f"Your {len(results)} most recent emails:\n\n"
        for i, email in enumerate(results, 1):
            output += f"{i}. From: {email['from']}\n"
            output += f"   Subject: {email['subject']}\n"
            output += f"   Date: {email['date']}\n\n"
            self._email_cache[email['id']] = email
            # Store mapping from list number to ID for easy reference
            self._email_cache[f"#{i}"] = email

        output += "(To read an email, use the number like 'read email 1' or 'the first one')"
        return output

    # ==================== New Email Action Tools ====================

    @function_tool()
    async def remember_contact(
        self,
        context: RunContext,
        name: str,
        email: str,
        relation: str = "",
    ) -> str:
        """Remember someone's email address. Optionally note their relation.

        Args:
            name: Person's name (e.g., "Sarah")
            email: Their email address
            relation: Optional relation (e.g., "daughter", "mom", "husband")
        """
        logger.info(f"[TOOL] remember_contact called: name='{name}', email='{email}', relation='{relation}'")

        normalized_name = self._normalize_name(name)
        self._contacts[normalized_name] = email

        if relation:
            normalized_rel = self._normalize_name(relation)
            self._kin_map[normalized_rel] = normalized_name
            logger.info(f"[TOOL] Added kin mapping: {normalized_rel} -> {normalized_name}")

        logger.info(f"[TOOL] Contacts now: {self._contacts}")
        return f"Got it, I'll remember {name}'s email."

    @function_tool()
    async def mark_email_spam(
        self,
        context: RunContext,
        email_ref: str,
    ) -> str:
        """Mark an email as spam/junk and move it out of inbox.

        Args:
            email_ref: Reference to the email (number like "1" or word like "first")
        """
        logger.info(f"[TOOL] mark_email_spam called: email_ref='{email_ref}'")

        email = self._resolve_email_ref(email_ref)
        if not email:
            return "I need to look that up. Should I search your recent messages first?"

        email_id = email.get('id', '')

        # Gmail
        if email_id.startswith('gmail_') and self.gmail_token:
            try:
                msg_id = email_id.replace('gmail_', '')
                success = await self._gmail_mark_spam(msg_id)
                if success:
                    return "Got it, moved to junk."
                else:
                    return "I couldn't move that email. The connection may have expired."
            except Exception as e:
                logger.error(f"[TOOL] Gmail spam error: {e}")
                return "Something went wrong. Try reconnecting your email in settings."

        # Outlook
        if email_id.startswith('outlook_') and self.outlook_token:
            try:
                msg_id = email_id.replace('outlook_', '')
                success = await self._outlook_mark_spam(msg_id)
                if success:
                    return "Got it, moved to junk."
                else:
                    return "I couldn't move that email. The connection may have expired."
            except Exception as e:
                logger.error(f"[TOOL] Outlook spam error: {e}")
                return "Something went wrong. Try reconnecting your email in settings."

        return "I couldn't find that email in my recent results."

    @function_tool()
    async def get_email_attachments(
        self,
        context: RunContext,
        email_ref: str,
    ) -> str:
        """Get information about attachments on an email and optionally read their contents.
        Can read PDF and plain text files. Other file types will be listed but cannot be read.

        Args:
            email_ref: Reference to the email (number like "1" or word like "first")
        """
        logger.info(f"[TOOL] get_email_attachments called: email_ref='{email_ref}'")

        email = self._resolve_email_ref(email_ref)
        if not email:
            return "I need to look that up. Should I search your recent messages first?"

        email_id = email.get('id', '')
        attachments = []

        # Gmail
        if email_id.startswith('gmail_') and self.gmail_token:
            try:
                msg_id = email_id.replace('gmail_', '')
                attachments = await self._get_gmail_attachments(msg_id)
            except Exception as e:
                logger.error(f"[TOOL] Gmail attachments error: {e}")
                return "Something went wrong reading the attachments."

        # Outlook
        elif email_id.startswith('outlook_') and self.outlook_token:
            try:
                msg_id = email_id.replace('outlook_', '')
                attachments = await self._get_outlook_attachments(msg_id)
            except Exception as e:
                logger.error(f"[TOOL] Outlook attachments error: {e}")
                return "Something went wrong reading the attachments."
        else:
            return "I couldn't find that email in my recent results."

        # Publish attachment metadata to iOS client for visual display
        for att in attachments:
            att_size = att.get('size', 0)
            has_raw_data = att.get('raw_data') is not None
            # Include base64 data for images and PDFs (if available and not too large for data channel)
            include_data = has_raw_data and att_size < 500 * 1024  # Under 500KB for data channel

            att_data = {
                "id": f"{email_id}_{att.get('name', 'unknown')}",
                "name": att.get('name', 'Unknown file'),
                "mimeType": att.get('mimeType', 'application/octet-stream'),
                "size": att_size,
                "dataAvailable": include_data,  # Tell iOS if data is included
            }
            if include_data:
                att_data["data"] = base64.b64encode(att['raw_data']).decode('utf-8')
            await self._publish_attachment(att_data)

        return self._format_attachments_response(attachments)

    def _format_attachments_response(self, attachments: list) -> str:
        """Format attachments list for user response."""
        if not attachments:
            return "This email has no attachments."

        output = f"This email has {len(attachments)} attachment(s):\n\n"
        readable_found = False

        for att in attachments:
            name = att.get('name', 'Unknown file')
            size_mb = att.get('size', 0) / (1024 * 1024)
            mime = att.get('mimeType', '')
            content = att.get('content', '')

            output += f"- {name} ({size_mb:.1f} MB)\n"

            # Check if we could read it
            if content:
                readable_found = True
                # Truncate long content
                if len(content) > 3000:
                    content = content[:3000] + "\n...(content truncated)"
                output += f"  Content:\n{content}\n\n"
            elif att.get('too_large'):
                output += "  (Too large to read safely)\n"
            elif att.get('unreadable'):
                output += "  (I can't read this type of file)\n"

        if not readable_found and attachments:
            output += "\nWant me to forward this email with the attachments to someone who can open them?"

        return output

    @function_tool()
    async def reply_to_email(
        self,
        context: RunContext,
        email_ref: str,
        message: str,
        confirmed: bool = False,
    ) -> str:
        """Reply to an email. Will ask for confirmation before sending.

        Args:
            email_ref: Reference to the email (number like "1" or word like "first")
            message: The reply message to send
            confirmed: Set to True only after user explicitly confirms sending
        """
        logger.info(f"[TOOL] reply_to_email called: email_ref='{email_ref}', message='{message[:50]}...', confirmed={confirmed}")

        email = self._resolve_email_ref(email_ref)
        if not email:
            return "I need to look that up. Should I search your recent messages first?"

        # If not confirmed, show draft and ask for confirmation
        if not confirmed:
            sender = email.get('from', 'the sender')
            return f"I'll reply to {sender}: \"{message}\"\n\nSend it?"

        email_id = email.get('id', '')

        # Gmail
        if email_id.startswith('gmail_') and self.gmail_token:
            try:
                msg_id = email_id.replace('gmail_', '')
                success = await self._gmail_reply(msg_id, message, email)
                if success:
                    return "Sent!"
                else:
                    return "I couldn't send the reply. The connection may have expired."
            except Exception as e:
                logger.error(f"[TOOL] Gmail reply error: {e}")
                return "Something went wrong sending the reply."

        # Outlook
        if email_id.startswith('outlook_') and self.outlook_token:
            try:
                msg_id = email_id.replace('outlook_', '')
                success = await self._outlook_reply(msg_id, message)
                if success:
                    return "Sent!"
                else:
                    return "I couldn't send the reply. The connection may have expired."
            except Exception as e:
                logger.error(f"[TOOL] Outlook reply error: {e}")
                return "Something went wrong sending the reply."

        return "I couldn't find that email to reply to."

    @function_tool()
    async def forward_email(
        self,
        context: RunContext,
        email_ref: str,
        recipient: str,
        message: str = "",
        confirmed: bool = False,
        skip_large_files: bool = False,
    ) -> str:
        """Forward an email to someone. Includes all attachments by default.
        Will ask for confirmation before sending.

        Args:
            email_ref: Reference to the email (number like "1" or word like "first")
            recipient: Name or email of the person to forward to (e.g., "Sarah" or "sarah@gmail.com")
            message: Optional message to include with the forward
            confirmed: Set to True only after user explicitly confirms sending
            skip_large_files: Set to True if user confirmed skipping oversized attachments
        """
        logger.info(f"[TOOL] forward_email called: email_ref='{email_ref}', recipient='{recipient}', confirmed={confirmed}, skip_large={skip_large_files}")

        email = self._resolve_email_ref(email_ref)
        if not email:
            return "I need to look that up. Should I search your recent messages first?"

        # Resolve recipient
        recipient_email = recipient
        if '@' not in recipient:
            resolved = self._resolve_contact(recipient)
            if resolved is None:
                # Try searching past emails for this contact
                logger.info(f"[TOOL] Contact not found, searching emails for: {recipient}")
                searched_email = await self._search_for_contact(recipient)
                if searched_email:
                    resolved = searched_email
                else:
                    return f"I couldn't find {recipient}'s email in your past messages. What is their email address?"
            if resolved.startswith('AMBIGUOUS:'):
                names = resolved.replace('AMBIGUOUS:', '').split(',')
                formatted_names = [n.title() for n in names]
                return f"Which one? {' or '.join(formatted_names)}?"
            recipient_email = resolved

        email_id = email.get('id', '')

        # Before confirmation, check attachment sizes
        if not confirmed:
            oversized_files = []
            total_size = 0

            # Check Gmail attachments
            if email_id.startswith('gmail_') and self.gmail_token:
                try:
                    att_info = await self._get_gmail_attachment_sizes(email_id.replace('gmail_', ''))
                    for att in att_info:
                        total_size += att['size']
                        if total_size > MAX_FORWARD_SIZE_MB * 1024 * 1024:
                            oversized_files.append(att['name'])
                except Exception as e:
                    logger.error(f"[TOOL] Error checking Gmail attachment sizes: {e}")

            # Check Outlook attachments
            elif email_id.startswith('outlook_') and self.outlook_token:
                try:
                    att_info = await self._get_outlook_attachment_sizes(email_id.replace('outlook_', ''))
                    for att in att_info:
                        total_size += att['size']
                        if total_size > MAX_FORWARD_SIZE_MB * 1024 * 1024:
                            oversized_files.append(att['name'])
                except Exception as e:
                    logger.error(f"[TOOL] Error checking Outlook attachment sizes: {e}")

            # If oversized and user hasn't confirmed skipping, ask first
            if oversized_files and not skip_large_files:
                files_list = ", ".join(oversized_files)
                return f"The attachments are too large to forward together. These files would be skipped: {files_list}. Should I skip these large files and forward anyway?"

            subject = email.get('subject', 'this email')
            msg_part = f' with your message: "{message}"' if message else ''
            att_note = " (without large files)" if skip_large_files else ""
            return f"I'll forward \"{subject}\" to {recipient_email}{msg_part}{att_note}.\n\nSend it?"

        # Gmail
        if email_id.startswith('gmail_') and self.gmail_token:
            try:
                msg_id = email_id.replace('gmail_', '')
                result = await self._gmail_forward(msg_id, recipient_email, message, email, skip_large_files)
                success, reason = result if isinstance(result, tuple) else (result, "unknown")
                if success:
                    return "Forwarded!"
                elif reason == "size_exceeded":
                    return "The attachments are larger than I expected. Should I skip the large files and try again?"
                elif reason == "auth_expired":
                    return "I couldn't forward the email. The connection may have expired. Please reconnect your email in settings."
                else:
                    return "I couldn't forward the email. Please try again."
            except Exception as e:
                logger.error(f"[TOOL] Gmail forward error: {e}")
                return "Something went wrong forwarding the email."

        # Outlook
        if email_id.startswith('outlook_') and self.outlook_token:
            try:
                msg_id = email_id.replace('outlook_', '')
                success = await self._outlook_forward(msg_id, recipient_email, message)
                if success:
                    return "Forwarded!"
                else:
                    return "I couldn't forward the email. The connection may have expired."
            except Exception as e:
                logger.error(f"[TOOL] Outlook forward error: {e}")
                return "Something went wrong forwarding the email."

        return "I couldn't find that email to forward."

    @function_tool()
    async def compose_email(
        self,
        context: RunContext,
        recipient: str,
        subject: str,
        message: str,
        confirmed: bool = False,
    ) -> str:
        """Compose and send a new email (not a reply or forward).
        Will ask for confirmation before sending.

        Args:
            recipient: Name or email of the person to send to (e.g., "Sarah" or "sarah@gmail.com")
            subject: Email subject line
            message: The email body content
            confirmed: Set to True only after user explicitly confirms sending
        """
        logger.info(f"[TOOL] compose_email called: recipient='{recipient}', subject='{subject}', confirmed={confirmed}")

        # Resolve recipient
        recipient_email = recipient
        if '@' not in recipient:
            resolved = self._resolve_contact(recipient)
            if resolved is None:
                # Try searching past emails for this contact
                logger.info(f"[TOOL] Contact not found, searching emails for: {recipient}")
                searched_email = await self._search_for_contact(recipient)
                if searched_email:
                    resolved = searched_email
                else:
                    return f"I couldn't find {recipient}'s email in your past messages. What is their email address?"
            if resolved.startswith('AMBIGUOUS:'):
                names = resolved.replace('AMBIGUOUS:', '').split(',')
                formatted_names = [n.title() for n in names]
                return f"Which one? {' or '.join(formatted_names)}?"
            recipient_email = resolved

        # Validate subject and message
        if not subject.strip() and not confirmed:
            return "You didn't give me a subject. Send anyway?"

        if not message.strip() and not confirmed:
            return "The message is empty. Send anyway?"

        # If not confirmed, show draft and ask for confirmation
        if not confirmed:
            preview = message[:50] + "..." if len(message) > 50 else message
            return f"I'll send to {recipient_email}.\nSubject: {subject}\nMessage: \"{preview}\"\n\nSend it?"

        # Determine which email service to use (prefer Gmail if both available)
        if self.gmail_token:
            success, reason = await self._gmail_send(recipient_email, subject, message)
            if success:
                return "Sent!"
            elif reason == "auth_expired":
                return "I couldn't send the email. Your Gmail connection has expired. Please reconnect in the app settings."
            else:
                return "I couldn't send the email. Please try again."

        elif self.outlook_token:
            success, reason = await self._outlook_send(recipient_email, subject, message)
            if success:
                return "Sent!"
            elif reason == "auth_expired":
                return "I couldn't send the email. Your Outlook connection has expired. Please reconnect in the app settings."
            else:
                return "I couldn't send the email. Please try again."

        else:
            return "No email accounts are connected. Please connect Gmail or Outlook in the app settings."

    # ==================== Gmail API Methods ====================

    async def _search_gmail(self, query: str, days_back: int) -> tuple:
        """Search Gmail using the API. Returns (results, auth_ok)."""
        after_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y/%m/%d')
        search_query = f"{query} after:{after_date}"

        async with aiohttp.ClientSession() as session:
            # Search for messages
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages"
            params = {"q": search_query, "maxResults": 10}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status == 401:
                    logger.error("Gmail search failed: 401 Unauthorized")
                    return [], False
                if resp.status != 200:
                    logger.error(f"Gmail search failed: {resp.status}")
                    return [], True  # Not an auth failure, just an error
                data = await resp.json()

            messages = data.get("messages", [])
            results = []

            # Fetch details for each message
            for msg in messages[:10]:
                email = await self._get_gmail_message_summary(session, msg["id"])
                if email:
                    results.append(email)

            return results, True

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
                self._learn_contact_from_email(h["value"])  # Auto-learn contact
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
                self._learn_contact_from_email(h["value"])  # Auto-learn contact
            elif h["name"] == "Subject":
                email["subject"] = h["value"]
            elif h["name"] == "Date":
                email["date"] = h["value"]

        # Extract body (simplified - handles plain text)
        email["body"] = self._extract_gmail_body(data.get("payload", {}))
        return email

    def _extract_gmail_body(self, payload: dict) -> str:
        """Extract text body from Gmail payload, handling HTML if needed."""
        import base64
        import re

        def decode_body(data: str) -> str:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")

        def html_to_text(html: str) -> str:
            """Simple HTML to text conversion."""
            # Remove style and script tags with content
            text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
            # Convert common tags
            text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'<p[^>]*>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'<div[^>]*>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'<li[^>]*>', '\n• ', text, flags=re.IGNORECASE)
            # Remove all other tags
            text = re.sub(r'<[^>]+>', '', text)
            # Decode HTML entities
            text = re.sub(r'&nbsp;', ' ', text)
            text = re.sub(r'&amp;', '&', text)
            text = re.sub(r'&lt;', '<', text)
            text = re.sub(r'&gt;', '>', text)
            text = re.sub(r'&quot;', '"', text)
            text = re.sub(r'&#\d+;', '', text)  # Remove numeric entities
            # Clean up whitespace
            text = re.sub(r'\n\s*\n', '\n\n', text)
            text = re.sub(r' +', ' ', text)
            return text.strip()

        def extract_from_parts(parts: list) -> str:
            """Recursively extract body from parts, preferring plain text."""
            plain_text = None
            html_text = None

            for part in parts:
                mime = part.get("mimeType", "")

                # Recursively handle nested multipart
                if mime.startswith("multipart/") and "parts" in part:
                    nested = extract_from_parts(part["parts"])
                    if nested:
                        return nested

                # Get plain text (preferred)
                if mime == "text/plain" and part.get("body", {}).get("data"):
                    plain_text = decode_body(part["body"]["data"])

                # Get HTML as fallback
                if mime == "text/html" and part.get("body", {}).get("data"):
                    html_text = decode_body(part["body"]["data"])

            if plain_text:
                return plain_text
            if html_text:
                return html_to_text(html_text)
            return None

        # Direct body (simple message)
        if "body" in payload and payload["body"].get("data"):
            body = decode_body(payload["body"]["data"])
            if payload.get("mimeType") == "text/html":
                return html_to_text(body)
            return body

        # Multipart message
        if "parts" in payload:
            result = extract_from_parts(payload["parts"])
            if result:
                return result

        return "(Could not extract email body)"

    async def _get_recent_gmail(self, count: int) -> tuple:
        """Get recent Gmail messages. Returns (results, auth_ok)."""
        async with aiohttp.ClientSession() as session:
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages"
            params = {"maxResults": count}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status == 401:
                    logger.error("Gmail recent failed: 401 Unauthorized")
                    return [], False
                if resp.status != 200:
                    logger.error(f"Gmail recent failed: {resp.status}")
                    return [], True  # Not an auth failure, just an error
                data = await resp.json()

            messages = data.get("messages", [])
            results = []

            for msg in messages:
                email = await self._get_gmail_message_summary(session, msg["id"])
                if email:
                    results.append(email)

            return results, True

    async def _gmail_mark_spam(self, msg_id: str) -> bool:
        """Mark a Gmail message as spam."""
        async with aiohttp.ClientSession() as session:
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}/modify"
            headers = {
                "Authorization": f"Bearer {self.gmail_token}",
                "Content-Type": "application/json",
            }
            data = {
                "addLabelIds": ["SPAM"],
                "removeLabelIds": ["INBOX"],
            }

            async with session.post(url, headers=headers, json=data) as resp:
                if resp.status == 401:
                    logger.error("Gmail mark spam failed: 401 Unauthorized")
                    return False
                return resp.status == 200

    async def _get_gmail_attachments(self, msg_id: str) -> list:
        """Get attachments from a Gmail message with content extraction."""
        attachments = []

        async with aiohttp.ClientSession() as session:
            # Get full message to find attachments
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
            params = {"format": "full"}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            # Find attachment parts
            def find_attachments(parts):
                found = []
                for part in parts:
                    if part.get("filename") and part.get("body", {}).get("attachmentId"):
                        found.append({
                            "filename": part["filename"],
                            "mimeType": part.get("mimeType", ""),
                            "size": part.get("body", {}).get("size", 0),
                            "attachmentId": part["body"]["attachmentId"],
                        })
                    if "parts" in part:
                        found.extend(find_attachments(part["parts"]))
                return found

            payload = data.get("payload", {})
            att_parts = find_attachments(payload.get("parts", []))

            # Fetch each attachment
            for att in att_parts:
                attachment = {
                    "name": att["filename"],
                    "mimeType": att["mimeType"],
                    "size": att["size"],
                }

                size_mb = att["size"] / (1024 * 1024)

                # Check size limit
                if size_mb > MAX_ATTACHMENT_SIZE_MB:
                    attachment["too_large"] = True
                    attachments.append(attachment)
                    continue

                # Check file type
                mime = att["mimeType"].lower()
                is_pdf = mime == "application/pdf" or att["filename"].lower().endswith(".pdf")
                is_text = mime.startswith("text/plain") or att["filename"].lower().endswith(".txt")
                is_image = mime.startswith("image/")

                # Fetch attachment content for viewable types (images, PDFs, text)
                if is_pdf or is_text or is_image:
                    try:
                        att_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}/attachments/{att['attachmentId']}"
                        async with session.get(att_url, headers=headers) as att_resp:
                            if att_resp.status != 200:
                                attachment["unreadable"] = True
                                attachments.append(attachment)
                                continue
                            att_data = await att_resp.json()

                        # Decode base64 content
                        raw_data = base64.urlsafe_b64decode(att_data.get("data", ""))

                        # Store raw data for iOS client display
                        attachment["raw_data"] = raw_data

                        # Extract text based on type (images are just stored, not extracted)
                        if is_text:
                            attachment["content"] = raw_data.decode("utf-8", errors="ignore")
                        elif is_pdf:
                            try:
                                content = await asyncio.wait_for(
                                    self._extract_pdf_text(raw_data),
                                    timeout=ATTACHMENT_TIMEOUT_SECONDS
                                )
                                attachment["content"] = content
                            except asyncio.TimeoutError:
                                attachment["too_large"] = True
                                logger.warning(f"PDF extraction timed out for {att['filename']}")
                            except Exception as e:
                                attachment["unreadable"] = True
                                logger.error(f"PDF extraction failed: {e}")
                        elif is_image:
                            # Images can be viewed but not read as text
                            attachment["is_image"] = True

                    except Exception as e:
                        logger.error(f"Failed to fetch Gmail attachment: {e}")
                        attachment["unreadable"] = True
                else:
                    # Other file types cannot be viewed
                    attachment["unreadable"] = True

                attachments.append(attachment)

        return attachments

    async def _extract_pdf_text(self, pdf_data: bytes) -> str:
        """Extract text from PDF bytes, limited to first N pages/words."""
        try:
            import pdfplumber
            import io

            text_parts = []
            word_count = 0

            with pdfplumber.open(io.BytesIO(pdf_data)) as pdf:
                for i, page in enumerate(pdf.pages):
                    if i >= MAX_PDF_PAGES:
                        text_parts.append(f"\n...(showing first {MAX_PDF_PAGES} pages only)")
                        break

                    page_text = page.extract_text() or ""
                    words = page_text.split()
                    word_count += len(words)

                    if word_count > MAX_PDF_WORDS:
                        # Truncate at word limit
                        remaining = MAX_PDF_WORDS - (word_count - len(words))
                        text_parts.append(" ".join(words[:remaining]))
                        text_parts.append(f"\n...(showing first ~{MAX_PDF_WORDS} words only)")
                        break

                    text_parts.append(page_text)

            return "\n\n".join(text_parts)

        except ImportError:
            logger.error("pdfplumber not installed - cannot extract PDF text")
            return "(PDF reading not available)"

    async def _get_gmail_attachment_sizes(self, msg_id: str) -> list:
        """Get list of attachment names and sizes for a Gmail message."""
        attachments = []

        async with aiohttp.ClientSession() as session:
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
            params = {"format": "full"}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            def find_attachments(parts):
                found = []
                for part in parts:
                    if part.get("filename") and part.get("body", {}).get("attachmentId"):
                        found.append({
                            "name": part["filename"],
                            "size": part.get("body", {}).get("size", 0),
                        })
                    if "parts" in part:
                        found.extend(find_attachments(part["parts"]))
                return found

            payload = data.get("payload", {})
            attachments = find_attachments(payload.get("parts", []))

        return attachments

    async def _gmail_reply(self, msg_id: str, message: str, original_email: dict) -> bool:
        """Send a reply to a Gmail message with quoted original text."""
        async with aiohttp.ClientSession() as session:
            # Get full message to get threadId, headers, and body for quoting
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
            params = {"format": "full"}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return False
                data = await resp.json()

            thread_id = data.get("threadId", "")
            msg_headers = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}

            # Build reply
            original_from = msg_headers.get("From", original_email.get("from", ""))
            original_subject = msg_headers.get("Subject", original_email.get("subject", ""))
            original_date = msg_headers.get("Date", original_email.get("date", ""))
            original_message_id = msg_headers.get("Message-ID", "")

            # Get original body for quoting
            original_body = self._extract_gmail_body(data.get("payload", {}))

            # Create reply subject
            reply_subject = original_subject
            if not reply_subject.lower().startswith("re:"):
                reply_subject = f"Re: {original_subject}"

            # Build reply body with quoted original
            reply_body = f"{message}\n\n"
            reply_body += f"On {original_date}, {original_from} wrote:\n"
            # Quote original text with > prefix
            quoted_lines = [f"> {line}" for line in original_body.split('\n')]
            reply_body += '\n'.join(quoted_lines)

            # Create MIME message
            mime_msg = MIMEText(reply_body)
            mime_msg["To"] = original_from
            mime_msg["Subject"] = reply_subject
            if original_message_id:
                mime_msg["In-Reply-To"] = original_message_id
                mime_msg["References"] = original_message_id

            # Encode and send
            raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")

            send_url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
            send_data = {"raw": raw}
            if thread_id:
                send_data["threadId"] = thread_id

            async with session.post(send_url, headers={
                "Authorization": f"Bearer {self.gmail_token}",
                "Content-Type": "application/json",
            }, json=send_data) as send_resp:
                if send_resp.status == 401:
                    logger.error("Gmail send failed: 401 Unauthorized")
                    return False
                return send_resp.status == 200

    async def _gmail_forward(self, msg_id: str, recipient: str, message: str, original_email: dict, skip_large_files: bool = False) -> tuple[bool, str]:
        """Forward a Gmail message with attachments.

        Args:
            msg_id: Gmail message ID
            recipient: Email address to forward to
            message: Optional message to include
            original_email: Cached email metadata
            skip_large_files: If True, skip attachments that would exceed the size limit (user confirmed).
                              If False and total size exceeds limit, returns failure with reason.

        Returns:
            Tuple of (success: bool, reason: str) where reason is one of:
            - "ok": Forward succeeded
            - "size_exceeded": Attachments too large and skip_large_files=False
            - "auth_expired": Gmail token is invalid/expired
            - "send_failed": Other send failure
        """
        async with aiohttp.ClientSession() as session:
            # Get full message including attachments
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
            params = {"format": "full"}
            headers = {"Authorization": f"Bearer {self.gmail_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return False
                data = await resp.json()

            msg_headers = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
            original_subject = msg_headers.get("Subject", original_email.get("subject", ""))
            original_from = msg_headers.get("From", original_email.get("from", ""))
            original_date = msg_headers.get("Date", original_email.get("date", ""))

            # Create forward subject
            fwd_subject = original_subject
            if not fwd_subject.lower().startswith("fwd:"):
                fwd_subject = f"Fwd: {original_subject}"

            # Build forwarded body
            original_body = self._extract_gmail_body(data.get("payload", {}))
            fwd_body = message + "\n\n" if message else ""
            fwd_body += f"---------- Forwarded message ----------\n"
            fwd_body += f"From: {original_from}\n"
            fwd_body += f"Date: {original_date}\n"
            fwd_body += f"Subject: {original_subject}\n\n"
            fwd_body += original_body

            # Create MIME message (multipart if attachments)
            mime_msg = MIMEMultipart()
            mime_msg["To"] = recipient
            mime_msg["Subject"] = fwd_subject
            mime_msg.attach(MIMEText(fwd_body, "plain"))

            # Find and attach files
            def find_attachments(parts):
                found = []
                for part in parts:
                    if part.get("filename") and part.get("body", {}).get("attachmentId"):
                        found.append({
                            "filename": part["filename"],
                            "mimeType": part.get("mimeType", "application/octet-stream"),
                            "attachmentId": part["body"]["attachmentId"],
                        })
                    if "parts" in part:
                        found.extend(find_attachments(part["parts"]))
                return found

            att_parts = find_attachments(data.get("payload", {}).get("parts", []))
            total_size = 0
            skipped_files = []
            attachment_data = []  # Store fetched attachments before adding to message

            # First pass: fetch all attachments and calculate total size
            for att in att_parts:
                att_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}/attachments/{att['attachmentId']}"
                async with session.get(att_url, headers=headers) as att_resp:
                    if att_resp.status != 200:
                        continue
                    att_data = await att_resp.json()

                raw_data = base64.urlsafe_b64decode(att_data.get("data", ""))
                attachment_data.append({"meta": att, "raw_data": raw_data})
                total_size += len(raw_data)

            # Check if total size exceeds limit
            if total_size > MAX_FORWARD_SIZE_MB * 1024 * 1024:
                if not skip_large_files:
                    # Abort - return specific reason so caller can prompt user
                    logger.error(f"Total attachment size {total_size} exceeds limit, aborting forward")
                    return (False, "size_exceeded")

            # Second pass: add attachments to message (skip if over limit and user approved)
            running_total = 0
            for item in attachment_data:
                att = item["meta"]
                raw_data = item["raw_data"]
                running_total += len(raw_data)

                if running_total > MAX_FORWARD_SIZE_MB * 1024 * 1024 and skip_large_files:
                    logger.info(f"Skipping attachment {att['filename']} per user confirmation - total size exceeds limit")
                    skipped_files.append(att['filename'])
                    continue

                # Create attachment part
                maintype, subtype = att["mimeType"].split("/", 1) if "/" in att["mimeType"] else ("application", "octet-stream")
                att_part = MIMEBase(maintype, subtype)
                att_part.set_payload(raw_data)
                encoders.encode_base64(att_part)
                att_part.add_header("Content-Disposition", "attachment", filename=att["filename"])
                mime_msg.attach(att_part)

            # Encode and send
            raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")

            send_url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
            send_data = {"raw": raw}

            async with session.post(send_url, headers={
                "Authorization": f"Bearer {self.gmail_token}",
                "Content-Type": "application/json",
            }, json=send_data) as send_resp:
                if send_resp.status == 401:
                    logger.error("Gmail forward failed: 401 Unauthorized")
                    return (False, "auth_expired")
                if send_resp.status == 200:
                    return (True, "ok")
                return (False, "send_failed")

    async def _gmail_send(self, recipient: str, subject: str, body: str) -> tuple[bool, str]:
        """Send a new email via Gmail API.

        Args:
            recipient: Email address to send to
            subject: Email subject
            body: Email body content

        Returns:
            Tuple of (success: bool, reason: str) where reason is one of:
            - "ok": Sent successfully
            - "auth_expired": 401 error
            - "send_failed": Other error
        """
        async with aiohttp.ClientSession() as session:
            # Create MIME message
            mime_msg = MIMEText(body, "plain", "utf-8")
            mime_msg["To"] = recipient
            mime_msg["Subject"] = subject

            # Encode to base64url
            raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode("utf-8")

            send_url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
            send_data = {"raw": raw}

            async with session.post(send_url, headers={
                "Authorization": f"Bearer {self.gmail_token}",
                "Content-Type": "application/json",
            }, json=send_data) as resp:
                if resp.status == 401:
                    logger.error("Gmail send failed: 401 Unauthorized")
                    return (False, "auth_expired")
                if resp.status == 200:
                    logger.info(f"Gmail email sent successfully to {recipient}")
                    return (True, "ok")
                logger.error(f"Gmail send failed with status: {resp.status}")
                return (False, "send_failed")

    # ==================== Outlook API Methods ====================

    async def _search_outlook(self, query: str, days_back: int) -> tuple:
        """Search Outlook using Microsoft Graph API. Returns (results, auth_ok)."""
        # Note: Microsoft Graph doesn't allow $search + $filter together
        # $search returns results by relevance, typically recent first

        async with aiohttp.ClientSession() as session:
            url = "https://graph.microsoft.com/v1.0/me/messages"
            params = {
                "$search": f'"{query}"',
                "$top": 10,
                "$select": "id,from,subject,receivedDateTime",
            }
            headers = {"Authorization": f"Bearer {self.outlook_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status == 401:
                    logger.error("Outlook search failed: 401 Unauthorized")
                    return [], False
                if resp.status != 200:
                    logger.error(f"Outlook search failed: {resp.status}")
                    return [], True  # Not an auth failure, just an error
                data = await resp.json()

            results = []
            for msg in data.get("value", []):
                from_obj = msg.get("from", {}).get("emailAddress", {})
                from_name = from_obj.get("name", "")
                from_addr = from_obj.get("address", "Unknown")
                # Format as "Name <email>" for consistent parsing
                from_str = f"{from_name} <{from_addr}>" if from_name else from_addr
                self._learn_contact_from_email(from_str)  # Auto-learn contact
                email = {
                    "id": f"outlook_{msg['id']}",
                    "from": from_str,
                    "subject": msg.get("subject", "(No subject)"),
                    "date": msg.get("receivedDateTime", ""),
                    "timestamp": 0,  # Would need to parse date
                }
                results.append(email)

            return results, True

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

        from_obj = msg.get("from", {}).get("emailAddress", {})
        from_name = from_obj.get("name", "")
        from_addr = from_obj.get("address", "Unknown")
        from_str = f"{from_name} <{from_addr}>" if from_name else from_addr
        self._learn_contact_from_email(from_str)  # Auto-learn contact
        return {
            "id": f"outlook_{msg_id}",
            "from": from_str,
            "subject": msg.get("subject", "(No subject)"),
            "date": msg.get("receivedDateTime", ""),
            "body": msg.get("body", {}).get("content", "(No content)"),
        }

    async def _get_recent_outlook(self, count: int) -> tuple:
        """Get recent Outlook messages. Returns (results, auth_ok)."""
        async with aiohttp.ClientSession() as session:
            url = "https://graph.microsoft.com/v1.0/me/messages"
            params = {
                "$top": count,
                "$orderby": "receivedDateTime desc",
                "$select": "id,from,subject,receivedDateTime",
            }
            headers = {"Authorization": f"Bearer {self.outlook_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status == 401:
                    logger.error("Outlook recent failed: 401 Unauthorized")
                    return [], False
                if resp.status != 200:
                    logger.error(f"Outlook recent failed: {resp.status}")
                    return [], True  # Not an auth failure, just an error
                data = await resp.json()

            results = []
            for msg in data.get("value", []):
                from_obj = msg.get("from", {}).get("emailAddress", {})
                from_name = from_obj.get("name", "")
                from_addr = from_obj.get("address", "Unknown")
                from_str = f"{from_name} <{from_addr}>" if from_name else from_addr
                self._learn_contact_from_email(from_str)  # Auto-learn contact
                email = {
                    "id": f"outlook_{msg['id']}",
                    "from": from_str,
                    "subject": msg.get("subject", "(No subject)"),
                    "date": msg.get("receivedDateTime", ""),
                    "timestamp": 0,
                }
                results.append(email)

            return results, True

    async def _outlook_mark_spam(self, msg_id: str) -> bool:
        """Move an Outlook message to junk folder."""
        async with aiohttp.ClientSession() as session:
            url = f"https://graph.microsoft.com/v1.0/me/messages/{msg_id}/move"
            headers = {
                "Authorization": f"Bearer {self.outlook_token}",
                "Content-Type": "application/json",
            }
            data = {"destinationId": "junkemail"}

            async with session.post(url, headers=headers, json=data) as resp:
                if resp.status == 401:
                    logger.error("Outlook mark spam failed: 401 Unauthorized")
                    return False
                return resp.status in (200, 201)

    async def _get_outlook_attachments(self, msg_id: str) -> list:
        """Get attachments from an Outlook message with content extraction."""
        attachments = []

        async with aiohttp.ClientSession() as session:
            url = f"https://graph.microsoft.com/v1.0/me/messages/{msg_id}/attachments"
            headers = {"Authorization": f"Bearer {self.outlook_token}"}

            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            for att in data.get("value", []):
                attachment = {
                    "name": att.get("name", "Unknown file"),
                    "mimeType": att.get("contentType", ""),
                    "size": att.get("size", 0),
                }

                size_mb = attachment["size"] / (1024 * 1024)

                # Check size limit
                if size_mb > MAX_ATTACHMENT_SIZE_MB:
                    attachment["too_large"] = True
                    attachments.append(attachment)
                    continue

                # Check file type
                mime = attachment["mimeType"].lower()
                name_lower = attachment["name"].lower()
                is_pdf = mime == "application/pdf" or name_lower.endswith(".pdf")
                is_text = mime.startswith("text/plain") or name_lower.endswith(".txt")
                is_image = mime.startswith("image/")

                # Get content for viewable types (images, PDFs, text)
                if is_pdf or is_text or is_image:
                    try:
                        content_bytes = att.get("contentBytes", "")
                        if content_bytes:
                            raw_data = base64.b64decode(content_bytes)

                            # Store raw data for iOS client display
                            attachment["raw_data"] = raw_data

                            if is_text:
                                attachment["content"] = raw_data.decode("utf-8", errors="ignore")
                            elif is_pdf:
                                try:
                                    content = await asyncio.wait_for(
                                        self._extract_pdf_text(raw_data),
                                        timeout=ATTACHMENT_TIMEOUT_SECONDS
                                    )
                                    attachment["content"] = content
                                except asyncio.TimeoutError:
                                    attachment["too_large"] = True
                                    logger.warning(f"PDF extraction timed out for {attachment['name']}")
                                except Exception as e:
                                    attachment["unreadable"] = True
                                    logger.error(f"PDF extraction failed: {e}")
                            elif is_image:
                                # Images can be viewed but not read as text
                                attachment["is_image"] = True
                        else:
                            attachment["unreadable"] = True

                    except Exception as e:
                        logger.error(f"Failed to process Outlook attachment: {e}")
                        attachment["unreadable"] = True
                else:
                    # Other file types cannot be viewed
                    attachment["unreadable"] = True

                attachments.append(attachment)

        return attachments

    async def _get_outlook_attachment_sizes(self, msg_id: str) -> list:
        """Get list of attachment names and sizes for an Outlook message."""
        attachments = []

        async with aiohttp.ClientSession() as session:
            url = f"https://graph.microsoft.com/v1.0/me/messages/{msg_id}/attachments"
            params = {"$select": "name,size"}
            headers = {"Authorization": f"Bearer {self.outlook_token}"}

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    return []
                data = await resp.json()

            for att in data.get("value", []):
                attachments.append({
                    "name": att.get("name", "Unknown file"),
                    "size": att.get("size", 0),
                })

        return attachments

    async def _outlook_reply(self, msg_id: str, message: str) -> bool:
        """Send a reply to an Outlook message."""
        async with aiohttp.ClientSession() as session:
            url = f"https://graph.microsoft.com/v1.0/me/messages/{msg_id}/reply"
            headers = {
                "Authorization": f"Bearer {self.outlook_token}",
                "Content-Type": "application/json",
            }
            data = {"comment": message}

            async with session.post(url, headers=headers, json=data) as resp:
                if resp.status == 401:
                    logger.error("Outlook reply failed: 401 Unauthorized")
                    return False
                return resp.status in (200, 202)

    async def _outlook_forward(self, msg_id: str, recipient: str, message: str) -> bool:
        """Forward an Outlook message (includes attachments automatically)."""
        async with aiohttp.ClientSession() as session:
            url = f"https://graph.microsoft.com/v1.0/me/messages/{msg_id}/forward"
            headers = {
                "Authorization": f"Bearer {self.outlook_token}",
                "Content-Type": "application/json",
            }
            data = {
                "comment": message,
                "toRecipients": [
                    {"emailAddress": {"address": recipient}}
                ]
            }

            async with session.post(url, headers=headers, json=data) as resp:
                if resp.status == 401:
                    logger.error("Outlook forward failed: 401 Unauthorized")
                    return False
                return resp.status in (200, 202)

    async def _outlook_send(self, recipient: str, subject: str, body: str) -> tuple[bool, str]:
        """Send a new email via Microsoft Graph API.

        Args:
            recipient: Email address to send to
            subject: Email subject
            body: Email body content

        Returns:
            Tuple of (success: bool, reason: str) where reason is one of:
            - "ok": Sent successfully
            - "auth_expired": 401 error
            - "send_failed": Other error
        """
        async with aiohttp.ClientSession() as session:
            url = "https://graph.microsoft.com/v1.0/me/sendMail"
            headers = {
                "Authorization": f"Bearer {self.outlook_token}",
                "Content-Type": "application/json",
            }
            data = {
                "message": {
                    "subject": subject,
                    "body": {
                        "contentType": "Text",
                        "content": body,
                    },
                    "toRecipients": [
                        {"emailAddress": {"address": recipient}}
                    ],
                },
                "saveToSentItems": True,
            }

            async with session.post(url, headers=headers, json=data) as resp:
                if resp.status == 401:
                    logger.error("Outlook send failed: 401 Unauthorized")
                    return (False, "auth_expired")
                if resp.status in (200, 202):
                    logger.info(f"Outlook email sent successfully to {recipient}")
                    return (True, "ok")
                logger.error(f"Outlook send failed with status: {resp.status}")
                return (False, "send_failed")


async def wait_for_tokens(room, timeout=10.0) -> dict:
    """Wait for OAuth tokens from client metadata."""

    def check_participants():
        """Check all participants for token metadata."""
        for participant in room.remote_participants.values():
            logger.info(f"Checking participant: {participant.identity}, has_metadata: {bool(participant.metadata)}")
            if participant.metadata:
                try:
                    metadata = json.loads(participant.metadata)
                    # Check if tokens are actually present (not empty strings)
                    gmail = metadata.get("gmail_token", "")
                    outlook = metadata.get("outlook_token", "")
                    if gmail or outlook:
                        logger.info(f"Found tokens in metadata - Gmail: {'yes' if gmail else 'no'}, Outlook: {'yes' if outlook else 'no'}")
                        return metadata
                    else:
                        logger.info("Metadata found but tokens are empty")
                except json.JSONDecodeError:
                    logger.warning("Failed to parse participant metadata as JSON")
        return None

    # Check existing participants first
    existing = check_participants()
    if existing:
        return existing

    # Wait for metadata update event
    logger.info("Waiting for token metadata from client...")
    event = asyncio.Event()
    result = {}

    def on_metadata_changed(participant: rtc.Participant, old_metadata: str, new_metadata: str):
        logger.info(f"Metadata changed for {participant.identity}")
        if new_metadata:
            try:
                metadata = json.loads(new_metadata)
                gmail = metadata.get("gmail_token", "")
                outlook = metadata.get("outlook_token", "")
                if gmail or outlook:
                    result.update(metadata)
                    logger.info(f"Received tokens - Gmail: {'yes' if gmail else 'no'}, Outlook: {'yes' if outlook else 'no'}")
                    event.set()
                else:
                    logger.info("Metadata received but tokens are empty strings")
            except json.JSONDecodeError:
                logger.warning("Failed to parse new metadata as JSON")

    room.on("participant_metadata_changed", on_metadata_changed)

    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        logger.info(f"Timeout after {timeout}s waiting for token metadata")
        # One final check after timeout
        final_check = check_participants()
        if final_check:
            logger.info("Found tokens in final check after timeout")
            result.update(final_check)

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
            model="gemini-3-flash-preview",
            temperature=0.5,  # Lower for steadier, less verbose responses
        ),
        tts=deepgram.TTS(
            model="aura-2-thalia-en",
        ),
        vad=silero.VAD.load(
            min_speech_duration=0.3,  # Require longer speech to trigger
            min_silence_duration=0.5,  # Require longer silence to end turn
            activation_threshold=0.6,  # Higher threshold = less sensitive
        ),
        turn_detection="vad",
        allow_interruptions=True,
        min_interruption_duration=2.0,  # Require 2 seconds of speech to interrupt
    )

    # Create agent first so we can reference it in event handlers
    agent = VeraAgent(gmail_token=gmail_token, outlook_token=outlook_token, room=ctx.room)

    # Add event handlers for debugging
    @session.on("agent_state_changed")
    def on_agent_state_changed(ev):
        logger.info(f">>> Agent state changed: {ev}")

    @session.on("error")
    def on_error(error):
        logger.error(f">>> Session error: {error}")

    @session.on("conversation_item_added")
    def on_conversation_item_added(event):
        # Access the item directly from the event per LiveKit SDK
        item = event.item
        item_role = item.role if item else None
        text = item.text_content if item else None

        logger.info(f">>> Conversation item: role={item_role}, has_text={text is not None}, interrupted={getattr(item, 'interrupted', None)}")
        # Note: Don't publish custom transcript - LiveKit handles it via TranscriptionReceived

    # Start the session with custom agent
    # Keep agent alive even when participant disconnects (allows reconnection)
    # sync_transcription=True (default) syncs text with audio playback word-by-word
    room_options = room_io.RoomOptions(
        close_on_disconnect=False,
    )
    await session.start(
        room=ctx.room,
        agent=agent,
        room_options=room_options,
    )

    logger.info(f"Vera is now listening with email tools...")

    # Track whether initial greeting has been done (handled by on_enter)
    initial_greeting_done = False

    async def greet_reconnected_user():
        """Async helper to greet user on reconnection."""
        await asyncio.sleep(1.0)
        await session.say("Welcome back! How can I help you?", allow_interruptions=False)

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        nonlocal initial_greeting_done

        # Skip other agents
        if 'agent' in participant.identity.lower():
            return

        logger.info(f"[ROOM] Participant connected: {participant.identity}")

        if initial_greeting_done:
            # Reconnection - say welcome back
            logger.info(f"[ROOM] Reconnection detected, greeting user")
            asyncio.create_task(greet_reconnected_user())
        else:
            # First connection - on_enter handles the greeting
            initial_greeting_done = True
            logger.info(f"[ROOM] First connection, on_enter will handle greeting")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
