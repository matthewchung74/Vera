"""
Vera OAuth Setup Script
Run this once to authenticate Gmail and Outlook.
"""

import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============ GMAIL AUTH ============
def setup_gmail():
    print("\n" + "="*50)
    print("GMAIL AUTHENTICATION")
    print("="*50)

    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.oauth2.credentials import Credentials

    SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
    creds_path = os.environ.get("VERA_GMAIL_CREDS", "credentials/gmail_credentials.json")
    token_path = os.environ.get("VERA_GMAIL_TOKEN", "tokens/gmail_token.json")

    if not os.path.exists(creds_path):
        print(f"ERROR: Gmail credentials not found at {creds_path}")
        return False

    try:
        flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
        creds = flow.run_local_server(port=8080)

        # Save the token
        os.makedirs(os.path.dirname(token_path), exist_ok=True)
        with open(token_path, "w") as token_file:
            token_file.write(creds.to_json())

        print(f"✓ Gmail token saved to {token_path}")
        return True

    except Exception as e:
        print(f"ERROR: Gmail auth failed: {e}")
        return False


# ============ OUTLOOK AUTH ============
def setup_outlook():
    print("\n" + "="*50)
    print("OUTLOOK AUTHENTICATION")
    print("="*50)

    import msal

    client_id = os.environ.get("VERA_OUTLOOK_CLIENT_ID")
    client_secret = os.environ.get("VERA_OUTLOOK_CLIENT_SECRET")
    tenant_id = os.environ.get("VERA_OUTLOOK_TENANT_ID", "common")
    token_path = os.environ.get("VERA_OUTLOOK_TOKEN", "tokens/outlook_token.json")

    if not client_id or client_id == "your-azure-app-client-id":
        print("ERROR: Outlook client ID not configured")
        return False

    SCOPES = ["https://graph.microsoft.com/Mail.Read",
              "https://graph.microsoft.com/Mail.Send",
              "https://graph.microsoft.com/Mail.ReadWrite"]

    try:
        # Use PublicClientApplication for device code flow (easier for desktop)
        app = msal.PublicClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
        )

        # Try device code flow
        flow = app.initiate_device_flow(scopes=SCOPES)

        if "user_code" not in flow:
            print(f"ERROR: Failed to create device flow: {flow.get('error_description', 'Unknown error')}")
            return False

        print(f"\n{flow['message']}\n")

        result = app.acquire_token_by_device_flow(flow)

        if "access_token" in result:
            # Save token info
            os.makedirs(os.path.dirname(token_path), exist_ok=True)
            token_data = {
                "access_token": result["access_token"],
                "refresh_token": result.get("refresh_token"),
                "token_type": result.get("token_type"),
                "expires_in": result.get("expires_in"),
                "scope": result.get("scope"),
                "account": result.get("id_token_claims", {})
            }
            with open(token_path, "w") as f:
                json.dump(token_data, f, indent=2)

            print(f"✓ Outlook token saved to {token_path}")
            return True
        else:
            print(f"ERROR: {result.get('error')}: {result.get('error_description')}")
            return False

    except Exception as e:
        print(f"ERROR: Outlook auth failed: {e}")
        return False


# ============ MAIN ============
if __name__ == "__main__":
    print("VERA - Email Authentication Setup")
    print("This will open browser windows to authenticate.\n")

    choice = input("Which service? (1=Gmail, 2=Outlook, 3=Both): ").strip()

    if choice in ["1", "3"]:
        setup_gmail()

    if choice in ["2", "3"]:
        setup_outlook()

    print("\n" + "="*50)
    print("Setup complete! You can now run email_briefing.py")
    print("="*50)
