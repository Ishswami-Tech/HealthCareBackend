# AI Integration Examples for Video Conferencing

## Overview

This document provides examples of integrating AI features (noise suppression, transcription, virtual backgrounds) with different video conferencing solutions.

---

## 1. Agora (Built-in AI Features)

### AI Noise Suppression

```typescript
// Agora AI Noise Suppression - Built-in
import AgoraRTC from 'agora-rtc-sdk-ng';

const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

// Enable AI noise suppression
await client.setAudioProfile('speech_standard', {
  noiseSuppression: true, // AI-powered
  echoCancellation: true,
  autoGainControl: true,
});

// Join channel with AI features
await client.join(appId, channel, token, uid);
```

### Real-time AI Transcription

```typescript
// Agora AI Transcription
import { AgoraTranscriptionClient } from 'agora-transcription';

const transcriptionClient = new AgoraTranscriptionClient({
  appId: 'your-app-id',
  channelName: 'appointment-123',
  token: 'your-token',
});

transcriptionClient.on('transcription', (result) => {
  // AI-powered real-time transcription
  console.log('Speaker:', result.speaker);
  console.log('Text:', result.text);
  console.log('Language:', result.language);
  
  // Save to medical records
  await saveTranscriptionToMedicalRecord({
    appointmentId: 'appointment-123',
    speaker: result.speaker,
    text: result.text,
    timestamp: result.timestamp,
  });
});
```

### AI Virtual Backgrounds

```typescript
// Agora AI Virtual Background
import AgoraRTC from 'agora-rtc-sdk-ng';

const localVideoTrack = await AgoraRTC.createCameraVideoTrack();

// Enable AI virtual background
await localVideoTrack.setVirtualBackground({
  type: 'blur', // or 'image', 'video'
  blurDegree: 3, // AI-powered blur
});

// Or use custom background image
await localVideoTrack.setVirtualBackground({
  type: 'image',
  source: '/path/to/background.jpg',
});
```

---

## 2. OpenVidu (AI Integration via External Services)

### OpenAI Whisper Transcription

```typescript
// OpenVidu + OpenAI Whisper for transcription
import { OpenVidu } from 'openvidu-browser';
import OpenAI from 'openai';

const openvidu = new OpenVidu();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize session
const session = await openvidu.initSession();
const publisher = await openvidu.initPublisherAsync();

// Get audio stream
const audioStream = publisher.stream.getMediaStream();
const audioTracks = audioStream.getAudioTracks();

// Real-time transcription with OpenAI Whisper
async function transcribeAudio(audioBlob: Blob) {
  const transcription = await openai.audio.transcriptions.create({
    file: new File([audioBlob], 'audio.webm', { type: 'audio/webm' }),
    model: 'whisper-1',
    language: 'en',
    response_format: 'verbose_json',
  });
  
  return transcription;
}

// Capture audio chunks and transcribe
const mediaRecorder = new MediaRecorder(audioStream);
mediaRecorder.ondataavailable = async (event) => {
  if (event.data.size > 0) {
    const transcription = await transcribeAudio(event.data);
    // Save to medical records
    await saveTranscription(transcription);
  }
};

mediaRecorder.start(5000); // Capture every 5 seconds
```

### AI Noise Suppression (Web Audio API)

```typescript
// OpenVidu + Web Audio API for noise suppression
import { OpenVidu } from 'openvidu-browser';

const openvidu = new OpenVidu();
const publisher = await openvidu.initPublisherAsync();

// Get audio stream
const audioStream = publisher.stream.getMediaStream();
const audioContext = new AudioContext();
const source = audioContext.createMediaStreamSource(audioStream);

// Create noise suppression filter
const filter = audioContext.createBiquadFilter();
filter.type = 'highpass';
filter.frequency.value = 200; // Filter low-frequency noise

// Create gain node for volume control
const gainNode = audioContext.createGain();
gainNode.gain.value = 1.0;

// Connect: source -> filter -> gain -> destination
source.connect(filter);
filter.connect(gainNode);

// Create output stream
const destination = audioContext.createMediaStreamDestination();
gainNode.connect(destination);

// Replace original audio track with processed one
const processedTrack = destination.stream.getAudioTracks()[0];
await publisher.replaceTrack(processedTrack);
```

