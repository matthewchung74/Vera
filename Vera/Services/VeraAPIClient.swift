//
//  VeraAPIClient.swift
//  Vera
//
//  API client for communicating with the Vera backend
//

import Foundation

/// Client for the Vera backend API
class VeraAPIClient {
    static let shared = VeraAPIClient()

    // TODO: Update this to your backend URL
    private let baseURL = "http://localhost:8000"

    private init() {}

    // MARK: - Email Briefing

    struct BriefingResponse: Codable {
        let status: String
        let message: String
        let emails: [EmailItem]
    }

    struct EmailItem: Codable {
        let subject: String
        let from: String
        let preview: String
        let score: Int
        let reason: String
        let color: String
        let urgency: String
        let source: String
    }

    /// Fetch the daily email briefing
    func fetchBriefing() async throws -> BriefingResponse {
        let authManager = await AuthManager.shared

        var request = URLRequest(url: URL(string: "\(baseURL)/api/briefing")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Include tokens in request
        let body: [String: Any?] = [
            "gmail_token": await authManager.getGmailToken(),
            "outlook_token": await authManager.getOutlookToken()
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 {
            throw APIError.needsReauth
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(BriefingResponse.self, from: data)
    }

    // MARK: - Direct Email Fetch (without backend)

    /// Fetch emails directly from Gmail API
    func fetchGmailEmailsDirect() async throws -> [EmailItem] {
        guard let token = await AuthManager.shared.getGmailToken() else {
            throw APIError.noToken
        }

        var request = URLRequest(url: URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)

        struct GmailListResponse: Codable {
            let messages: [GmailMessage]?
        }

        struct GmailMessage: Codable {
            let id: String
            let threadId: String
        }

        let listResponse = try JSONDecoder().decode(GmailListResponse.self, from: data)

        // Fetch details for each message
        var emails: [EmailItem] = []
        for message in listResponse.messages?.prefix(10) ?? [] {
            if let email = try? await fetchGmailMessageDetails(messageId: message.id, token: token) {
                emails.append(email)
            }
        }

        return emails
    }

    private func fetchGmailMessageDetails(messageId: String, token: String) async throws -> EmailItem {
        var request = URLRequest(url: URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages/\(messageId)?format=metadata&metadataHeaders=From&metadataHeaders=Subject")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)

        struct GmailMessageDetail: Codable {
            let id: String
            let snippet: String
            let payload: Payload?

            struct Payload: Codable {
                let headers: [Header]?
            }

            struct Header: Codable {
                let name: String
                let value: String
            }
        }

        let detail = try JSONDecoder().decode(GmailMessageDetail.self, from: data)

        let headers = detail.payload?.headers ?? []
        let subject = headers.first(where: { $0.name == "Subject" })?.value ?? "(No Subject)"
        let from = headers.first(where: { $0.name == "From" })?.value ?? "Unknown"

        return EmailItem(
            subject: subject,
            from: from,
            preview: detail.snippet,
            score: 5,
            reason: "",
            color: "BLUE",
            urgency: "For your information",
            source: "gmail"
        )
    }

    /// Fetch emails directly from Outlook/Microsoft Graph API
    func fetchOutlookEmailsDirect() async throws -> [EmailItem] {
        guard let token = await AuthManager.shared.getOutlookToken() else {
            throw APIError.noToken
        }

        var request = URLRequest(url: URL(string: "https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=id,subject,from,bodyPreview,receivedDateTime&$orderby=receivedDateTime desc")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)

        struct OutlookResponse: Codable {
            let value: [OutlookMessage]
        }

        struct OutlookMessage: Codable {
            let id: String
            let subject: String?
            let bodyPreview: String?
            let from: FromField?

            struct FromField: Codable {
                let emailAddress: EmailAddress

                struct EmailAddress: Codable {
                    let name: String?
                    let address: String?
                }
            }
        }

        let response = try JSONDecoder().decode(OutlookResponse.self, from: data)

        return response.value.map { msg in
            EmailItem(
                subject: msg.subject ?? "(No Subject)",
                from: msg.from?.emailAddress.name ?? msg.from?.emailAddress.address ?? "Unknown",
                preview: msg.bodyPreview ?? "",
                score: 5,
                reason: "",
                color: "BLUE",
                urgency: "For your information",
                source: "outlook"
            )
        }
    }
}

// MARK: - Errors

enum APIError: Error, LocalizedError {
    case invalidResponse
    case serverError(Int)
    case needsReauth
    case noToken

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .serverError(let code):
            return "Server error: \(code)"
        case .needsReauth:
            return "NEEDS_MATTHEW"
        case .noToken:
            return "Not connected to email"
        }
    }
}
