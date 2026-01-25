import SwiftUI

/// Tappable pill that shows attachment info (icon + filename).
/// Designed for elderly users - large tap target, clear visual feedback.
struct AttachmentIndicator: View {
    let attachment: AttachmentInfo
    let onTap: () -> Void

    @State private var isPressed = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                // Icon
                Image(systemName: attachment.icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(iconColor)

                // Filename
                Text(attachment.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .truncationMode(.middle)

                // Size badge
                Text(attachment.formattedSize)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(.white.opacity(0.5))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color.white.opacity(isPressed ? 0.15 : 0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(AttachmentButtonStyle(isPressed: $isPressed))
        .accessibilityLabel("Open \(attachment.name)")
        .accessibilityHint("Double tap to view this attachment")
    }

    private var iconColor: Color {
        if attachment.isImage {
            return .green
        } else if attachment.isPDF {
            return .red
        } else {
            return .blue
        }
    }
}

// MARK: - Button Style

private struct AttachmentButtonStyle: ButtonStyle {
    @Binding var isPressed: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, newValue in
                isPressed = newValue
            }
    }
}

// MARK: - Attachment Row (Multiple attachments)

struct AttachmentRow: View {
    let attachments: [AttachmentInfo]
    let onSelect: (AttachmentInfo) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(attachments) { attachment in
                    AttachmentIndicator(attachment: attachment) {
                        onSelect(attachment)
                    }
                }
            }
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        AttachmentIndicator(
            attachment: AttachmentInfo(
                id: "1",
                name: "boarding_pass.pdf",
                mimeType: "application/pdf",
                size: 245000,
                data: nil
            )
        ) {}

        AttachmentIndicator(
            attachment: AttachmentInfo(
                id: "2",
                name: "photo.jpg",
                mimeType: "image/jpeg",
                size: 1500000,
                data: nil
            )
        ) {}

        AttachmentIndicator(
            attachment: AttachmentInfo(
                id: "3",
                name: "document.txt",
                mimeType: "text/plain",
                size: 12000,
                data: nil
            )
        ) {}
    }
    .padding()
    .background(Color.black)
}
