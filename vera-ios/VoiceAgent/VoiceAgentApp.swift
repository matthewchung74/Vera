import LiveKit
import LiveKitComponents
import SwiftUI

@main
struct VeraApp: App {
    // Connect to local LiveKit server via token server
    // Update this URL when deploying to production
    private static let tokenServerURL = URL(string: "http://localhost:8080/token")!

    // Shared room instance for attachment manager to listen to data channel
    private let room: Room

    // Session for LiveKit voice interaction
    private let session: Session

    // LocalMedia for camera/screen share
    private let localMedia: LocalMedia

    // AttachmentManager observes data channel for attachment messages
    @StateObject private var attachmentManager = AttachmentManager()

    init() {
        // Create room with audio options
        let room = Room(
            roomOptions: RoomOptions(
                defaultAudioCaptureOptions: AudioCaptureOptions(
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                )
            )
        )
        self.room = room

        // Create session with the room
        let session = Session(
            tokenSource: EndpointTokenSource(
                url: Self.tokenServerURL,
                roomName: "vera-room",
                participantIdentity: "user-ios-\(Int(Date().timeIntervalSince1970))"
            ).cached(),
            options: SessionOptions(room: room)
        )
        self.session = session
        self.localMedia = LocalMedia(session: session)
    }

    var body: some Scene {
        WindowGroup {
            AppView()
                .environmentObject(session)
                .environmentObject(localMedia)
                .environmentObject(attachmentManager)
                .environment(\.voiceEnabled, true)
                .environment(\.videoEnabled, false) // Voice only for Vera
                .environment(\.textEnabled, false) // Voice only for Vera
                .onAppear {
                    // Connect attachment manager to room for data channel messages
                    attachmentManager.connect(to: room)
                }
        }
    }
}
