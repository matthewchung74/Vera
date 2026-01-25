import SwiftUI

/// A multiplatform view that shows voice-specific interaction controls.
///
/// Layout: ChatGPT-style transcript at top, orb at bottom.
/// - Agent messages: large, white, left-aligned
/// - User messages: faded, italic, right-aligned, quoted
/// - Orb: always visible at bottom as voice indicator
struct VoiceInteractionView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selectedAttachment: AttachmentInfo?

    var body: some View {
        if horizontalSizeClass == .regular {
            regular()
        } else {
            compact()
        }
    }

    @ViewBuilder
    private func regular() -> some View {
        HStack {
            // Transcript on left
            TranscriptListView(selectedAttachment: $selectedAttachment)
                .frame(maxWidth: .infinity)

            // Orb and local views on right
            VStack {
                Spacer()
                AgentView()
                    .frame(maxWidth: 40 * .grid, maxHeight: 40 * .grid)
                Spacer()
                ScreenShareView()
                LocalParticipantView()
            }
            .frame(width: 50 * .grid)
        }
        .safeAreaPadding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .attachmentViewer(attachment: $selectedAttachment)
    }

    @ViewBuilder
    private func compact() -> some View {
        ZStack {
            // Background
            Color.clear

            // Transcript list (scrollable, with bottom padding for orb)
            TranscriptListView(selectedAttachment: $selectedAttachment)
                .mask(
                    VStack(spacing: 0) {
                        // Full opacity at top
                        Rectangle()
                            .fill(Color.black)

                        // Gradient fade at bottom for orb area
                        LinearGradient(
                            colors: [.black, .black.opacity(0)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: 180)
                    }
                )

            // Orb at bottom
            VStack {
                Spacer()

                AgentView()
                    .frame(maxWidth: 60 * .grid, maxHeight: 40 * .grid)

                // Local participant views
                HStack {
                    Spacer()
                    ScreenShareView()
                    LocalParticipantView()
                }
                .frame(height: 50 * .grid)
                .padding(.horizontal)
            }
            .safeAreaPadding(.bottom)
        }
        .ignoresSafeArea(edges: .top)
        .attachmentViewer(attachment: $selectedAttachment)
    }
}

#Preview {
    VoiceInteractionView()
        .background(Color.black)
}
