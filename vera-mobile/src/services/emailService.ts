export interface EmailItem {
  subject: string;
  from: string;
  preview: string;
  source: 'gmail' | 'outlook';
}

// ==================== Gmail ====================

export async function fetchGmailEmails(token: string): Promise<EmailItem[]> {
  // Get message list
  const listResponse = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20',
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!listResponse.ok) {
    if (listResponse.status === 401) {
      throw new Error('NEEDS_REAUTH');
    }
    throw new Error(`Gmail API error: ${listResponse.status}`);
  }

  const listData = await listResponse.json();
  const messages = listData.messages || [];

  // Fetch details for each message (limit to 10)
  const emails: EmailItem[] = [];
  for (const msg of messages.slice(0, 10)) {
    try {
      const email = await fetchGmailMessageDetail(msg.id, token);
      emails.push(email);
    } catch (err) {
      console.error('Error fetching Gmail message:', err);
    }
  }

  return emails;
}

async function fetchGmailMessageDetail(messageId: string, token: string): Promise<EmailItem> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch message: ${response.status}`);
  }

  const data = await response.json();
  const headers = data.payload?.headers || [];

  const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
  const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';

  return {
    subject,
    from,
    preview: data.snippet || '',
    source: 'gmail',
  };
}

// ==================== Outlook ====================

export async function fetchOutlookEmails(token: string): Promise<EmailItem[]> {
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=id,subject,from,bodyPreview,receivedDateTime&$orderby=receivedDateTime desc',
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('NEEDS_REAUTH');
    }
    throw new Error(`Outlook API error: ${response.status}`);
  }

  const data = await response.json();
  const messages = data.value || [];

  return messages.map((msg: any) => ({
    subject: msg.subject || '(No Subject)',
    from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown',
    preview: msg.bodyPreview || '',
    source: 'outlook' as const,
  }));
}
