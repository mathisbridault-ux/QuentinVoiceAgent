/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Mic, MicOff, Volume2, VolumeX, Info, Mail, Phone, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { floatTo16BitPCM, base64ToArrayBuffer, arrayBufferToBase64 } from './lib/audio-utils';

const SYSTEM_INSTRUCTION = `You are Pablo, a voice assistant for Quentin Marty. 
You speak English and French with an American accent. 
You have access to Quentin's professional background. 
Answer questions about his experience, education, and skills based on his CV. 
Be professional, helpful, and friendly. 
Your name is Pablo. 
Always start the conversation with: "Hello I'm PABLO what would you like to learn about Quentin".

Quentin Marty's Background:
- Education:
  - Sup de Pub PARIS (2025-present): MSc Strategic Planning & Creative Strategy (100% English).
  - BUT Information-Communication (2022-2025): IUT and University Lyon 3 Jean Moulin.
  - Baccalaureate (2019-2022): Lycée Assomption Bellevue (HGGSP / SES specialty).
- Experience:
  - Explore Media (Paris, 2025-present): Strategic Planner Apprentice. Editorial partnerships, trend analysis, B2B marketing.
  - Banque Populaire Auvergne Rhône Alpes (Lyon, 2025): Commercial Communication Intern. Direct marketing, media planning, digital strategy.
  - TBWA GROUP (Lyon, 2024): Copywriter & Strategic Planner Intern. Creative strategies, activations, content creation.
  - Deal Productions (Remote, 2023-2024): Communication Assistant. Strategic overhaul of institutional communication.
  - Entrepreneur (2021-2023): Independent business in sneaker and limited-edition clothing resale.
- Skills:
  - Software: Adobe InDesign, Photoshop, Illustrator, Canva, Figma, Monday.com, Trello, Notion, Excel.
  - Languages: English (C1), Spanish (B1), French (Native).
- Contact: quentin.marty59@gmail.com | 06 46 81 63 34.`;

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  const startSession = useCallback(async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      sessionRef.current = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setError(null);
            console.log("Connected to Gemini Live");
          },
          onmessage: async (message) => {
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const arrayBuffer = base64ToArrayBuffer(base64Audio);
              audioQueueRef.current.push(new Int16Array(arrayBuffer));
              if (!isPlayingRef.current) {
                playNextInQueue();
              }
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              setIsSpeaking(false);
            }

            if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
              // Handle text if needed, though we focus on audio
            }
          },
          onclose: () => {
            setIsConnected(false);
            stopAudioCapture();
          },
          onerror: (err) => {
            console.error("Gemini Live Error:", err);
            setError("Connection error. Please try again.");
            setIsConnected(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });

      await startAudioCapture();
    } catch (err) {
      console.error("Failed to start session:", err);
      setError("Could not access microphone or connect to API.");
    }
  }, []);

  const startAudioCapture = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const source = audioContextRef.current.createMediaStreamSource(stream);
    const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (isMuted || !sessionRef.current) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = floatTo16BitPCM(inputData);
      const base64Data = arrayBufferToBase64(pcmData);

      sessionRef.current.sendRealtimeInput({
        audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
      });
    };

    source.connect(processor);
    processor.connect(audioContextRef.current.destination);
  };

  const stopAudioCapture = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    processorRef.current?.disconnect();
    audioContextRef.current?.close();
    audioContextRef.current = null;
  };

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    const pcmData = audioQueueRef.current.shift()!;
    
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }

    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 32768.0;
    }

    const buffer = audioContextRef.current.createBuffer(1, floatData.length, 24000);
    buffer.getChannelData(0).set(floatData);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => playNextInQueue();
    source.start();
  };

  const toggleMute = () => setIsMuted(!isMuted);

  const disconnect = () => {
    sessionRef.current?.close();
    setIsConnected(false);
    stopAudioCapture();
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex justify-between items-center mb-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
              <span className="font-bold text-xl">P</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">PABLO</h1>
              <p className="text-xs text-white/40 uppercase tracking-widest">Quentin's Assistant</p>
            </div>
          </div>
          <div className="flex gap-4">
            <a href="mailto:quentin.marty59@gmail.com" className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/60 hover:text-white">
              <Mail size={20} />
            </a>
            <a href="tel:0646816334" className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/60 hover:text-white">
              <Phone size={20} />
            </a>
          </div>
        </header>

        {/* Main Interaction Area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-12">
          <div className="relative">
            {/* Visualizer Circle */}
            <motion.div 
              animate={{ 
                scale: isSpeaking ? [1, 1.1, 1] : 1,
                opacity: isConnected ? 1 : 0.5
              }}
              transition={{ repeat: Infinity, duration: 2 }}
              className={`w-64 h-64 rounded-full border-2 flex items-center justify-center transition-colors duration-500 ${
                isConnected ? 'border-orange-500/50 shadow-[0_0_50px_rgba(249,115,22,0.2)]' : 'border-white/10'
              }`}
            >
              <div className="absolute inset-4 rounded-full border border-white/5" />
              
              <AnimatePresence mode="wait">
                {!isConnected ? (
                  <motion.button
                    key="start"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={startSession}
                    className="group relative z-20 w-32 h-32 bg-white text-black rounded-full font-bold text-lg hover:scale-105 transition-transform active:scale-95 shadow-xl"
                  >
                    START
                  </motion.button>
                ) : (
                  <motion.div
                    key="active"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <div className="flex gap-1 h-8 items-end">
                      {[...Array(5)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ 
                            height: isSpeaking ? [8, 32, 8] : 8 
                          }}
                          transition={{ 
                            repeat: Infinity, 
                            duration: 0.6, 
                            delay: i * 0.1 
                          }}
                          className="w-1.5 bg-orange-500 rounded-full"
                        />
                      ))}
                    </div>
                    <span className="text-orange-500 font-medium tracking-widest text-sm">PABLO IS LIVE</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Status Indicators */}
            <AnimatePresence>
              {isConnected && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute -bottom-24 left-1/2 -translate-x-1/2 flex gap-4"
                >
                  <button 
                    onClick={toggleMute}
                    className={`p-4 rounded-full transition-all ${isMuted ? 'bg-red-500 text-white' : 'bg-white/5 hover:bg-white/10 text-white/80'}`}
                  >
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  <button 
                    onClick={disconnect}
                    className="p-4 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-500 text-white/80 transition-all"
                  >
                    <VolumeX size={24} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="text-center max-w-md">
            <h2 className="text-2xl font-light text-white/90 mb-4">
              {!isConnected ? "Ready to meet Quentin Marty?" : "Ask me anything about Quentin"}
            </h2>
            <p className="text-white/40 text-sm leading-relaxed">
              {!isConnected 
                ? "I'm Pablo, Quentin's AI assistant. I can tell you about his experience at TBWA, Explore Media, or his strategic planning skills."
                : "I'm listening. You can ask about his education, his internships in Paris and Lyon, or his entrepreneurial background."}
            </p>
          </div>
        </div>

        {/* Footer Info */}
        <footer className="mt-auto pt-12 border-t border-white/5 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-white/40">
          <div className="flex flex-col gap-2">
            <span className="text-white/20 uppercase tracking-widest text-[10px] font-bold">Current Role</span>
            <p className="text-white/60">Strategic Planner Apprentice @ Explore Media (Paris)</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-white/20 uppercase tracking-widest text-[10px] font-bold">Education</span>
            <p className="text-white/60">MSc Strategic Planning @ Sup de Pub Paris</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-white/20 uppercase tracking-widest text-[10px] font-bold">Location</span>
            <p className="text-white/60">Paris / Lyon, France</p>
          </div>
        </footer>

        {/* Error Toast */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3"
            >
              <Info size={18} />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 font-bold opacity-50 hover:opacity-100">×</button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
