# VaporSend

VaporSend is a premium, client-side, zero-network file and clipboard sharing web application. It encodes files or clipboard text into a sequence of animated QR codes that any device with a camera (e.g., iPhone, Android, or laptop) can scan, decode, and reassemble.

## Features
- **100% Offline & Private**: Zero network connections, cloud servers, Bluetooth, or Wi-Fi configuration required. The visual channel is completely secure.
- **Efficient Gzip Compression**: Bundled with [pako](https://github.com/nodeca/pako) to compress text or binary files, minimizing the total number of generated QR codes.
- **Automatic Chunking**: Large payloads are automatically split into manageable chunks.
- **Interactive Scanning Progress Grid**: Visual real-time indicator shows exactly which frames have been scanned and which ones are pending.
- **Direct Clipboard Integration**: Instant transmission of text content, which is copied to the receiver's clipboard automatically upon completion.
- **Ultra-Premium Design**: Responsive slate dark-mode UI with dynamic glassmorphism aesthetics and smooth transitions.

## Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the Vite development server:
   ```bash
   npm run dev
   ```

3. Open the hosted page or local IP address on both devices to start sending and receiving.

## Deploying to GitHub Pages

This project is configured to build and deploy automatically to GitHub Pages using GitHub Actions.

1. Create a new repository on GitHub named `VaporSend`.
2. Push this project to the `main` branch of your new repository:
   ```bash
   git init
   git checkout -b main
   git remote add origin https://github.com/<your-username>/VaporSend.git
   git add .
   git commit -m "Initial commit of VaporSend"
   git push -u origin main
   ```
3. Go to the repository **Settings** > **Pages**:
   - Under **Build and deployment**, set **Source** to **Deploy from a branch**.
   - Under **Branch**, select `gh-pages` and folder `/ (root)`.
4. Your page will be live at `https://<your-username>.github.io/VaporSend/`.
