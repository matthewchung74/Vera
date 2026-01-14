"""
Vera Email Briefing Module
Fetches emails from Gmail and Outlook, scores them with Gemini, returns top 3.
"""

import os
import json
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import Optional
from enum import Enum

# Google
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Microsoft
import msal
import requests

# Gemini
import google.generativeai as genai


class ErrorCode(Enum):
    SUCCESS = "SUCCESS"
    NEEDS_MATTHEW = "NEEDS_MATTHEW"  # Token expired, needs manual re-auth
    API_ERROR = "API_ERROR"
    NO_EMAILS = "NO_EMAILS"


@dataclass
class Email:
    id: str
    subject: str
    sender: str
    snippet: str
    timestamp: datetime
    source: str  # 'gmail' or 'outlook'
    importance_score: int = 0
    importance_reason: str = ""


@dataclass
class BriefingResult:
    status: ErrorCode
    emails: list[Email]
    error_message: str = ""


# Configuration paths
GMAIL_TOKEN_PATH = os.environ.get("VERA_GMAIL_TOKEN", "tokens/gmail_token.json")
GMAIL_CREDENTIALS_PATH = os.environ.get("VERA_GMAIL_CREDS", "credentials/gmail_credentials.json")
OUTLOOK_TOKEN_PATH = os.environ.get("VERA_OUTLOOK_TOKEN", "tokens/outlook_token.json")
OUTLOOK_CLIENT_ID = os.environ.get("VERA_OUTLOOK_CLIENT_ID", "")
OUTLOOK_CLIENT_SECRET = os.environ.get("VERA_OUTLOOK_CLIENT_SECRET", "")
OUTLOOK_TENANT_ID = os.environ.get("VERA_OUTLOOK_TENANT_ID", "common")
GEMINI_API_KEY = os.environ.get("VERA_GEMINI_API_KEY", "")

# Gmail scopes
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _load_gmail_credentials() -> tuple[Optional[Credentials], Optional[str]]:
    """Load and refresh Gmail credentials. Returns (creds, error_message)."""
    if not os.path.exists(GMAIL_TOKEN_PATH):
        return None, "Gmail token file not found"

    try:
        creds = Credentials.from_authorized_user_file(GMAIL_TOKEN_PATH, GMAIL_SCOPES)

        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # Save refreshed token
                with open(GMAIL_TOKEN_PATH, "w") as token_file:
                    token_file.write(creds.to_json())
            except Exception as e:
                if "invalid_grant" in str(e).lower() or "token" in str(e).lower():
                    return None, "NEEDS_MATTHEW"
                return None, f"Gmail refresh error: {e}"

        if not creds or not creds.valid:
            return None, "NEEDS_MATTHEW"

        return creds, None

    except Exception as e:
        return None, f"Gmail credentials error: {e}"


def _load_outlook_credentials() -> tuple[Optional[str], Optional[str]]:
    """Load and refresh Outlook credentials. Returns (access_token, error_message)."""
    if not os.path.exists(OUTLOOK_TOKEN_PATH):
        return None, "Outlook token file not found"

    if not OUTLOOK_CLIENT_ID:
        return None, "Outlook client ID not configured"

    try:
        with open(OUTLOOK_TOKEN_PATH, "r") as f:
            token_cache = json.load(f)

        app = msal.ConfidentialClientApplication(
            OUTLOOK_CLIENT_ID,
            authority=f"https://login.microsoftonline.com/{OUTLOOK_TENANT_ID}",
            client_credential=OUTLOOK_CLIENT_SECRET,
            token_cache=msal.SerializableTokenCache(),
        )

        # Load the token cache
        if token_cache:
            app.token_cache.deserialize(json.dumps(token_cache))

        accounts = app.get_accounts()
        if not accounts:
            return None, "NEEDS_MATTHEW"

        result = app.acquire_token_silent(
            scopes=["https://graph.microsoft.com/Mail.Read"],
            account=accounts[0],
        )

        if not result:
            return None, "NEEDS_MATTHEW"

        if "access_token" in result:
            # Save updated cache
            with open(OUTLOOK_TOKEN_PATH, "w") as f:
                json.dump(json.loads(app.token_cache.serialize()), f)
            return result["access_token"], None

        if "error" in result:
            if result.get("error") == "invalid_grant":
                return None, "NEEDS_MATTHEW"
            return None, f"Outlook error: {result.get('error_description', result['error'])}"

        return None, "NEEDS_MATTHEW"

    except Exception as e:
        return None, f"Outlook credentials error: {e}"


