import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

// Complete auth session for web browser
WebBrowser.maybeCompleteAuthSession();

// Storage keys
const GMAIL_TOKEN_KEY = 'vera_gmail_token';
const GMAIL_REFRESH_KEY = 'vera_gmail_refresh';
const GMAIL_EXPIRY_KEY = 'vera_gmail_expiry';
const OUTLOOK_TOKEN_KEY = 'vera_outlook_token';
const OUTLOOK_REFRESH_KEY = 'vera_outlook_refresh';
const OUTLOOK_EXPIRY_KEY = 'vera_outlook_expiry';

// OAuth Configuration
// Gmail (Google Cloud Console)
const GMAIL_CLIENT_ID = '41951949194-d26a09o7dh81p9ftsj0gl69p7uka16vm.apps.googleusercontent.com';
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

// Outlook (Azure)
const OUTLOOK_CLIENT_ID = 'c8ba6d40-973c-455b-8a4b-1e2650136f14';
const OUTLOOK_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'offline_access',
];

// Discovery documents
const gmailDiscovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

const outlookDiscovery = {
  authorizationEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
};

// Google's reversed client ID for iOS URL scheme
const GOOGLE_IOS_SCHEME = 'com.googleusercontent.apps.41951949194-d26a09o7dh81p9ftsj0gl69p7uka16vm';

// ==================== Gmail ====================

export async function connectGmail(): Promise<boolean> {
  try {
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

    const result = await request.promptAsync(gmailDiscovery);
    console.log('Gmail auth result:', result.type);

    if (result.type === 'success' && result.params.code) {
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: GMAIL_CLIENT_ID,
          code: result.params.code,
          redirectUri,
          extraParams: {
            code_verifier: request.codeVerifier || '',
          },
        },
        gmailDiscovery
      );

      // Store token, refresh token, and expiry
      await SecureStore.setItemAsync(GMAIL_TOKEN_KEY, tokenResponse.accessToken);
      if (tokenResponse.refreshToken) {
        await SecureStore.setItemAsync(GMAIL_REFRESH_KEY, tokenResponse.refreshToken);
      }
      // Store expiry time (expiresIn is in seconds)
      const expiryTime = Date.now() + (tokenResponse.expiresIn || 3600) * 1000;
      await SecureStore.setItemAsync(GMAIL_EXPIRY_KEY, expiryTime.toString());

      console.log('Gmail tokens stored, expires in:', tokenResponse.expiresIn, 'seconds');
      return true;
    }

    return false;
  } catch (err) {
    console.error('Gmail auth error:', err);
    return false;
  }
}

async function refreshGmailToken(): Promise<boolean> {
  try {
    const refreshToken = await SecureStore.getItemAsync(GMAIL_REFRESH_KEY);
    if (!refreshToken) {
      console.log('[AUTH] refreshGmailToken: No refresh token available');
      return false;
    }

    console.log('[AUTH] refreshGmailToken: Starting refresh...');
    const startTime = Date.now();

    const tokenResponse = await AuthSession.refreshAsync(
      {
        clientId: GMAIL_CLIENT_ID,
        refreshToken,
      },
      gmailDiscovery
    );

    console.log(`[AUTH] refreshGmailToken: API call took ${Date.now() - startTime}ms`);

    await SecureStore.setItemAsync(GMAIL_TOKEN_KEY, tokenResponse.accessToken);
    if (tokenResponse.refreshToken) {
      await SecureStore.setItemAsync(GMAIL_REFRESH_KEY, tokenResponse.refreshToken);
    }
    const expiryTime = Date.now() + (tokenResponse.expiresIn || 3600) * 1000;
    await SecureStore.setItemAsync(GMAIL_EXPIRY_KEY, expiryTime.toString());

    console.log(`[AUTH] refreshGmailToken: Success, new expiry=${new Date(expiryTime).toISOString()}`);
    return true;
  } catch (err: any) {
    console.error('[AUTH] refreshGmailToken: Error:', err?.message || err);
    // Clear invalid tokens
    await disconnectGmail();
    return false;
  }
}

export async function getGmailToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(GMAIL_TOKEN_KEY);
  if (!token) {
    console.log('[AUTH] getGmailToken: No token stored');
    return null;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const expiryStr = await SecureStore.getItemAsync(GMAIL_EXPIRY_KEY);
  if (expiryStr) {
    const expiry = parseInt(expiryStr, 10);
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const timeLeft = expiry - now;

    console.log(`[AUTH] getGmailToken: expiry=${new Date(expiry).toISOString()}, timeLeft=${Math.round(timeLeft/1000)}s`);

    if (now > expiry - bufferTime) {
      console.log('[AUTH] getGmailToken: Token expired or expiring soon, attempting refresh...');
      const refreshed = await refreshGmailToken();
      if (refreshed) {
        console.log('[AUTH] getGmailToken: Refresh succeeded, returning new token');
        return SecureStore.getItemAsync(GMAIL_TOKEN_KEY);
      }
      console.log('[AUTH] getGmailToken: Refresh failed, returning null');
      return null; // Token expired and refresh failed
    }
  } else {
    console.log('[AUTH] getGmailToken: No expiry stored, returning token anyway');
  }

  console.log('[AUTH] getGmailToken: Token valid, returning');
  return token;
}

