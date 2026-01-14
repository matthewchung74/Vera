//
//  ListenOrb.swift
//  Vera
//
//  Created by Matt Chung on 1/12/26.
//

import SwiftUI

/// A pulsing orb that indicates listening state
/// Designed for elderly users - large, clear visual feedback
struct ListenOrb: View {
    @Binding var isListening: Bool
    var onTap: () -> Void

    @State private var pulseScale: CGFloat = 1.0
    @State private var pulseOpacity: Double = 0.6

    // Always green - calming and inviting
    private let orbColor = Color(red: 0.3, green: 0.75, blue: 0.45) // Vibrant green

    var body: some View {
        ZStack {
            // Outer pulse rings (when listening)
            if isListening {
                Circle()
                    .fill(orbColor.opacity(0.3))
                    .frame(width: 120, height: 120)
                    .scaleEffect(pulseScale)
                    .opacity(pulseOpacity)

                Circle()
                    .fill(orbColor.opacity(0.2))
                    .frame(width: 140, height: 140)
                    .scaleEffect(pulseScale * 1.1)
                    .opacity(pulseOpacity * 0.7)
            }

            // Main orb - ALWAYS GREEN
            Circle()
                .fill(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            orbColor,
                            orbColor.opacity(0.8)
                        ]),
                        center: .center,
                        startRadius: 5,
                        endRadius: 50
                    )
                )
                .frame(width: 90, height: 90)
                .shadow(color: orbColor.opacity(0.5), radius: 15, x: 0, y: 5)

            // Microphone icon
            Image(systemName: isListening ? "waveform" : "mic.fill")
                .font(.system(size: 36, weight: .medium))
                .foregroundColor(.white)
                .symbolEffect(.variableColor.iterative, isActive: isListening)
        }
        .onTapGesture {
            onTap()
        }
        .onChange(of: isListening) { _, newValue in
            if newValue {
                startPulsing()
            } else {
                stopPulsing()
            }
        }
        .accessibilityLabel(isListening ? "Listening. Tap to stop." : "Tap to start listening")
        .accessibilityHint("Vera will listen to your voice")
    }

    private func startPulsing() {
        withAnimation(
            .easeInOut(duration: 1.0)
            .repeatForever(autoreverses: true)
        ) {
            pulseScale = 1.3
            pulseOpacity = 0.2
        }
    }

    private func stopPulsing() {
        withAnimation(.easeOut(duration: 0.3)) {
            pulseScale = 1.0
            pulseOpacity = 0.6
        }
    }
}

#Preview {
    ZStack {
        Color(red: 0.98, green: 0.96, blue: 0.92)
            .ignoresSafeArea()

        VStack(spacing: 50) {
            ListenOrb(isListening: .constant(false)) { }
            ListenOrb(isListening: .constant(true)) { }
        }
    }
}
