import LiveKitComponents
import SwiftUI

/// ChatGPT-style transcript view with newest messages at top.
/// Agent responses are large and prominent, user questions are faded and quoted.
struct TranscriptListView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var attachmentManager: AttachmentManager
    @Binding var selectedAttachment: AttachmentInfo?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 24) {
                    // Show empty state greeting if no messages
                    if session.messages.isEmpty {
                        emptyState
                            .id("empty")
                    } else {
                        // Messages in reverse order (newest first)
                        ForEach(session.messages.reversed()) { message in
                            messageView(message)
                                .id(message.id)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 200) // Space for orb at bottom
            }
            .onChange(of: session.messages.count) { _, _ in
                // Scroll to top (newest message) when new message arrives
                withAnimation(.easeOut(duration: 0.3)) {
                    if let firstMessage = session.messages.last {
                        proxy.scrollTo(firstMessage.id, anchor: .top)
                    }
                }
                // Note: Attachments are cleared only when a NEW batch arrives (in AttachmentManager)
                // not on a timer, to avoid dropping slow-arriving data channel messages
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Text("Hello, I'm Vera")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(.white)

            Text("How can I help you today?")
                .font(.system(size: 18))
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    // MARK: - Message View

    @ViewBuilder
    private func messageView(_ message: ReceivedMessage) -> some View {
        switch message.content {
        case let .userTranscript(text), let .userInput(text):
            userMessage(text)
        case let .agentTranscript(text):
            agentMessage(text, messageId: message.id)
        }
    }

    // MARK: - Agent Message (Large, White, Left-aligned)

    private func agentMessage(_ text: String, messageId: UUID) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(text.trimmingCharacters(in: .whitespacesAndNewlines))
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(.white)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Show attachments if any (latest attachments shown with most recent message)
            if !attachmentManager.latestAttachments.isEmpty,
               message(isLatestAgentMessage: messageId)
            {
                attachmentIndicators
            }
        }
    }

    // MARK: - Attachment Indicators

    private var attachmentIndicators: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(attachmentManager.latestAttachments) { attachment in
                    AttachmentIndicator(attachment: attachment) {
                        selectedAttachment = attachment
                    }
                }
            }
        }
    }

    // MARK: - Helper

    private func message(isLatestAgentMessage messageId: UUID) -> Bool {
        // Find the latest agent message
        for message in session.messages.reversed() {
            if case .agentTranscript = message.content {
                return message.id == messageId
            }
        }
        return false
    }

    // MARK: - User Message (Faded, Italic, Right-aligned, Quoted)

    private func userMessage(_ text: String) -> some View {
        HStack {
            Spacer(minLength: 60)

            Text("\"\(text.trimmingCharacters(in: .whitespacesAndNewlines))\"")
                .font(.system(size: 16, weight: .regular))
                .italic()
                .foregroundStyle(Color(hex: "8A8A8A"))
                .lineSpacing(2)
                .multilineTextAlignment(.trailing)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.white.opacity(0.08))
                )
        }
    }
}

// MARK: - Attachment Info Model

struct AttachmentInfo: Identifiable, Equatable {
    let id: String
    let name: String
    let mimeType: String
    let size: Int
    let data: Data?
    let dataAvailable: Bool // True if data was included, false if file too large

    init(id: String, name: String, mimeType: String, size: Int, data: Data?, dataAvailable: Bool = true) {
        self.id = id
        self.name = name
        self.mimeType = mimeType
        self.size = size
        self.data = data
        self.dataAvailable = dataAvailable
    }

    var isImage: Bool {
        mimeType.hasPrefix("image/")
    }

    var isPDF: Bool {
        mimeType == "application/pdf" || name.lowercased().hasSuffix(".pdf")
    }

    var icon: String {
        if isImage { return "photo" }
        if isPDF { return "doc.fill" }
        return "paperclip"
    }

    var formattedSize: String {
        let kb = Double(size) / 1024
        if kb < 1024 {
            return String(format: "%.0f KB", kb)
        } else {
            return String(format: "%.1f MB", kb / 1024)
        }
    }

    /// Whether the file can be previewed (has data or is small enough)
    var canPreview: Bool {
        data != nil || dataAvailable
    }
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

#Preview {
    TranscriptListView(selectedAttachment: .constant(nil))
        .background(Color.black)
}
