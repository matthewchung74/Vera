//
//  ContentView.swift
//  Vera
//
//  Created by Matt Chung on 1/12/26.
//

import SwiftUI

struct ContentView: View {
    // MARK: - State
    @StateObject private var cameraManager = CameraManager()
    @StateObject private var speechManager = SpeechManager()
    @State private var captionText = "Hello, I'm Vera.\nTap the green circle to talk to me."
    @State private var showAdminPanel = false

    // MARK: - Colors (Soft cream palette)
    private let backgroundColor = Color(red: 0.98, green: 0.96, blue: 0.92)
    private let textColor = Color(red: 0.2, green: 0.2, blue: 0.25)

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Soft cream background
            backgroundColor
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // MARK: - Top: Camera Preview
                CameraAreaView(cameraManager: cameraManager, textColor: textColor)
                    .frame(height: 340)
                    .padding(.top, 60)

                // MARK: - Bottom: Caption + Orb
                VStack {
                    // Caption text
                    ScrollView(showsIndicators: false) {
                        Text(captionText)
                            .font(.system(size: 52, weight: .heavy, design: .rounded))
                            .foregroundColor(textColor)
                            .multilineTextAlignment(.leading)
                            .lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 24)
                            .padding(.top, 16)
                            .padding(.bottom, 140)
                    }

                    Spacer()
                }
                .frame(maxHeight: .infinity)
                .overlay(alignment: .bottomTrailing) {
                    // Listen orb - anchored to bottom right
                    ListenOrb(isListening: $speechManager.isListening) {
                        toggleListening()
                    }
                    .padding(.trailing, 24)
                    .padding(.bottom, 50)
                }
            }

            // MARK: - Hamburger Menu (Top Left)
            Button(action: { showAdminPanel = true }) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(textColor.opacity(0.4))
                    .frame(width: 50, height: 50)
                    .contentShape(Rectangle())
            }
            .padding(.top, 8)
            .padding(.leading, 16)
        }
        .sheet(isPresented: $showAdminPanel) {
            AdminPanelView()
        }
        .onAppear {
            speechManager.checkAuthorization()
        }
        .onChange(of: speechManager.transcribedText) { _, newValue in
            if !newValue.isEmpty {
                captionText = newValue
            }
        }
        .onChange(of: speechManager.isListening) { _, isListening in
            if !isListening && speechManager.transcribedText.isEmpty {
                captionText = "Hello, I'm Vera.\nTap the green circle to talk to me."
            }
        }
    }

    // MARK: - Actions

    private func toggleListening() {
        if speechManager.isListening {
            speechManager.stopListening()
            // Process what the user said
            if !speechManager.transcribedText.isEmpty {
                processUserInput(speechManager.transcribedText)
            } else {
                captionText = "Hello, I'm Vera.\nTap the green circle to talk to me."
            }
        } else {
            captionText = "I'm listening..."
            speechManager.startListening()
        }
    }

    private func processUserInput(_ input: String) {
        // For now, just echo back what was heard
        // Later this will integrate with Gemini
        let response = "I heard you say: \"\(input)\""
        captionText = response
        speechManager.speak(response)
    }
}

// MARK: - Camera Area View
struct CameraAreaView: View {
    @ObservedObject var cameraManager: CameraManager
    let textColor: Color

    var body: some View {
        // Always show the placeholder/background
        RoundedRectangle(cornerRadius: 24)
            .fill(Color(red: 0.88, green: 0.85, blue: 0.80))
            .padding(.horizontal, 20)
            .overlay(
                Group {
                    if cameraManager.isRunning {
                        // Show live camera feed
                        CameraPreviewView(cameraManager: cameraManager)
                            .clipShape(RoundedRectangle(cornerRadius: 24))
                            .padding(.horizontal, 20)
                    } else {
                        // Show placeholder content
                        VStack(spacing: 16) {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 56, weight: .light))
                                .foregroundColor(textColor.opacity(0.4))
                            Text(cameraManager.isAuthorized ? "Camera loading..." : "Tap to enable camera")
                                .font(.system(size: 22, weight: .medium, design: .rounded))
                                .foregroundColor(textColor.opacity(0.5))
                        }
                    }
                }
            )
            .onTapGesture {
                if !cameraManager.isAuthorized {
                    cameraManager.checkAuthorization()
                }
            }
    }
}