export async function disconnectGmail(): Promise<void> {
  await SecureStore.deleteItemAsync(GMAIL_TOKEN_KEY);
  await SecureStore.deleteItemAsync(GMAIL_REFRESH_KEY);
  await SecureStore.deleteItemAsync(GMAIL_EXPIRY_KEY);
}

export async function isGmailConnected(): Promise<boolean> {
  // Actually validate the token works
  const token = await getGmailToken(); // This will auto-refresh if needed
  if (!token) return false;

  try {
    // Quick validation call to Gmail API
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.status === 401) {
      console.log('[AUTH] Gmail validation got 401, trying one more refresh...');
      // Try refreshing one more time before giving up
      const refreshed = await refreshGmailToken();
      if (refreshed) {
        // Try validation again with new token
        const newToken = await SecureStore.getItemAsync(GMAIL_TOKEN_KEY);
        if (newToken) {
          const retryResponse = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/profile',
            { headers: { Authorization: `Bearer ${newToken}` } }
          );
          if (retryResponse.ok) {
            console.log('[AUTH] Gmail validation succeeded after retry');
            return true;
          }
        }
      }
      // Only clear if refresh also failed
      console.log('[AUTH] Gmail token invalid after retry, clearing...');
      await disconnectGmail();
      return false;
    }
    return response.ok;
  } catch (err) {
    console.error('Gmail validation error:', err);
    return false;
  }
}

// ==================== Outlook ====================

export async function connectOutlook(): Promise<boolean> {
  try {
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
      const expiryTime = Date.now() + (tokenResponse.expiresIn || 3600) * 1000;
      await SecureStore.setItemAsync(OUTLOOK_EXPIRY_KEY, expiryTime.toString());

      console.log('Outlook tokens stored, expires in:', tokenResponse.expiresIn, 'seconds');
      return true;
    }

    return false;
  } catch (err) {
    console.error('Outlook auth error:', err);
    return false;
  }
}

async function refreshOutlookToken(): Promise<boolean> {
  try {
    const refreshToken = await SecureStore.getItemAsync(OUTLOOK_REFRESH_KEY);
    if (!refreshToken) {
      console.log('No Outlook refresh token available');
      return false;
    }

    console.log('Refreshing Outlook token...');
    const tokenResponse = await AuthSession.refreshAsync(
      {
        clientId: OUTLOOK_CLIENT_ID,
        refreshToken,
      },
      outlookDiscovery
    );

    await SecureStore.setItemAsync(OUTLOOK_TOKEN_KEY, tokenResponse.accessToken);
    if (tokenResponse.refreshToken) {
      await SecureStore.setItemAsync(OUTLOOK_REFRESH_KEY, tokenResponse.refreshToken);
    }
    const expiryTime = Date.now() + (tokenResponse.expiresIn || 3600) * 1000;
    await SecureStore.setItemAsync(OUTLOOK_EXPIRY_KEY, expiryTime.toString());

    console.log('Outlook token refreshed successfully');
    return true;
  } catch (err) {
    console.error('Outlook refresh error:', err);
    await disconnectOutlook();
    return false;
  }
}

export async function getOutlookToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(OUTLOOK_TOKEN_KEY);
  if (!token) return null;

  // Check if token is expired or about to expire (within 5 minutes)
  const expiryStr = await SecureStore.getItemAsync(OUTLOOK_EXPIRY_KEY);
  if (expiryStr) {
    const expiry = parseInt(expiryStr, 10);
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (Date.now() > expiry - bufferTime) {
      console.log('Outlook token expired or expiring soon, attempting refresh...');
      const refreshed = await refreshOutlookToken();
      if (refreshed) {
        return SecureStore.getItemAsync(OUTLOOK_TOKEN_KEY);
      }
      return null;
    }
  }

  return token;
}

export async function disconnectOutlook(): Promise<void> {
  await SecureStore.deleteItemAsync(OUTLOOK_TOKEN_KEY);
  await SecureStore.deleteItemAsync(OUTLOOK_REFRESH_KEY);
  await SecureStore.deleteItemAsync(OUTLOOK_EXPIRY_KEY);
}

export async function isOutlookConnected(): Promise<boolean> {
  const token = await getOutlookToken(); // This will auto-refresh if needed
  if (!token) return false;

  try {
    // Validate against mail endpoint (works with Mail.Read scope, unlike /me which needs User.Read)
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id&$top=1',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.status === 401 || response.status === 403) {
      console.log(`[AUTH] Outlook validation got ${response.status}, trying one more refresh...`);
      // Try refreshing one more time before giving up
      const refreshed = await refreshOutlookToken();
      if (refreshed) {
        // Try validation again with new token
        const newToken = await SecureStore.getItemAsync(OUTLOOK_TOKEN_KEY);
        if (newToken) {
          const retryResponse = await fetch(
            'https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id&$top=1',
            { headers: { Authorization: `Bearer ${newToken}` } }
          );
          if (retryResponse.ok) {
            console.log('[AUTH] Outlook validation succeeded after retry');
            return true;
          }
        }
      }
      // Only clear if refresh also failed
      console.log('[AUTH] Outlook token invalid after retry, clearing...');
      await disconnectOutlook();
      return false;
    }
    return response.ok;
  } catch (err) {
    console.error('Outlook validation error:', err);
    return false;
  }
}
