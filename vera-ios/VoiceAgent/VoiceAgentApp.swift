import LiveKit
import LiveKitComponents
import SwiftUI

@main
struct VeraApp: App {
    // Connect to local LiveKit server via token server
    // Update this URL when deploying to production
    private static let tokenServerURL = URL(string: "http://localhost:8080/token")!

    private let session = Session(
        tokenSource: EndpointTokenSource(
            url: tokenServerURL,
            roomName: "vera-room",
            participantIdentity: "user-ios-\(Int(Date().timeIntervalSince1970))"
        ).cached(),
        options: SessionOptions(
            room: Room(
                roomOptions: RoomOptions(
                    defaultAudioCaptureOptions: AudioCaptureOptions(
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    )
                )
            )
        )
    )

    var body: some Scene {
        WindowGroup {
            AppView()
                .environmentObject(session)
                .environmentObject(LocalMedia(session: session))
                .environment(\.voiceEnabled, true)
                .environment(\.videoEnabled, false)  // Voice only for Vera
                .environment(\.textEnabled, false)   // Voice only for Vera
        }
    }
}
