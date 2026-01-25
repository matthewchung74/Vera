import PDFKit
import SwiftUI
import UIKit

/// Full-screen attachment viewer for images and PDFs.
/// Designed for elderly users with large buttons and simple controls.
struct AttachmentViewer: View {
    let attachment: AttachmentInfo
    let onDismiss: () -> Void

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            // Background
            Color.black.ignoresSafeArea()

            // Content
            if attachment.isImage {
                imageView
            } else if attachment.isPDF {
                pdfView
            } else {
                unsupportedView
            }

            // Header with Done button
            VStack {
                header
                Spacer()
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            // Filename
            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.name)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(attachment.formattedSize)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.6))
            }

            Spacer()

            // Large Done button (elderly-friendly)
            Button(action: onDismiss) {
                Text("Done")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.blue)
                    )
            }
            .accessibilityLabel("Close")
            .accessibilityHint("Double tap to close this viewer")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(
            LinearGradient(
                colors: [.black.opacity(0.8), .black.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    // MARK: - Image View

    private var imageView: some View {
        Group {
            if let data = attachment.data,
               let uiImage = UIImage(data: data)
            {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                let delta = value / lastScale
                                lastScale = value
                                scale = min(max(scale * delta, 1), 5)
                            }
                            .onEnded { _ in
                                lastScale = 1.0
                                if scale < 1.2 {
                                    withAnimation(.spring(response: 0.3)) {
                                        scale = 1.0
                                        offset = .zero
                                    }
                                }
                            }
                    )
                    .simultaneousGesture(
                        DragGesture()
                            .onChanged { value in
                                if scale > 1.0 {
                                    offset = CGSize(
                                        width: lastOffset.width + value.translation.width,
                                        height: lastOffset.height + value.translation.height
                                    )
                                }
                            }
                            .onEnded { _ in
                                lastOffset = offset
                            }
                    )
                    .onTapGesture(count: 2) {
                        withAnimation(.spring(response: 0.3)) {
                            if scale > 1.0 {
                                scale = 1.0
                                offset = .zero
                                lastOffset = .zero
                            } else {
                                scale = 2.5
                            }
                        }
                    }
            } else if !attachment.dataAvailable {
                fileTooLargeView
            } else {
                loadingView
            }
        }
    }

    // MARK: - PDF View

    private var pdfView: some View {
        Group {
            if let data = attachment.data {
                PDFKitView(data: data)
                    .ignoresSafeArea(edges: .bottom)
            } else if !attachment.dataAvailable {
                fileTooLargeView
            } else {
                loadingView
            }
        }
    }

    // MARK: - File Too Large View

    private var fileTooLargeView: some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.arrow.triangle.2.circlepath")
                .font(.system(size: 60))
                .foregroundStyle(.yellow.opacity(0.7))

            Text("File too large to preview")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(.white)

            Text(attachment.formattedSize)
                .font(.system(size: 16))
                .foregroundStyle(.white.opacity(0.6))

            Text("Ask Vera to forward this email\nif you need to view the attachment")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.5))
                .multilineTextAlignment(.center)
                .padding(.top, 8)
        }
    }

    // MARK: - Unsupported View

    private var unsupportedView: some View {
        VStack(spacing: 20) {
            Image(systemName: "doc.questionmark")
                .font(.system(size: 60))
                .foregroundStyle(.white.opacity(0.5))

            Text("Cannot preview this file type")
                .font(.system(size: 18))
                .foregroundStyle(.white.opacity(0.7))

            Text(attachment.mimeType)
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.4))
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
                .tint(.white)

            Text("Loading...")
                .font(.system(size: 16))
                .foregroundStyle(.white.opacity(0.6))
        }
    }
}

// MARK: - PDFKit SwiftUI Wrapper

struct PDFKitView: UIViewRepresentable {
    let data: Data

    func makeUIView(context _: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.backgroundColor = .black
        pdfView.pageShadowsEnabled = false

        if let document = PDFDocument(data: data) {
            pdfView.document = document
        }

        return pdfView
    }

    func updateUIView(_ pdfView: PDFView, context _: Context) {
        if pdfView.document == nil,
           let document = PDFDocument(data: data)
        {
            pdfView.document = document
        }
    }
}

// MARK: - Sheet Modifier

extension View {
    func attachmentViewer(
        attachment: Binding<AttachmentInfo?>,
        onDismiss: @escaping () -> Void = {}
    ) -> some View {
        fullScreenCover(item: attachment) { att in
            AttachmentViewer(attachment: att) {
                attachment.wrappedValue = nil
                onDismiss()
            }
        }
    }
}

#Preview {
    AttachmentViewer(
        attachment: AttachmentInfo(
            id: "1",
            name: "sample_document.pdf",
            mimeType: "application/pdf",
            size: 245000,
            data: nil
        )
    ) {}
}