def _fetch_gmail_emails(creds: Credentials, since: datetime) -> list[Email]:
    """Fetch emails from Gmail since the given datetime."""
    emails = []

    try:
        service = build("gmail", "v1", credentials=creds)

        # Format date for Gmail query
        since_str = since.strftime("%Y/%m/%d")
        query = f"after:{since_str}"

        results = service.users().messages().list(
            userId="me",
            q=query,
            maxResults=50
        ).execute()

        messages = results.get("messages", [])

        for msg in messages:
            msg_data = service.users().messages().get(
                userId="me",
                id=msg["id"],
                format="metadata",
                metadataHeaders=["From", "Subject", "Date"]
            ).execute()

            headers = {h["name"]: h["value"] for h in msg_data.get("payload", {}).get("headers", [])}

            emails.append(Email(
                id=msg["id"],
                subject=headers.get("Subject", "(No Subject)"),
                sender=headers.get("From", "Unknown"),
                snippet=msg_data.get("snippet", ""),
                timestamp=datetime.now(),  # Simplified; parse Date header for accuracy
                source="gmail"
            ))

    except HttpError as e:
        print(f"Gmail API error: {e}")

    return emails


def _fetch_outlook_emails(access_token: str, since: datetime) -> list[Email]:
    """Fetch emails from Outlook/Microsoft 365 since the given datetime."""
    emails = []

    try:
        since_iso = since.isoformat() + "Z"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        # Fetch recent emails
        url = (
            "https://graph.microsoft.com/v1.0/me/messages"
            f"?$filter=receivedDateTime ge {since_iso}"
            "&$select=id,subject,from,bodyPreview,receivedDateTime"
            "&$top=50"
            "&$orderby=receivedDateTime desc"
        )

        response = requests.get(url, headers=headers)
        response.raise_for_status()

        data = response.json()

        for msg in data.get("value", []):
            sender = msg.get("from", {}).get("emailAddress", {})
            emails.append(Email(
                id=msg["id"],
                subject=msg.get("subject", "(No Subject)"),
                sender=f"{sender.get('name', '')} <{sender.get('address', '')}>",
                snippet=msg.get("bodyPreview", ""),
                timestamp=datetime.fromisoformat(msg["receivedDateTime"].replace("Z", "+00:00")),
                source="outlook"
            ))

    except requests.RequestException as e:
        print(f"Outlook API error: {e}")

    return emails


def _score_emails_with_gemini(emails: list[Email]) -> list[Email]:
    """Use Gemini to score emails on importance (0-10)."""
    if not emails:
        return emails

    if not GEMINI_API_KEY:
        print("Warning: Gemini API key not configured, using default scoring")
        return emails

    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")

        # Build prompt for batch scoring
        email_list = []
        for i, email in enumerate(emails):
            email_list.append(f"{i}. From: {email.sender}\n   Subject: {email.subject}\n   Preview: {email.snippet[:200]}")

        prompt = f"""You are helping an elderly woman named Vera who has hearing loss and technology anxiety.
Score each email from 0-10 on importance to her daily life:

SCORING GUIDE:
- 10: Family members, doctors, urgent medical
- 9: Important bills, appointments, legal matters
- 8: Close friends, pharmacy, insurance
- 7: Local services, church, community
- 5: Moderate importance, might want to know
- 3: Low importance, nice to know
- 1-2: Newsletters, promotions, social media
- 0: Spam, junk, unsubscribe-worthy

EMAILS TO SCORE:
{chr(10).join(email_list)}

Respond ONLY with a JSON array of objects, each with "index", "score", and "reason" (brief 5-word reason).
Example: [{{"index": 0, "score": 10, "reason": "Message from daughter Sarah"}}]
"""

        response = model.generate_content(prompt)
        response_text = response.text.strip()

        # Extract JSON from response
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0]
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0]

        scores = json.loads(response_text)

        for score_data in scores:
            idx = score_data.get("index", -1)
            if 0 <= idx < len(emails):
                emails[idx].importance_score = score_data.get("score", 0)
                emails[idx].importance_reason = score_data.get("reason", "")

    except Exception as e:
        print(f"Gemini scoring error: {e}")
        # Fall back to basic keyword scoring
        for email in emails:
            email.importance_score = _basic_importance_score(email)

    return emails


def _basic_importance_score(email: Email) -> int:
    """Fallback scoring based on keywords."""
    text = f"{email.sender} {email.subject} {email.snippet}".lower()

    # High importance keywords
    if any(word in text for word in ["doctor", "hospital", "urgent", "emergency", "appointment"]):
        return 9
    if any(word in text for word in ["bill", "payment", "due", "invoice", "statement"]):
        return 8
    if any(word in text for word in ["family", "mom", "dad", "daughter", "son", "grandchild"]):
        return 10

    # Low importance keywords
    if any(word in text for word in ["unsubscribe", "newsletter", "promotion", "sale", "deal"]):
        return 1
    if any(word in text for word in ["social", "facebook", "twitter", "linkedin"]):
        return 2

    return 5  # Default moderate importance


