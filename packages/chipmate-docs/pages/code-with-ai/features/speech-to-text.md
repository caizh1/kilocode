---
title: Voice Transcription
description: Dictate prompts through your signed-in ChipMate account.
---

# Voice Transcription

Use voice input in prompt fields instead of typing. When the ChipMate provider is enabled and you are signed in, the microphone appears automatically and transcription uses your account through ChipMate Gateway.

---

## Get ready

Voice input needs FFmpeg plus access to the ChipMate provider.

### Install FFmpeg

FFmpeg is required for audio capture and processing. Install it for your platform:

**macOS:**

```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org/download.html](https://ffmpeg.org/download.html) and add to your system PATH.

### Sign in

Enable and sign in to the ChipMate provider to use voice input in prompt fields. Requests use your ChipMate account through ChipMate Gateway, so no separate OpenAI provider profile or API key is needed.

---

## Choose a model

You can optionally choose a transcription model in **Settings** > **Models** > **Speech to Text Model**. ChipMate stores this choice as `experimental.speech_to_text_model` in your global ChipMate CLI config (`~/.config/chipmate/chipmate.jsonc`).

---

## Record prompts

When you are signed in to the enabled ChipMate provider, a microphone button appears in prompt fields:

1. Click the microphone button to start recording
2. Speak your message clearly
3. Click again to stop recording
4. Your speech is transcribed into text

You can also use **Cmd/Ctrl+K** while a ChipMate prompt or review comment field is focused. Tap it to start or stop recording, or hold it while speaking and release to transcribe and submit the focused field. Press it during transcription to cancel.

The feature includes real-time audio level visualization and voice activity detection to automatically detect when you're speaking.

---

## Review details

- **Audio processing**: Uses FFmpeg for system audio capture
- **Transcription**: Sends audio through ChipMate Gateway with the selected transcription model

---

## Fix issues

**Microphone button not appearing:**

- Enable and sign in to the ChipMate provider

**Transcription errors:**

- Confirm the ChipMate provider remains enabled and signed in
- Verify FFmpeg is installed and in your PATH
- Check your internet connection
- Try speaking more clearly or adjusting your microphone settings

---

## Know limits

Voice transcription has these requirements:

- Requires an active internet connection
- Requires ChipMate Gateway access through your ChipMate account
- Transcription accuracy depends on audio quality and speech clarity
