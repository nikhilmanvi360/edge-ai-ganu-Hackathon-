<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Edge-AI Shield: Real-time Privacy Protection

Edge-AI Shield is a Chrome Extension that provides real-time AI-powered privacy protection by dynamically blurring faces and sensitive information (PII) in your camera feed.

## Key Features
- **Face Anonymization**: Real-time detection and blurring of non-user faces.
- **Sensitive Data Shield**: AI-powered (Gemini) detection of credit cards, emails, and phone numbers with automatic blurring.
- **Session Logging**: Tracks FPS, CPU usage, and privacy events with CSV export functionality.
- **Optimized for Extension**: Complies with Manifest V3 (MV3) security standards using local WASM and model bundling.

## Tech Stack
- **Frontend**: React + Vite
- **AI/ML**: MediaPipe Tasks-Vision (Face Detection)
- **Large Language Model**: Google Gemini (Sensitive Text Scanning)
- **Styling**: Tailwind CSS + Lucide Icons + Framer Motion

## Installation (Chrome Extension)

1.  **Build the Project**:
    ```bash
    npm install
    npm run build
    ```
2.  **Configure API Key**:
    - Set the `GEMINI_API_KEY` in your environment or during build if using a `.env` file for the Gemini PII detection feature.
3.  **Load in Chrome**:
    - Open Chrome and navigate to `chrome://extensions/`.
    - Enable **Developer mode** (top right).
    - Click **Load unpacked**.
    - Select the **`dist`** folder (e.g., `/path/to/project/dist`).

## Usage
- Click the **Edge-AI Shield** icon in your browser toolbar.
- Click **START** to activate the camera and privacy protection.
- Toggle **Face Anonymization** or **Sensitive Data Shield** as needed.
- Export your session log using the **EXPORT CSV** button.
