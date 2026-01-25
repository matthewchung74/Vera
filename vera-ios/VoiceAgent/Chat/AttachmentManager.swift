import Combine
import Foundation
import LiveKit
import SwiftUI

/// Manages attachments received via LiveKit data channel.
/// Observes the room for data messages and stores attachment info for display.
@MainActor
class AttachmentManager: ObservableObject {
    /// Current batch of attachments (cleared when new batch arrives)
    @Published private(set) var latestAttachments: [AttachmentInfo] = []

    /// Timestamp of last attachment batch (for staleness detection)
    @Published private(set) var lastBatchTimestamp: Date?

    private var room: Room?
    private var currentBatchId: String?

    init() {}

    /// Connect to a LiveKit room to receive attachment data
    func connect(to room: Room) {
        self.room = room
        room.delegates.add(delegate: self)
    }

    /// Disconnect from room
    func disconnect() {
        room?.delegates.remove(delegate: self)
        room = nil
    }

    /// Clear all attachments (call when conversation resets or session ends)
    func clearAll() {
        latestAttachments.removeAll()
        currentBatchId = nil
        lastBatchTimestamp = nil
    }

    // Note: Attachments are only cleared when a NEW batch arrives (different email).
    // This avoids dropping attachments due to slow data channel delivery.
    // Old attachments from the same email persist until user asks about a different email.

    /// Add an attachment from a new batch
    private func addAttachment(_ info: AttachmentInfo, batchId: String) {
        // If this is a new batch, clear previous attachments
        if currentBatchId != batchId {
            latestAttachments.removeAll()
            currentBatchId = batchId
        }

        latestAttachments.append(info)
        lastBatchTimestamp = Date()

        // Safety limit: never keep more than 10 attachments
        if latestAttachments.count > 10 {
            latestAttachments = Array(latestAttachments.suffix(10))
        }
    }

    /// Parse attachment JSON from data channel
    private func parseAttachment(from data: Data) -> (AttachmentInfo, String)? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String,
              type == "attachment"
        else {
            return nil
        }

        let id = json["id"] as? String ?? UUID().uuidString
        let name = json["name"] as? String ?? "unknown"
        let mimeType = json["mimeType"] as? String ?? "application/octet-stream"
        let size = json["size"] as? Int ?? 0
        let dataAvailable = json["dataAvailable"] as? Bool ?? true

        // Decode base64 data if present
        var fileData: Data?
        if let base64String = json["data"] as? String {
            fileData = Data(base64Encoded: base64String)
        }

        // Extract batch ID from attachment ID
        // Format: "gmail_<msgid>_<filename>" or "outlook_<msgid>_<filename>"
        // We need "gmail_<msgid>" or "outlook_<msgid>" as the batch ID
        let components = id.components(separatedBy: "_")
        let batchId: String
        if components.count >= 2 {
            // Join first two components: "gmail" + "_" + "<msgid>"
            batchId = components.prefix(2).joined(separator: "_")
        } else {
            batchId = id
        }

        let attachment = AttachmentInfo(
            id: id,
            name: name,
            mimeType: mimeType,
            size: size,
            data: fileData,
            dataAvailable: dataAvailable
        )

        return (attachment, batchId)
    }
}

// MARK: - RoomDelegate

extension AttachmentManager: RoomDelegate {
    nonisolated func room(_: Room, participant _: RemoteParticipant?, didReceiveData data: Data, forTopic topic: String) {
        // Only process attachment topic
        guard topic == "attachment" else { return }

        Task { @MainActor in
            if let (attachment, batchId) = parseAttachment(from: data) {
                addAttachment(attachment, batchId: batchId)
            }
        }
    }

    nonisolated func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) {
        // Clear attachments when disconnecting to prevent stale data in next session
        if connectionState == .disconnected {
            Task { @MainActor in
                clearAll()
            }
        }
    }
}

// MARK: - Environment Key

struct AttachmentManagerKey: EnvironmentKey {
    static let defaultValue = AttachmentManager()
}

extension EnvironmentValues {
    var attachmentManager: AttachmentManager {
        get { self[AttachmentManagerKey.self] }
        set { self[AttachmentManagerKey.self] = newValue }
    }
}
