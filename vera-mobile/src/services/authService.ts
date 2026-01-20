import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

// Complete auth session for web browser
WebBrowser.maybeCompleteAuthSession();

// Storage keys
const GMAIL_TOKEN_KEY = 'vera_gmail_token';
const GMAIL_REFRESH_KEY = 'vera_gmail_refresh';
const OUTLOOK_TOKEN_KEY = 'vera_outlook_token';
const OUTLOOK_REFRESH_KEY = 'vera_outlook_refresh';

// OAuth Configuration
// Gmail (Google Cloud Console)
const GMAIL_CLIENT_ID = '41951949194-d26a09o7dh81p9ftsj0gl69p7uka16vm.apps.googleusercontent.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Outlook (Azure)
const OUTLOOK_CLIENT_ID = 'c8ba6d40-973c-455b-8a4b-1e2650136f14';
const OUTLOOK_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'offline_access',
];

// Discovery documents
const outlookDiscovery = {
  authorizationEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
};

// ==================== Gmail ====================

// Google's reversed client ID for iOS URL scheme
const GOOGLE_IOS_SCHEME = 'com.googleusercontent.apps.41951949194-d26a09o7dh81p9ftsj0gl69p7uka16vm';

export async function connectGmail(): Promise<boolean> {
  try {
    // Use Google's reversed client ID as the URL scheme (required for iOS)
    const redirectUri = `${GOOGLE_IOS_SCHEME}:/oauth2callback`;
    console.log('Gmail redirect URI:', redirectUri);

    const request = new AuthSession.AuthRequest({
      clientId: GMAIL_CLIENT_ID,
      scopes: GMAIL_SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    });

    const discovery = {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
    };

    const result = await request.promptAsync(discovery);
    console.log('Gmail auth result:', result.type);

    if (result.type === 'success' && result.params.code) {
      // Exchange code for token using PKCE
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: GMAIL_CLIENT_ID,
          code: result.params.code,
          redirectUri,
          extraParams: {
            code_verifier: request.codeVerifier || '',
          },
        },
        discovery
      );

      await SecureStore.setItemAsync(GMAIL_TOKEN_KEY, tokenResponse.accessToken);
      if (tokenResponse.refreshToken) {
        await SecureStore.setItemAsync(GMAIL_REFRESH_KEY, tokenResponse.refreshToken);
      }

      return true;
    }

    return false;
  } catch (err) {
    console.error('Gmail auth error:', err);
    return false;
  }
}

export async function getGmailToken(): Promise<string | null> {
  return SecureStore.getItemAsync(GMAIL_TOKEN_KEY);
}

export async function disconnectGmail(): Promise<void> {
  await SecureStore.deleteItemAsync(GMAIL_TOKEN_KEY);
  await SecureStore.deleteItemAsync(GMAIL_REFRESH_KEY);
}

export async function isGmailConnected(): Promise<boolean> {
  const token = await getGmailToken();
  return token !== null;
}

// ==================== Outlook ====================

export async function connectOutlook(): Promise<boolean> {
  try {
    // Use Expo's redirect URI generator for proper deep linking
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'msauth.com.mclabs.Vera',
      path: 'auth',
    });
    console.log('Outlook redirect URI:', redirectUri);

    const request = new AuthSession.AuthRequest({
      clientId: OUTLOOK_CLIENT_ID,
      scopes: OUTLOOK_SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        prompt: 'consent',
      },
    });

    const result = await request.promptAsync(outlookDiscovery);
    console.log('Outlook auth result:', result.type);

    if (result.type === 'success' && result.params.code) {
      // Exchange code for token using PKCE
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: OUTLOOK_CLIENT_ID,
          code: result.params.code,
          redirectUri,
          extraParams: {
            code_verifier: request.codeVerifier || '',
          },
        },
        outlookDiscovery
      );

      await SecureStore.setItemAsync(OUTLOOK_TOKEN_KEY, tokenResponse.accessToken);
      if (tokenResponse.refreshToken) {
        await SecureStore.setItemAsync(OUTLOOK_REFRESH_KEY, tokenResponse.refreshToken);
      }

      return true;
    }

    return false;
  } catch (err) {
    console.error('Outlook auth error:', err);
    return false;
  }
}

export async function getOutlookToken(): Promise<string | null> {
  return SecureStore.getItemAsync(OUTLOOK_TOKEN_KEY);
}

export async function disconnectOutlook(): Promise<void> {
  await SecureStore.deleteItemAsync(OUTLOOK_TOKEN_KEY);
  await SecureStore.deleteItemAsync(OUTLOOK_REFRESH_KEY);
}

export async function isOutlookConnected(): Promise<boolean> {
  const token = await getOutlookToken();
  return token !== null;
}