### AI Virtual Backgrounds (TensorFlow.js)

```typescript
// OpenVidu + TensorFlow.js for virtual backgrounds
import { OpenVidu } from 'openvidu-browser';
import * as bodyPix from '@tensorflow-models/body-pix';

const openvidu = new OpenVidu();
const publisher = await openvidu.initPublisherAsync();

// Load BodyPix model for person segmentation
const model = await bodyPix.load();

// Get video stream
const videoElement = document.createElement('video');
videoElement.srcObject = publisher.stream.getMediaStream();
videoElement.play();

// Create canvas for processing
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
canvas.width = 640;
canvas.height = 480;

// Process video frames
async function processFrame() {
  // Segment person from background
  const segmentation = await model.segmentPerson(videoElement);
  
  // Draw video frame
  ctx.drawImage(videoElement, 0, 0);
  
  // Apply virtual background
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    if (!segmentation.data[pixelIndex]) {
      // Replace background with custom image
      // Or blur it
      data[i] = 0;     // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      // Keep alpha
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  // Convert canvas to video track
  const stream = canvas.captureStream(30);
  const videoTrack = stream.getVideoTracks()[0];
  
  // Replace video track
  await publisher.replaceTrack(videoTrack);
  
  requestAnimationFrame(processFrame);
}

processFrame();
```

---

## 3. Daily.co (AI Integration via Webhooks)

### OpenAI Whisper Transcription with Daily.co

```typescript
// Daily.co + OpenAI Whisper for transcription
import DailyIframe from '@daily-co/daily-react';
import OpenAI from 'openai';

const daily = DailyIframe.createFrame();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Join meeting
await daily.join({ url: roomUrl, token });

// Get audio stream
const audioStream = await daily.getAudioTrack();

// Real-time transcription
async function transcribeAudio(audioBlob: Blob) {
  const transcription = await openai.audio.transcriptions.create({
    file: new File([audioBlob], 'audio.webm', { type: 'audio/webm' }),
    model: 'whisper-1',
    language: 'en',
  });
  
  return transcription.text;
}

// Capture and transcribe
const mediaRecorder = new MediaRecorder(audioStream);
mediaRecorder.ondataavailable = async (event) => {
  if (event.data.size > 0) {
    const text = await transcribeAudio(event.data);
    // Send to backend for medical records
    await fetch('/api/transcription', {
      method: 'POST',
      body: JSON.stringify({
        appointmentId: 'appointment-123',
        text,
        timestamp: Date.now(),
      }),
    });
  }
};

mediaRecorder.start(5000);
```

### Daily.co Webhook for AI Processing

```typescript
// Backend: Daily.co webhook handler for AI processing
import { Controller, Post, Body } from '@nestjs/common';
import OpenAI from 'openai';

@Controller('webhooks/daily')
export class DailyWebhookController {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  @Post('recording-completed')
  async handleRecordingCompleted(@Body() event: {
    recording: {
      id: string;
      url: string;
      duration: number;
    };
    room: {
      name: string;
    };
  }) {
    // Download recording
    const recordingResponse = await fetch(event.recording.url);
    const recordingBlob = await recordingResponse.blob();

    // Transcribe with OpenAI Whisper
    const transcription = await this.openai.audio.transcriptions.create({
      file: new File([recordingBlob], 'recording.mp4', { type: 'video/mp4' }),
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json',
    });

    // Save to medical records
    await this.databaseService.saveTranscription({
      appointmentId: event.room.name.replace('appointment-', ''),
      transcription: transcription.text,
      segments: transcription.segments,
      duration: event.recording.duration,
    });

    return { success: true };
  }
}
```

---

## 4. 100ms (AI Integration via REST API)

### 100ms + OpenAI Integration