// MARK: - Admin Panel (Hidden)
struct AdminPanelView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var authManager = AuthManager.shared
    @State private var fetchedEmails: [VeraAPIClient.EmailItem] = []
    @State private var isFetchingEmails = false
    @State private var fetchError: String?

    var body: some View {
        NavigationView {
            List {
                // MARK: - Email Accounts
                Section("Email Accounts") {
                    // Gmail
                    HStack {
                        Image(systemName: "envelope.fill")
                            .foregroundColor(.red)
                            .frame(width: 30)
                        Text("Gmail")
                        Spacer()
                        if authManager.isGmailConnected {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Button("Disconnect") {
                                authManager.disconnectGmail()
                            }
                            .foregroundColor(.red)
                            .font(.caption)
                        } else {
                            Button("Connect") {
                                Task { await authManager.connectGmail() }
                            }
                            .foregroundColor(.blue)
                        }
                    }

                    // Outlook
                    HStack {
                        Image(systemName: "envelope.fill")
                            .foregroundColor(.blue)
                            .frame(width: 30)
                        Text("Outlook")
                        Spacer()
                        if authManager.isOutlookConnected {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Button("Disconnect") {
                                authManager.disconnectOutlook()
                            }
                            .foregroundColor(.red)
                            .font(.caption)
                        } else {
                            Button("Connect") {
                                Task { await authManager.connectOutlook() }
                            }
                            .foregroundColor(.blue)
                        }
                    }

                    if authManager.isAuthenticating {
                        HStack {
                            ProgressView()
                                .padding(.trailing, 8)
                            Text("Connecting...")
                                .foregroundColor(.secondary)
                        }
                    }

                    if let error = authManager.authError {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }

                // MARK: - Settings
                Section("Settings") {
                    Text("Text Size")
                    Text("Voice Settings")
                    Text("Camera Settings")
                }

                // MARK: - Debug
                Section("Debug") {
                    Text("View Logs")
                    Button("Test Email Fetch") {
                        Task { await testEmailFetch() }
                    }
                    .disabled(isFetchingEmails)

                    if isFetchingEmails {
                        HStack {
                            ProgressView()
                                .padding(.trailing, 8)
                            Text("Fetching emails...")
                                .foregroundColor(.secondary)
                        }
                    }

                    if let error = fetchError {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }

                    Text("Reset App")
                }

                // MARK: - Fetched Emails
                if !fetchedEmails.isEmpty {
                    Section("Fetched Emails (\(fetchedEmails.count))") {
                        ForEach(fetchedEmails, id: \.subject) { email in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(email.source.uppercased())
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(email.source == "gmail" ? Color.red.opacity(0.2) : Color.blue.opacity(0.2))
                                        .cornerRadius(4)
                                    Spacer()
                                }
                                Text(email.subject)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .lineLimit(1)
                                Text(email.from)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .lineLimit(1)
                                Text(email.preview)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .lineLimit(2)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }

                // MARK: - About
                Section("About") {
                    Text("Version 1.0")
                    Text("For Caregivers Only")
                }
            }
            .navigationTitle("Admin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func testEmailFetch() async {
        isFetchingEmails = true
        fetchError = nil
        fetchedEmails = []

        var allEmails: [VeraAPIClient.EmailItem] = []

        // Fetch Gmail
        if authManager.isGmailConnected {
            do {
                let gmailEmails = try await VeraAPIClient.shared.fetchGmailEmailsDirect()
                allEmails.append(contentsOf: gmailEmails)
                print("DEBUG: Fetched \(gmailEmails.count) Gmail emails")
            } catch {
                print("DEBUG: Gmail fetch error: \(error)")
                fetchError = "Gmail: \(error.localizedDescription)"
            }
        }

        // Fetch Outlook
        if authManager.isOutlookConnected {
            do {
                let outlookEmails = try await VeraAPIClient.shared.fetchOutlookEmailsDirect()
                allEmails.append(contentsOf: outlookEmails)
                print("DEBUG: Fetched \(outlookEmails.count) Outlook emails")
            } catch {
                print("DEBUG: Outlook fetch error: \(error)")
                let existingError = fetchError ?? ""
                fetchError = existingError + (existingError.isEmpty ? "" : "\n") + "Outlook: \(error.localizedDescription)"
            }
        }

        fetchedEmails = allEmails
        isFetchingEmails = false
    }
}

#Preview {
    ContentView()
}
