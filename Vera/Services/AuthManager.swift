//
//  AuthManager.swift
//  Vera
//
//  Handles OAuth authentication for Gmail and Outlook
//

import Foundation
import AuthenticationServices
import Combine

/// Manages OAuth tokens for email services
@MainActor
class AuthManager: ObservableObject {
    static let shared = AuthManager()

    // MARK: - Published State
    @Published var isGmailConnected = false
    @Published var isOutlookConnected = false
    @Published var isAuthenticating = false
    @Published var authError: String?

    // MARK: - Token Storage Keys
    private let gmailTokenKey = "vera_gmail_token"
    private let gmailRefreshTokenKey = "vera_gmail_refresh_token"
    private let outlookTokenKey = "vera_outlook_token"
    private let outlookRefreshTokenKey = "vera_outlook_refresh_token"

    // MARK: - Session Storage
    private var currentAuthSession: ASWebAuthenticationSession?

    // MARK: - OAuth Configuration

    // Gmail OAuth (replace with your values from Google Cloud Console)
    private let gmailClientId = "41951949194-d26a09o7dh81p9ftsj0gl69p7uka16vm.apps.googleusercontent.com"
    private let gmailRedirectUri = "com.mclabs.vera:/oauth2callback"
    private let gmailScopes = ["https://www.googleapis.com/auth/gmail.readonly"]

    // Outlook OAuth (from Azure)
    private let outlookClientId = "c8ba6d40-973c-455b-8a4b-1e2650136f14"
    private let outlookRedirectUri = "msauth.com.mclabs.Vera://auth"
    private let outlookScopes = ["https://graph.microsoft.com/Mail.Read",
                                  "https://graph.microsoft.com/Mail.Send",
                                  "https://graph.microsoft.com/Mail.ReadWrite"]

    // MARK: - Initialization

    private init() {
        loadTokenStatus()
    }

    private func loadTokenStatus() {
        isGmailConnected = KeychainHelper.load(key: gmailTokenKey) != nil
        isOutlookConnected = KeychainHelper.load(key: outlookTokenKey) != nil
    }

    // MARK: - Gmail OAuth

    func connectGmail() async {
        isAuthenticating = true
        authError = nil

        let authUrl = buildGmailAuthURL()

        do {
            let callbackUrl = try await performOAuth(url: authUrl, callbackScheme: "com.mclabs.vera")
            let code = extractCode(from: callbackUrl)

            if let code = code {
                let tokens = try await exchangeGmailCode(code)
                saveGmailTokens(tokens)
                isGmailConnected = true
            }
        } catch {
            authError = "Gmail connection failed: \(error.localizedDescription)"
        }

        isAuthenticating = false
    }