def fetch_daily_briefing(
    include_gmail: bool = True,
    include_outlook: bool = True,
    hours_back: int = 24,
    top_n: int = 3
) -> BriefingResult:
    """
    Fetch emails from the last N hours, score with Gemini, return top items.

    Args:
        include_gmail: Whether to fetch from Gmail
        include_outlook: Whether to fetch from Outlook/Microsoft 365
        hours_back: How many hours back to fetch (default 24)
        top_n: Number of top emails to return (default 3)

    Returns:
        BriefingResult with status, emails, and any error message
    """
    all_emails: list[Email] = []
    since = datetime.utcnow() - timedelta(hours=hours_back)
    needs_matthew = False
    errors = []

    # Fetch from Gmail
    if include_gmail:
        gmail_creds, gmail_error = _load_gmail_credentials()
        if gmail_error == "NEEDS_MATTHEW":
            needs_matthew = True
            errors.append("Gmail: needs re-authentication")
        elif gmail_error:
            errors.append(f"Gmail: {gmail_error}")
        elif gmail_creds:
            gmail_emails = _fetch_gmail_emails(gmail_creds, since)
            all_emails.extend(gmail_emails)

    # Fetch from Outlook
    if include_outlook:
        outlook_token, outlook_error = _load_outlook_credentials()
        if outlook_error == "NEEDS_MATTHEW":
            needs_matthew = True
            errors.append("Outlook: needs re-authentication")
        elif outlook_error:
            errors.append(f"Outlook: {outlook_error}")
        elif outlook_token:
            outlook_emails = _fetch_outlook_emails(outlook_token, since)
            all_emails.extend(outlook_emails)

    # If we need re-auth and got no emails, return error
    if needs_matthew and not all_emails:
        return BriefingResult(
            status=ErrorCode.NEEDS_MATTHEW,
            emails=[],
            error_message="; ".join(errors)
        )

    # If no emails at all
    if not all_emails:
        return BriefingResult(
            status=ErrorCode.NO_EMAILS if not errors else ErrorCode.API_ERROR,
            emails=[],
            error_message="; ".join(errors) if errors else "No new emails in the last 24 hours"
        )

    # Score emails with Gemini
    scored_emails = _score_emails_with_gemini(all_emails)

    # Sort by importance and get top N
    scored_emails.sort(key=lambda e: e.importance_score, reverse=True)
    top_emails = scored_emails[:top_n]

    # Determine final status
    status = ErrorCode.SUCCESS
    if needs_matthew:
        # We got some emails but one source needs re-auth
        status = ErrorCode.NEEDS_MATTHEW

    return BriefingResult(
        status=status,
        emails=top_emails,
        error_message="; ".join(errors) if errors else ""
    )


# Convenience function to format for Vera's UI
def format_briefing_for_vera(result: BriefingResult) -> dict:
    """Format the briefing result for Vera's iOS app."""
    if result.status == ErrorCode.NEEDS_MATTHEW:
        return {
            "status": "NEEDS_MATTHEW",
            "message": "I need Matthew's help to check your email. The connection expired.",
            "emails": []
        }

    if result.status == ErrorCode.NO_EMAILS:
        return {
            "status": "OK",
            "message": "No new emails today! Your inbox is quiet.",
            "emails": []
        }

    if result.status == ErrorCode.API_ERROR:
        return {
            "status": "ERROR",
            "message": "I had trouble checking your email. Let's try again later.",
            "emails": []
        }

    # Format emails for Vera
    formatted_emails = []
    for email in result.emails:
        # Determine color based on score
        if email.importance_score >= 9:
            color = "GREEN"  # Family/Medical
            urgency = "Important"
        elif email.importance_score >= 7:
            color = "YELLOW"  # Bills/Appointments
            urgency = "Worth reading"
        else:
            color = "BLUE"  # General
            urgency = "For your information"

        formatted_emails.append({
            "subject": email.subject,
            "from": email.sender.split("<")[0].strip(),  # Just the name
            "preview": email.snippet[:100] + "..." if len(email.snippet) > 100 else email.snippet,
            "score": email.importance_score,
            "reason": email.importance_reason,
            "color": color,
            "urgency": urgency,
            "source": email.source
        })

    return {
        "status": "OK",
        "message": f"You have {len(formatted_emails)} important emails today.",
        "emails": formatted_emails
    }


if __name__ == "__main__":
    # Test the function
    result = fetch_daily_briefing()
    formatted = format_briefing_for_vera(result)
    print(json.dumps(formatted, indent=2))
