import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  connectGmail,
  disconnectGmail,
  isGmailConnected,
  getGmailToken,
  connectOutlook,
  disconnectOutlook,
  isOutlookConnected,
  getOutlookToken,
} from '../src/services/authService';
import {
  fetchGmailEmails,
  fetchOutlookEmails,
  EmailItem,
} from '../src/services/emailService';

// Email with importance analysis
interface AnalyzedEmail extends EmailItem {
  importance?: 'high' | 'medium' | 'low';
  category?: string;
}

// Gemini API for email analysis
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

async function analyzeEmailImportance(emails: EmailItem[]): Promise<AnalyzedEmail[]> {
  if (!GEMINI_API_KEY || emails.length === 0) {
    return emails.map(e => ({ ...e, importance: 'low' as const, category: 'Unknown' }));
  }

  try {
    const emailSummaries = emails.map((e, i) =>
      `${i + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   Preview: ${e.preview.slice(0, 100)}`
    ).join('\n\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are analyzing emails for an elderly woman. Categorize each email's importance.

IMPORTANT (high): Personal emails from family/friends, medical appointments, unpaid bills, urgent matters
REVIEW (medium): Newsletters she subscribed to, order confirmations, appointment reminders
IGNORE (low): Marketing, spam, promotions, automated notifications

For each email, respond with ONLY a JSON array like:
[{"index": 1, "importance": "high", "category": "Family"}, ...]

Emails to analyze:
${emailSummaries}`
            }]
          }],
          generationConfig: { temperature: 0.1 }
        }),
      }
    );

    if (!response.ok) {
      console.error('Gemini API error:', response.status);
      return emails.map(e => ({ ...e, importance: 'low' as const, category: 'Unknown' }));
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return emails.map((email, i) => {
        const result = analysis.find((a: any) => a.index === i + 1);
        return {
          ...email,
          importance: result?.importance || 'low',
          category: result?.category || 'Unknown',
        };
      });
    }
  } catch (err) {
    console.error('Email analysis error:', err);
  }

  return emails.map(e => ({ ...e, importance: 'low' as const, category: 'Unknown' }));
}

export default function AdminScreen() {
  const [gmailConnected, setGmailConnected] = useState(false);
  const [outlookConnected, setOutlookConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [emails, setEmails] = useState<AnalyzedEmail[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    loadConnectionStatus();
  }, []);

  const handleFetchEmails = async () => {
    setIsFetching(true);
    setEmails([]);

    try {
      const allEmails: EmailItem[] = [];

      // Fetch Gmail emails
      if (gmailConnected) {
        const gmailToken = await getGmailToken();
        if (gmailToken) {
          try {
            const gmailEmails = await fetchGmailEmails(gmailToken);
            allEmails.push(...gmailEmails);
          } catch (err: any) {
            if (err.message === 'NEEDS_REAUTH') {
              Alert.alert('Gmail Session Expired', 'Please reconnect Gmail.');
              await disconnectGmail();
              setGmailConnected(false);
            }
          }
        }
      }

      // Fetch Outlook emails
      if (outlookConnected) {
        const outlookToken = await getOutlookToken();
        if (outlookToken) {
          try {
            const outlookEmails = await fetchOutlookEmails(outlookToken);
            allEmails.push(...outlookEmails);
          } catch (err: any) {
            if (err.message === 'NEEDS_REAUTH') {
              Alert.alert('Outlook Session Expired', 'Please reconnect Outlook.');
              await disconnectOutlook();
              setOutlookConnected(false);
            }
          }
        }
      }

      if (allEmails.length === 0) {
        Alert.alert('No Emails', 'No emails found or no accounts connected.');
        setIsFetching(false);
        return;
      }

      // Analyze with Gemini
      setIsFetching(false);
      setIsAnalyzing(true);
      const analyzed = await analyzeEmailImportance(allEmails);

      // Sort by importance (high first)
      analyzed.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.importance || 'low'] || 2) - (order[b.importance || 'low'] || 2);
      });

      setEmails(analyzed);
    } catch (err) {
      console.error('Fetch emails error:', err);
      Alert.alert('Error', 'Failed to fetch emails.');
    } finally {
      setIsFetching(false);
      setIsAnalyzing(false);
    }
  };

  const getImportanceColor = (importance?: string) => {
    switch (importance) {
      case 'high': return '#FF3B30'; // Red - important
      case 'medium': return '#FF9500'; // Orange - review
      default: return '#8E8E93'; // Gray - ignore
    }
  };

  const getImportanceIcon = (importance?: string) => {
    switch (importance) {
      case 'high': return 'alert-circle';
      case 'medium': return 'time';
      default: return 'remove-circle';
    }
  };

  const loadConnectionStatus = async () => {
    const gmail = await isGmailConnected();
    const outlook = await isOutlookConnected();
    setGmailConnected(gmail);
    setOutlookConnected(outlook);
  };

  const handleConnectGmail = async () => {
    setIsConnecting(true);
    try {
      const success = await connectGmail();
      if (success) {
        setGmailConnected(true);
        Alert.alert('Success', 'Gmail connected successfully!');
      } else {
        Alert.alert('Cancelled', 'Gmail connection was cancelled.');
      }
    } catch (error: any) {
      console.error('Gmail connect error:', error);
      Alert.alert('Gmail Error', error?.message || 'Failed to connect Gmail. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectGmail = async () => {
    await disconnectGmail();
    setGmailConnected(false);
  };

  const handleConnectOutlook = async () => {
    setIsConnecting(true);
    try {
      const success = await connectOutlook();
      if (success) {
        setOutlookConnected(true);
        Alert.alert('Success', 'Outlook connected successfully!');
      } else {
        Alert.alert('Cancelled', 'Outlook connection was cancelled.');
      }
    } catch (error) {
      console.error('Outlook connect error:', error);
      Alert.alert('Error', 'Failed to connect Outlook. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectOutlook = async () => {
    await disconnectOutlook();
    setOutlookConnected(false);
  };

  return (
    <ScrollView style={styles.container}>
      {/* Email Accounts Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Email Accounts</Text>

        {/* Gmail */}
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="mail" size={24} color="#EA4335" />
            <Text style={styles.rowText}>Gmail</Text>
          </View>
          {gmailConnected ? (
            <View style={styles.rowRight}>
              <Ionicons name="checkmark-circle" size={20} color="#34A853" />
              <TouchableOpacity onPress={handleDisconnectGmail}>
                <Text style={styles.disconnectText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={handleConnectGmail} disabled={isConnecting}>
              <Text style={styles.connectText}>Connect</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Outlook */}
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="mail" size={24} color="#0078D4" />
            <Text style={styles.rowText}>Outlook</Text>
          </View>
          {outlookConnected ? (
            <View style={styles.rowRight}>
              <Ionicons name="checkmark-circle" size={20} color="#34A853" />
              <TouchableOpacity onPress={handleDisconnectOutlook}>
                <Text style={styles.disconnectText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={handleConnectOutlook} disabled={isConnecting}>
              <Text style={styles.connectText}>Connect</Text>
            </TouchableOpacity>
          )}
        </View>

        {isConnecting && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" />
            <Text style={styles.loadingText}>Connecting...</Text>
          </View>
        )}
      </View>

      {/* Fetch Emails Section */}
      {(gmailConnected || outlookConnected) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Emails</Text>

          <TouchableOpacity
            style={styles.fetchButton}
            onPress={handleFetchEmails}
            disabled={isFetching || isAnalyzing}
          >
            {isFetching ? (
              <>
                <ActivityIndicator size="small" color="white" />
                <Text style={styles.fetchButtonText}>Fetching emails...</Text>
              </>
            ) : isAnalyzing ? (
              <>
                <ActivityIndicator size="small" color="white" />
                <Text style={styles.fetchButtonText}>Analyzing with AI...</Text>
              </>
            ) : (
              <>
                <Ionicons name="refresh" size={20} color="white" />
                <Text style={styles.fetchButtonText}>Fetch Emails</Text>
              </>
            )}
          </TouchableOpacity>

          {emails.length > 0 && (
            <View style={styles.emailList}>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <Ionicons name="alert-circle" size={14} color="#FF3B30" />
                  <Text style={styles.legendText}>Important</Text>
                </View>
                <View style={styles.legendItem}>
                  <Ionicons name="time" size={14} color="#FF9500" />
                  <Text style={styles.legendText}>Review</Text>
                </View>
                <View style={styles.legendItem}>
                  <Ionicons name="remove-circle" size={14} color="#8E8E93" />
                  <Text style={styles.legendText}>Ignore</Text>
                </View>
              </View>

              {emails.map((email, index) => (
                <View key={index} style={styles.emailItem}>
                  <View style={styles.emailHeader}>
                    <Ionicons
                      name={getImportanceIcon(email.importance) as any}
                      size={18}
                      color={getImportanceColor(email.importance)}
                    />
                    <Text style={styles.emailCategory}>{email.category}</Text>
                    <View style={[
                      styles.sourceBadge,
                      { backgroundColor: email.source === 'gmail' ? '#EA4335' : '#0078D4' }
                    ]}>
                      <Text style={styles.sourceBadgeText}>
                        {email.source === 'gmail' ? 'G' : 'O'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.emailFrom} numberOfLines={1}>{email.from}</Text>
                  <Text style={styles.emailSubject} numberOfLines={1}>{email.subject}</Text>
                  <Text style={styles.emailPreview} numberOfLines={2}>{email.preview}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.aboutText}>Version 1.0.0 (React Native)</Text>
        <Text style={styles.aboutText}>For Caregivers Only</Text>
      </View>

      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  section: {
    backgroundColor: 'white',
    marginTop: 20,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowText: {
    fontSize: 16,
    color: '#333',
  },
  connectText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  disconnectText: {
    fontSize: 12,
    color: '#FF3B30',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
  },
  aboutText: {
    fontSize: 14,
    color: '#666',
    paddingVertical: 4,
  },
  fetchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    gap: 8,
  },
  fetchButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  emailList: {
    marginTop: 16,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendText: {
    fontSize: 11,
    color: '#666',
  },
  emailItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
  },
  emailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  emailCategory: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  sourceBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
  emailFrom: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  emailSubject: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  emailPreview: {
    fontSize: 13,
    color: '#888',
    lineHeight: 18,
  },
});