    private func buildGmailAuthURL() -> URL {
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: gmailClientId),
            URLQueryItem(name: "redirect_uri", value: gmailRedirectUri),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: gmailScopes.joined(separator: " ")),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent")
        ]
        return components.url!
    }

    private func exchangeGmailCode(_ code: String) async throws -> OAuthTokens {
        let url = URL(string: "https://oauth2.googleapis.com/token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "client_id": gmailClientId,
            "redirect_uri": gmailRedirectUri,
            "grant_type": "authorization_code",
            "code": code
        ].map { "\($0.key)=\($0.value)" }.joined(separator: "&")

        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(OAuthTokenResponse.self, from: data)

        return OAuthTokens(
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresIn: response.expires_in
        )
    }

    private func saveGmailTokens(_ tokens: OAuthTokens) {
        KeychainHelper.save(key: gmailTokenKey, data: tokens.accessToken.data(using: .utf8)!)
        if let refresh = tokens.refreshToken {
            KeychainHelper.save(key: gmailRefreshTokenKey, data: refresh.data(using: .utf8)!)
        }
    }

    // MARK: - Outlook OAuth

    func connectOutlook() async {
        isAuthenticating = true
        authError = nil

        let authUrl = buildOutlookAuthURL()
        print("DEBUG: Outlook auth URL: \(authUrl)")

        do {
            let callbackUrl = try await performOAuth(url: authUrl, callbackScheme: "msauth.com.mclabs.Vera")
            print("DEBUG: Callback URL received: \(callbackUrl)")
            let code = extractCode(from: callbackUrl)

            if let code = code {
                print("DEBUG: Got auth code, exchanging...")
                let tokens = try await exchangeOutlookCode(code)
                saveOutlookTokens(tokens)
                isOutlookConnected = true
            } else {
                // Check for error in callback
                let components = URLComponents(url: callbackUrl, resolvingAgainstBaseURL: false)
                let errorMsg = components?.queryItems?.first(where: { $0.name == "error_description" })?.value
                let error = components?.queryItems?.first(where: { $0.name == "error" })?.value
                print("DEBUG: No code found. Error: \(error ?? "none"), Description: \(errorMsg ?? "none")")
                authError = errorMsg ?? error ?? "No authorization code received"
            }
        } catch {
            print("DEBUG: Outlook error: \(error)")
            authError = "Outlook connection failed: \(error.localizedDescription)"
        }

        isAuthenticating = false
    }

    private func buildOutlookAuthURL() -> URL {
        var components = URLComponents(string: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: outlookClientId),
            URLQueryItem(name: "redirect_uri", value: outlookRedirectUri),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: outlookScopes.joined(separator: " ") + " offline_access"),
            URLQueryItem(name: "prompt", value: "consent")
        ]
        return components.url!
    }

    private func exchangeOutlookCode(_ code: String) async throws -> OAuthTokens {
        let url = URL(string: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "client_id": outlookClientId,
            "redirect_uri": outlookRedirectUri,
            "grant_type": "authorization_code",
            "code": code
        ].map { "\($0.key)=\($0.value)" }.joined(separator: "&")

        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(OAuthTokenResponse.self, from: data)

        return OAuthTokens(
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresIn: response.expires_in
        )
    }

    private func saveOutlookTokens(_ tokens: OAuthTokens) {
        KeychainHelper.save(key: outlookTokenKey, data: tokens.accessToken.data(using: .utf8)!)
        if let refresh = tokens.refreshToken {
            KeychainHelper.save(key: outlookRefreshTokenKey, data: refresh.data(using: .utf8)!)
        }
    }

    // MARK: - Token Retrieval (for backend)

    func getGmailToken() -> String? {
        guard let data = KeychainHelper.load(key: gmailTokenKey) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func getOutlookToken() -> String? {
        guard let data = KeychainHelper.load(key: outlookTokenKey) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Disconnect

    func disconnectGmail() {
        KeychainHelper.delete(key: gmailTokenKey)
        KeychainHelper.delete(key: gmailRefreshTokenKey)
        isGmailConnected = false
    }

    func disconnectOutlook() {
        KeychainHelper.delete(key: outlookTokenKey)
        KeychainHelper.delete(key: outlookRefreshTokenKey)
        isOutlookConnected = false
    }

    // MARK: - OAuth Helper

    private func performOAuth(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackURL, error in
                self?.currentAuthSession = nil
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let callbackURL = callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: AuthError.noCallback)
                }
            }

            session.presentationContextProvider = AuthPresentationContext.shared
            session.prefersEphemeralWebBrowserSession = false
            self.currentAuthSession = session
            if !session.start() {
                continuation.resume(throwing: AuthError.sessionStartFailed)
            }
        }
    }

    private func extractCode(from url: URL) -> String? {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        return components?.queryItems?.first(where: { $0.name == "code" })?.value
    }
}

// MARK: - Supporting Types

struct OAuthTokens {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int?
}

struct OAuthTokenResponse: Codable {
    let access_token: String
    let refresh_token: String?
    let expires_in: Int?
    let token_type: String?
}

enum AuthError: Error, LocalizedError {
    case noCallback
    case invalidResponse
    case tokenExpired
    case sessionStartFailed

    var errorDescription: String? {
        switch self {
        case .noCallback: return "No callback received"
        case .invalidResponse: return "Invalid response"
        case .tokenExpired: return "Token expired"
        case .sessionStartFailed: return "Failed to start auth session"
        }
    }
}

// MARK: - Presentation Context

class AuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = AuthPresentationContext()

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return ASPresentationAnchor()
        }
        return window
    }
}