```typescript
// 100ms + OpenAI for transcription
import { HMSReactiveStore } from '@100mslive/hms-video-store';
import OpenAI from 'openai';

const hms = new HMSReactiveStore();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Join room
await hms.join({
  userName: 'Doctor',
  authToken: token,
  settings: {
    isAudioMuted: false,
    isVideoMuted: false,
  },
});

// Get audio track
const audioTrack = hms.getLocalPeer()?.audioTrack;

// Real-time transcription
if (audioTrack) {
  const mediaRecorder = new MediaRecorder(audioTrack.getMediaStream());
  
  mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
      const transcription = await openai.audio.transcriptions.create({
        file: new File([event.data], 'audio.webm', { type: 'audio/webm' }),
        model: 'whisper-1',
      });
      
      // Save to medical records
      await saveTranscription(transcription.text);
    }
  };
  
  mediaRecorder.start(5000);
}
```

---

## 5. Custom AI Integration (Any Solution)

### Backend AI Service for Any Video Solution

```typescript
// Backend: Universal AI service for any video solution
import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class VideoAIService {
  private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  /**
   * Transcribe audio from any video source
   */
  async transcribeAudio(audioBlob: Blob, language = 'en'): Promise<{
    text: string;
    segments: Array<{
      start: number;
      end: number;
      text: string;
    }>;
  }> {
    const transcription = await this.openai.audio.transcriptions.create({
      file: new File([audioBlob], 'audio.webm', { type: 'audio/webm' }),
      model: 'whisper-1',
      language,
      response_format: 'verbose_json',
    });

    return {
      text: transcription.text,
      segments: transcription.segments || [],
    };
  }

  /**
   * Summarize consultation transcript
   */
  async summarizeConsultation(transcript: string): Promise<{
    summary: string;
    keyPoints: string[];
    recommendations: string[];
  }> {
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a medical assistant. Summarize consultations and extract key points.',
        },
        {
          role: 'user',
          content: `Summarize this medical consultation:\n\n${transcript}`,
        },
      ],
    });

    const summary = completion.choices[0].message.content || '';
    
    // Extract key points and recommendations
    const keyPoints = await this.extractKeyPoints(summary);
    const recommendations = await this.extractRecommendations(summary);

    return {
      summary,
      keyPoints,
      recommendations,
    };
  }

  /**
   * Extract medical entities (symptoms, diagnoses, medications)
   */
  async extractMedicalEntities(transcript: string): Promise<{
    symptoms: string[];
    diagnoses: string[];
    medications: string[];
  }> {
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'Extract medical entities from consultation transcript.',
        },
        {
          role: 'user',
          content: `Extract symptoms, diagnoses, and medications from:\n\n${transcript}`,
        },
      ],
    });

    // Parse response (implement based on your needs)
    return this.parseMedicalEntities(completion.choices[0].message.content || '');
  }
}
```

---

## Comparison: AI Integration by Solution

| Solution | Built-in AI | AI Integration | Best For |
|----------|------------|----------------|----------|
| **Agora** | ✅ Yes | ✅ Built-in | Noise suppression, transcription, virtual backgrounds |
| **Daily.co** | ❌ No | ✅ Easy | REST API, webhooks, external AI services |
| **100ms** | ❌ No | ✅ Easy | Modern APIs, external AI services |
| **OpenVidu** | ❌ No | ✅ Easy | REST API, custom AI plugins |
| **BigBlueButton** | ❌ No | ⚠️ Limited | Basic features, limited AI support |
| **Jitsi** | ❌ No | ⚠️ Limited | Basic features, limited AI support |

---

## Recommendations

### For Built-in AI Features:
- **Agora** - Best choice, AI features included

### For Custom AI Integration:
- **OpenVidu** - Modern, easy integration, use existing K8s
- **Daily.co** - Modern APIs, webhooks, easy integration
- **100ms** - Modern, best developer experience

### For Cost + AI:
- **OpenVidu** - Open-source, modern, AI-ready, use existing K8s ($0-20K/month)
- **Agora** - Built-in AI, but costs more ($1.4M/month)

---

**Document Version:** 1.0  
**Last Updated:** 2024
