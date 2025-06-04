import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageCard } from "./components/MessageCard"; // Pastikan path ini benar
import styles from './App.module.css'; // Pastikan path ini benar

// ... (Interface dan Definisi Tipe Global lainnya tetap sama) ...
// (Saya singkat bagian interface agar tidak terlalu panjang, pastikan bagian ini ada di kode Anda)
interface SpeechRecognitionEventMap {
    "audiostart": Event; "audioend": Event; "end": Event; "error": SpeechRecognitionErrorEvent;
    "nomatch": SpeechRecognitionEvent; "result": SpeechRecognitionEvent; "soundstart": Event;
    "soundend": Event; "speechstart": Event; "speechend": Event; "start": Event;
}
interface SpeechRecognition extends EventTarget {
    grammars: SpeechGrammarList; lang: string; continuous: boolean; interimResults: boolean;
    maxAlternatives: number; serviceURI: string; start(): void; stop(): void; abort(): void;
    onaudiostart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onaudioend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
    onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onsoundstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onsoundend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onspeechstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    addEventListener<K extends keyof SpeechRecognitionEventMap>(type: K, listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    removeEventListener<K extends keyof SpeechRecognitionEventMap>(type: K, listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}
interface SpeechRecognitionStatic { new(): SpeechRecognition; }
declare global {
    interface Window {
        SpeechRecognition: SpeechRecognitionStatic; webkitSpeechRecognition: SpeechRecognitionStatic;
        AudioContext: typeof AudioContext; webkitAudioContext: typeof AudioContext;
    }
    interface SpeechGrammarList { readonly length: number; item(index: number): SpeechGrammar; addFromURI(src: string, weight?: number): void; addFromString(string: string, weight?: number): void; [index: number]: SpeechGrammar; }
    interface SpeechGrammar { src: string; weight: number; }
    interface SpeechRecognitionResult { readonly length: number; item(index: number): SpeechRecognitionAlternative; readonly isFinal: boolean; [index: number]: SpeechRecognitionAlternative; }
    interface SpeechRecognitionAlternative { readonly transcript: string; readonly confidence: number; }
    interface SpeechRecognitionResultList { readonly length: number; item(index: number): SpeechRecognitionResult; [index: number]: SpeechRecognitionResult; }
    interface SpeechRecognitionEvent extends Event { resultIndex: number; results: SpeechRecognitionResultList; }
    type SpeechRecognitionErrorCode = | "no-speech" | "aborted" | "audio-capture" | "network" | "not-allowed" | "service-not-allowed" | "bad-grammar" | "language-not-supported";
    interface SpeechRecognitionErrorEvent extends Event { error: SpeechRecognitionErrorCode; message: string; }
}

type Message = {
    role: "assistant" | "user";
    content: string;
    timestamp: string;
    provider?: string;
    audioData?: any; // Bisa berupa URL, base64 data, atau objek dari Gradio
};

const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
    </svg>
);

const MicrophoneIcon = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={styles.micIcon}
    >
        <path d="M12 18.75a6 6 0 0 0 6-6v-1.5a6 6 0 0 0-12 0v1.5a6 6 0 0 0 6 6Z" />
        <path d="M12 22.5A8.25 8.25 0 0 0 20.25 14.25v-1.5a8.25 8.25 0 0 0-16.5 0v1.5A8.25 8.25 0 0 0 12 22.5Z" />
        <path d="M15.75 6.75a.75.75 0 0 0-1.5 0v1.659a4.504 4.504 0 0 0-2.25-1.106A4.504 4.504 0 0 0 9.75 8.409V6.75a.75.75 0 0 0-1.5 0v4.019a.75.75 0 0 0 1.085.693A3.001 3.001 0 0 1 12 10.5a2.999 2.999 0 0 1 2.665 1.462.75.75 0 0 0 1.085-.693V6.75Z" />
    </svg>
);

// Komponen VoiceWaveform (untuk STT dan visualisasi audio dari <audio>)
interface VoiceWaveformProps {
    analyserNode: AnalyserNode | null;
    isListening: boolean; 
    width?: number;
    height?: number;
}
const VoiceWaveform: React.FC<VoiceWaveformProps> = ({
    analyserNode, isListening, width = 280, height = 280,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    const NUM_BARS = width < 150 ? 45 : 90; 
    const CENTER_ORB_MIN_RADIUS = width < 150 ? 8 : 20;
    const CENTER_ORB_MAX_RADIUS = width < 150 ? 12 : 25;
    const RING_RADIUS = width < 150 ? 25 : 70;
    const MAX_BAR_LENGTH = width < 150 ? 25 : 60;
    const BAR_WIDTH = width < 150 ? 2 : 3;
    const BAR_COLORS = ['#67E8F9', '#4FD1C5', '#A7F3D0', '#3B82F6']; 
    const CENTER_MAIN_COLOR = 'rgba(150, 230, 255, 0.9)'; 
    const CENTER_GLOW_COLOR = 'rgba(150, 230, 255, 0.2)';

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!isListening || !analyserNode || !canvas) {
            if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
            if (canvas) { const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); }
            return;
        }
        const context = canvas.getContext('2d'); if (!context) return;
        analyserNode.fftSize = 256; 
        analyserNode.smoothingTimeConstant = 0.7; 
        const bufferLength = analyserNode.frequencyBinCount; 
        const dataArray = new Uint8Array(bufferLength); 
        const centerX = canvas.width / 2; 
        const centerY = canvas.height / 2;
        const draw = () => {
            animationFrameIdRef.current = requestAnimationFrame(draw); 
            analyserNode.getByteFrequencyData(dataArray); 
            context.clearRect(0, 0, canvas.width, canvas.height); 
            let avgVol = dataArray.reduce((s, v) => s + v, 0) / bufferLength; 
            avgVol = Math.min(avgVol / 100, 1); 
            const orbR = CENTER_ORB_MIN_RADIUS + (CENTER_ORB_MAX_RADIUS - CENTER_ORB_MIN_RADIUS) * avgVol; 
            context.save(); 
            context.shadowBlur = width < 150 ? 15 : 30; 
            context.shadowColor = CENTER_GLOW_COLOR; 
            context.fillStyle = CENTER_MAIN_COLOR; 
            context.beginPath(); context.arc(centerX, centerY, orbR, 0, 2 * Math.PI); context.fill(); 
            context.restore(); 
            context.lineWidth = BAR_WIDTH; 
            context.lineCap = 'round';
            for (let i = 0; i < NUM_BARS; i++) { 
                const angle = (i / NUM_BARS) * 2 * Math.PI - Math.PI / 2; 
                const dataIdx = Math.floor(Math.pow(i / NUM_BARS, 0.8) * (bufferLength * 0.85)); 
                const barVal = dataArray[dataIdx] / 255.0; 
                const barLen = (BAR_WIDTH / 2) + barVal * MAX_BAR_LENGTH * (0.5 + avgVol * 0.5); 
                if (barLen <= (BAR_WIDTH/2)) continue; 
                const sX = centerX + RING_RADIUS * Math.cos(angle); 
                const sY = centerY + RING_RADIUS * Math.sin(angle); 
                const eX = centerX + (RING_RADIUS + barLen) * Math.cos(angle); 
                const eY = centerY + (RING_RADIUS + barLen) * Math.sin(angle); 
                context.strokeStyle = BAR_COLORS[i % BAR_COLORS.length]; 
                context.globalAlpha = 0.6 + barVal * 0.4; 
                context.beginPath(); context.moveTo(sX, sY); context.lineTo(eX, eY); context.stroke(); 
            }
            context.globalAlpha = 1.0;
        }; 
        draw();
        return () => { 
            if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current); 
            if (canvas) {const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height);}
        };
    }, [isListening, analyserNode, width, height, NUM_BARS, CENTER_ORB_MIN_RADIUS, CENTER_ORB_MAX_RADIUS, RING_RADIUS, MAX_BAR_LENGTH, BAR_WIDTH]);
    return <canvas ref={canvasRef} width={width} height={height} className={styles.voiceWaveformCanvasRadial} />;
};

// Komponen RadialPulseWaveform (untuk animasi header yang selalu aktif)
interface RadialPulseWaveformProps { isActive: boolean; width?: number; height?: number; colorScheme?: 'default' | 'vibrant'; }
const RadialPulseWaveform: React.FC<RadialPulseWaveformProps> = ({ isActive, width = 140, height = 50, colorScheme = 'vibrant' }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    const phaseRef = useRef(0);

    const NUM_BARS = Math.max(24, Math.floor(width * 0.4));
    const CENTER_ORB_RADIUS = height * 0.2;
    const RING_RADIUS_START = height * 0.4;
    const RING_RADIUS_END = height * 0.65;
    const MAX_BAR_LENGTH = RING_RADIUS_END - RING_RADIUS_START;
    const MIN_BAR_LENGTH = 0;
    const BAR_WIDTH = Math.max(1.2, Math.min(2.8, width * 0.02));
    const PULSE_SPEED = 0.035;

    const defaultColors = ['#A7F3D0', '#67E8F9', '#4FD1C5', '#3B82F6', '#818CF8'];
    const vibrantColors = ['#FFD700', '#FF8A65', '#A0F080', '#64B5F6', '#BA68C8'];
    const colors = colorScheme === 'vibrant' ? vibrantColors : defaultColors;
    const centerColor = colorScheme === 'vibrant' ? 'rgba(255, 215, 0, 0.8)' : 'rgba(180, 240, 255, 0.85)';
    const centerGlow = colorScheme === 'vibrant' ? 'rgba(255, 215, 0, 0.3)' : 'rgba(180, 240, 255, 0.3)';

    useEffect(() => {
        const canvas = canvasRef.current; if (!isActive || !canvas) { if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current); if (canvas) {const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); } return; }
        const context = canvas.getContext('2d'); if (!context) return; const centerX = width / 2; const centerY = height / 2;
        const draw = () => {
            animationFrameIdRef.current = requestAnimationFrame(draw);
            phaseRef.current += PULSE_SPEED;
            context.clearRect(0, 0, width, height);

            const centerPulse = (1 + Math.sin(phaseRef.current * 1.5)) / 2;
            const currentCenterRadius = CENTER_ORB_RADIUS * (0.9 + 0.1 * centerPulse);
            context.save();
            context.shadowBlur = Math.max(8, width * 0.08);
            context.shadowColor = centerGlow;
            context.fillStyle = centerColor;
            context.beginPath();
            context.arc(centerX, centerY, currentCenterRadius, 0, 2 * Math.PI);
            context.fill();
            context.restore();

            context.lineWidth = BAR_WIDTH;
            context.lineCap = 'round';
            const overallPulseFactor = (1 + Math.sin(phaseRef.current)) / 2;

            for (let i = 0; i < NUM_BARS; i++) {
                const angle = (i / NUM_BARS) * 2 * Math.PI - Math.PI / 2;
                const barPhaseOffset = (i / NUM_BARS) * Math.PI * 1.8;
                const barPulse = (1 + Math.sin(phaseRef.current * 1.2 + barPhaseOffset)) / 2;
                const barLength = MIN_BAR_LENGTH + barPulse * MAX_BAR_LENGTH * (0.7 + 0.3 * overallPulseFactor);

                const startRadius = RING_RADIUS_START + (MAX_BAR_LENGTH - barLength) * 0.5;
                const endRadius = startRadius + barLength;

                const sX = centerX + startRadius * Math.cos(angle);
                const sY = centerY + startRadius * Math.sin(angle);
                const eX = centerX + endRadius * Math.cos(angle);
                const eY = centerY + endRadius * Math.sin(angle);

                context.strokeStyle = colors[(i * 7) % colors.length];
                context.globalAlpha = 0.7 + barPulse * 0.3;
                context.beginPath();
                context.moveTo(sX, sY);
                context.lineTo(eX, eY);
                context.stroke();
            }
            context.globalAlpha = 1.0;
        };
        draw();
        return () => {
            if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
            if (canvasRef.current) { const ctx = canvasRef.current.getContext('2d'); ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); }
        };
    }, [isActive, width, height, colorScheme, NUM_BARS, CENTER_ORB_RADIUS, RING_RADIUS_START, RING_RADIUS_END, MAX_BAR_LENGTH, MIN_BAR_LENGTH, BAR_WIDTH, PULSE_SPEED, colors, centerColor, centerGlow]);

    return <canvas ref={canvasRef} width={width} height={height} className={styles.ttsWaveformCanvas} />;
};

const getCurrentTimestamp = () => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
};

function App() {
    const [messages, setMessages] = useState<Message[]>([
        { role: "assistant", content: "Halo! Saya Asisten AI Anda. Ada yang bisa dibantu?", timestamp: getCurrentTimestamp(), provider: "Sistem" },
    ]);
    const [input, setInput] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [isListening, setIsListening] = useState<boolean>(false);
    const [isSpeakingTTSBrowser, setIsSpeakingTTSBrowser] = useState<boolean>(false);
    const [isPlayingTTSFromElement, setIsPlayingTTSFromElement] = useState<boolean>(false);

    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const messagesEndRef = useRef<null | HTMLDivElement>(null); // <<< PASTIKAN INI ADA
    const textareaRef = useRef<null | HTMLTextAreaElement>(null);
    
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const sttMediaStreamRef = useRef<MediaStream | null>(null);
    const sttMediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const sttAnalyserNodeRef = useRef<AnalyserNode | null>(null);

    const ttsAudioElementSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const ttsAudioElementAnalyserNodeRef = useRef<AnalyserNode | null>(null);
    
    const audioContextRef = useRef<AudioContext | null>(null);

    // Fungsi scrollToBottom <<< PASTIKAN DEFINISI INI ADA SEBELUM DIGUNAKAN
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    const autoGrowTextarea = useCallback(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            const scrollHeight = textareaRef.current.scrollHeight;
            const maxHeightStyle = window.getComputedStyle(textareaRef.current).getPropertyValue('max-height');
            const maxHeight = maxHeightStyle.endsWith('px') ? parseInt(maxHeightStyle, 10) : 120;
            textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
        }
    }, []);

    const ensureAudioContext = useCallback(async () => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            try {
                await audioContextRef.current.resume();
            } catch (e) {
                console.error("Gagal melanjutkan AudioContext:", e);
            }
        }
        return audioContextRef.current;
    }, []);

    const setupTTSAudioElementVisualization = useCallback(async () => {
        const audioCtx = await ensureAudioContext();
        if (audioPlayerRef.current && audioCtx && !ttsAudioElementSourceRef.current && audioPlayerRef.current.readyState >= 1) { // readyState >=1 (HAVE_METADATA)
             try {
                ttsAudioElementSourceRef.current = audioCtx.createMediaElementSource(audioPlayerRef.current);
                if (!ttsAudioElementAnalyserNodeRef.current) { // Buat jika belum ada
                    ttsAudioElementAnalyserNodeRef.current = audioCtx.createAnalyser();
                }
                ttsAudioElementSourceRef.current.connect(ttsAudioElementAnalyserNodeRef.current);
                ttsAudioElementSourceRef.current.connect(audioCtx.destination);
                console.log("TTS Audio Element visualization setup complete.");
            } catch (e) {
                console.error("Error setting up TTS Audio Element visualization:", e);
                if (String(e).includes("InvalidStateError") && ttsAudioElementSourceRef.current && ttsAudioElementAnalyserNodeRef.current && audioCtx) {
                    try {
                        ttsAudioElementSourceRef.current.disconnect(); 
                        ttsAudioElementSourceRef.current.connect(ttsAudioElementAnalyserNodeRef.current);
                        ttsAudioElementSourceRef.current.connect(audioCtx.destination);
                        console.log("TTS Audio Element re-connected for visualization.");
                    } catch (reconnectError) {
                        console.error("Error re-connecting TTS Audio Element:", reconnectError);
                        ttsAudioElementSourceRef.current = null;
                        // ttsAudioElementAnalyserNodeRef.current = null; // Jangan nullkan analyser jika mau dipakai ulang
                    }
                } else {
                     ttsAudioElementSourceRef.current = null; 
                }
            }
        } else if (audioPlayerRef.current && audioCtx && ttsAudioElementSourceRef.current && ttsAudioElementAnalyserNodeRef.current) {
            // Jika source dan analyser sudah ada, pastikan terhubung
            try {
                ttsAudioElementSourceRef.current.disconnect(); // Disconnect dulu semua
            } catch (e) { /* ignore disconnect error if not connected */ }
            try {
                ttsAudioElementSourceRef.current.connect(ttsAudioElementAnalyserNodeRef.current);
                ttsAudioElementSourceRef.current.connect(audioCtx.destination);
            } catch (e) {
                 console.error("Error re-connecting existing TTS Audio Element nodes:", e);
                 ttsAudioElementSourceRef.current = null; // Anggap tidak valid jika gagal connect ulang
            }
        }
    }, [ensureAudioContext]);

    const cleanupTTSAudioElementVisualization = useCallback(() => {
        // Cukup set state, node tidak perlu di-disconnect permanen di sini
        console.log("TTS Audio Element visualization cleanup (set state).");
    }, []);

    const playSound = useCallback(async (dataOrText: string | any) => {
        // ... (Isi fungsi playSound sama seperti sebelumnya, pastikan lengkap)
        if (!dataOrText) return;
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
        setIsSpeakingTTSBrowser(false);
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
        setIsPlayingTTSFromElement(false);
        if (recognitionRef.current && isListening) recognitionRef.current.stop();

        if (typeof dataOrText === 'object' && dataOrText !== null) {
            let audioSrc = null;
            if (dataOrText.url) audioSrc = dataOrText.url;
            else if (dataOrText.path && (dataOrText.is_file === true || typeof dataOrText.is_file === 'undefined') && dataOrText.path.startsWith('http')) audioSrc = dataOrText.path;
            else if (dataOrText.data && dataOrText.name) {
                const audioType = dataOrText.name.endsWith('.mp3') ? 'audio/mpeg' : dataOrText.name.endsWith('.wav') ? 'audio/wav' : dataOrText.name.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav';
                audioSrc = `data:${audioType};base64,${dataOrText.data}`;
            }

            if (audioSrc && audioPlayerRef.current) {
                await ensureAudioContext(); 
                
                audioPlayerRef.current.src = audioSrc;
                audioPlayerRef.current.load(); // Panggil load() setelah mengganti src

                const onCanPlay = async () => {
                    if(audioPlayerRef.current){ // Cek lagi karena bisa jadi null
                        audioPlayerRef.current.oncanplay = null; // Hapus listener agar tidak terpanggil berkali-kali
                        await setupTTSAudioElementVisualization(); // Setup setelah src di-set dan siap
                        audioPlayerRef.current.play()
                            .then(() => { setIsPlayingTTSFromElement(true); console.log("Playing TTS from element."); })
                            .catch(e => {
                                console.error("Error playing audio from backend:", e);
                                setIsPlayingTTSFromElement(false);
                                const fallbackText = typeof dataOrText.prompt === 'string' ? dataOrText.prompt : (messages.length > 0 && messages[messages.length - 1].role === 'assistant' ? messages[messages.length - 1].content : "Gagal memutar audio.");
                                playSound(fallbackText);
                            });
                    }
                };
                audioPlayerRef.current.oncanplay = onCanPlay;

                audioPlayerRef.current.onended = () => {
                    setIsPlayingTTSFromElement(false); cleanupTTSAudioElementVisualization(); console.log("TTS from element ended.");
                };
                audioPlayerRef.current.onpause = () => {
                    if (isPlayingTTSFromElement) {
                        setIsPlayingTTSFromElement(false); cleanupTTSAudioElementVisualization(); console.log("TTS from element paused.");
                    }
                };
                audioPlayerRef.current.onerror = (e) => {
                    console.error("Error with audio element:", e); setIsPlayingTTSFromElement(false);
                    const fallbackText = typeof dataOrText.prompt === 'string' ? dataOrText.prompt : "Gagal memuat audio.";
                    playSound(fallbackText);
                };
            } else {
                const fallbackText = typeof dataOrText.prompt === 'string' ? dataOrText.prompt : (messages.length > 0 && messages[messages.length - 1].role === 'assistant' ? messages[messages.length - 1].content : "Tidak dapat memutar audio.");
                playSound(fallbackText);
            }
        } else if (typeof dataOrText === 'string') {
            if (typeof speechSynthesis === 'undefined') { console.warn("Browser tidak mendukung Web Speech API untuk TTS."); return; }
            const utterance = new SpeechSynthesisUtterance(dataOrText);
            utterance.lang = "id-ID";
            let selectedVoice = availableVoices.find(v => v.lang.startsWith('id') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('wanita')));
            if (!selectedVoice && availableVoices.length > 0) selectedVoice = availableVoices.find(v => v.lang.startsWith('id'));
            if (selectedVoice) utterance.voice = selectedVoice;
            utterance.pitch = 1; utterance.rate = 0.92; utterance.volume = 1;
            utterance.onstart = () => {
                setIsPlayingTTSFromElement(false); setIsSpeakingTTSBrowser(true);
                if (isListening && recognitionRef.current) recognitionRef.current.stop();
                console.log("Playing TTS from browser.");
            };
            utterance.onend = () => { setIsSpeakingTTSBrowser(false); console.log("TTS from browser ended."); };
            utterance.onerror = (event) => { console.error("SpeechSynthesis Utterance Error:", event.error); setIsSpeakingTTSBrowser(false); };
            speechSynthesis.speak(utterance);
        }
    // Hapus isPlayingTTSFromElement dari dependency playSound untuk menghindari re-render loop
    }, [availableVoices, messages, isListening, ensureAudioContext, setupTTSAudioElementVisualization, cleanupTTSAudioElementVisualization]);


    useEffect(() => {
        const populateVoiceList = () => { /* ... sama seperti sebelumnya ... */ };
        populateVoiceList();
        if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = populateVoiceList;
        }
        return () => { /* ... cleanup ... */ };
    }, []);

    // useEffect untuk scrollToBottom <<< PASTIKAN INI ADA DAN BENAR
    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]); // scrollToBottom sebagai dependency

    useEffect(() => { autoGrowTextarea(); }, [input, autoGrowTextarea]);

    // ... (useEffect untuk STT SpeechRecognition tetap sama) ...
     useEffect(() => {
        const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) { console.warn("Browser does not support Web Speech Recognition API (STT)."); return; }
        const recognitionInstance: SpeechRecognition = new SpeechRecognitionAPI();
        recognitionInstance.continuous = false; recognitionInstance.interimResults = true; recognitionInstance.lang = 'id-ID';
        recognitionInstance.onstart = () => {
            setIsListening(true); setError(null);
            if (isSpeakingTTSBrowser) { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); setIsSpeakingTTSBrowser(false); }
            if (isPlayingTTSFromElement && audioPlayerRef.current) { audioPlayerRef.current.pause(); setIsPlayingTTSFromElement(false); }
        };
        recognitionInstance.onend = () => { setIsListening(false); };
        recognitionInstance.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error('Speech recognition error:', event.error, event.message);
            let userMessage = `Error STT: ${event.error}.`;
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') userMessage = 'Akses mikrofon tidak diizinkan atau layanan STT tidak tersedia. Mohon periksa izin browser Anda.';
            else if (event.error === 'no-speech') userMessage = "Tidak ada suara terdeteksi. Coba lagi.";
            else if (event.error === 'audio-capture') userMessage = "Masalah dengan perangkat input audio. Pastikan mikrofon terhubung dan berfungsi.";
            setError(userMessage); setIsListening(false); 
        };
        
        let finalTranscriptForInput = '';
        recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            }
            if (finalTranscript) setInput(prevInput => (prevInput ? prevInput.trim() + " " : "") + finalTranscript.trim());
        };
        recognitionRef.current = recognitionInstance;

        return () => { 
            if (recognitionRef.current) {
                recognitionRef.current.onstart = null; recognitionRef.current.onresult = null;
                recognitionRef.current.onerror = null; recognitionRef.current.onend = null;
                try { 
                    recognitionRef.current.stop(); 
                } catch (e) { /* ignore */ }
            }
        };
    }, [isSpeakingTTSBrowser, isPlayingTTSFromElement]);

    // ... (useEffect untuk setup dan cleanup audio STT tetap sama) ...
    useEffect(() => {
        const setupSTTAudioVisualization = async () => {
            if (isListening) {
                try {
                    const audioCtx = await ensureAudioContext();
                    if (!audioCtx) { setError("AudioContext tidak dapat diinisialisasi."); setIsListening(false); return; }
                    if (!sttMediaStreamRef.current) sttMediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    if (sttMediaStreamRef.current && (!sttMediaStreamSourceRef.current || sttMediaStreamSourceRef.current.mediaStream !== sttMediaStreamRef.current)) {
                        if(sttMediaStreamSourceRef.current) sttMediaStreamSourceRef.current.disconnect();
                        sttMediaStreamSourceRef.current = audioCtx.createMediaStreamSource(sttMediaStreamRef.current);
                        if (!sttAnalyserNodeRef.current) sttAnalyserNodeRef.current = audioCtx.createAnalyser();
                        sttMediaStreamSourceRef.current.connect(sttAnalyserNodeRef.current);
                        console.log("STT Audio Visualization setup complete.");
                    }
                } catch (err: any) {
                    console.error("Error setting up audio for STT waveform:", err);
                    setError(`Gagal mengakses mikrofon untuk STT: ${err.message}.`);
                    if (recognitionRef.current) recognitionRef.current.stop(); else setIsListening(false);
                }
            } else {
                if (sttMediaStreamSourceRef.current) { sttMediaStreamSourceRef.current.disconnect(); sttMediaStreamSourceRef.current = null; }
                if (sttMediaStreamRef.current) { sttMediaStreamRef.current.getTracks().forEach(track => track.stop()); sttMediaStreamRef.current = null; }
                console.log("STT Audio Visualization resources cleaned up.");
            }
        };
        setupSTTAudioVisualization();
        return () => {
            if (sttMediaStreamRef.current) sttMediaStreamRef.current.getTracks().forEach(track => track.stop());
            if (sttMediaStreamSourceRef.current) sttMediaStreamSourceRef.current.disconnect();
        };
    }, [isListening, ensureAudioContext]);

    // ... (handleToggleListen dan handleSubmit tetap sama) ...
    const handleToggleListen = async () => {
        if (!recognitionRef.current) { setError("Fitur input suara tidak tersedia."); alert("Fitur input suara tidak tersedia."); return; }
        if (isListening) {
            recognitionRef.current.stop();
        } else {
            setError(null);
            try {
                await ensureAudioContext(); 
                recognitionRef.current.start();
            } catch (e: any) {
                console.error("Gagal memulai speech recognition:", e.message, e.name);
                setError(`Gagal memulai STT: ${e.message}.`);
                if (e.name === 'InvalidStateError' && recognitionRef.current) { try { recognitionRef.current.abort(); } catch (abortError) { console.error("Failed to abort recognition:", abortError); } }
                setIsListening(false);
            }
        }
    };

    const handleSubmit = async (e?: React.FormEvent) => { 
        if (e) e.preventDefault();
        const trimmedInput = input.trim();
        if (trimmedInput && !isLoading) {
            if (isListening && recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch(e){}
            }

            const newMessage: Message = { role: "user", content: trimmedInput, timestamp: getCurrentTimestamp() };
            setMessages((prevMessages) => [...prevMessages, newMessage]);
            setInput("");
            if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
            setIsLoading(true); setError(null);
            const currentMessages = [...messages, newMessage];
            const finalMessagesForApi = currentMessages.slice(Math.max(0, currentMessages.length - 6)).map(m => ({role: m.role, content: m.content}));
            try {
                const backendUrl = "http://192.168.100.29:3001/api/chat";
                const response = await fetch(backendUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: finalMessagesForApi }), });
                if (!response.ok) {
                    let errData = { error: `HTTP error! status: ${response.status} ${response.statusText}`};
                    try { const errorBody = await response.json(); errData.error = errorBody.error || errData.error; } catch (parseError) { /* ignore */ }
                    throw new Error(errData.error);
                }
                const data = await response.json();
                if (data.reply && data.reply.content) {
                    const newAssistantMessage: Message = { role: "assistant", content: data.reply.content, timestamp: getCurrentTimestamp(), provider: data.reply.provider, audioData: data.reply.audioData };
                    setMessages((prevMessages) => [...prevMessages, newAssistantMessage]);
                    await playSound(newAssistantMessage.audioData || newAssistantMessage.content);
                } else { throw new Error("Invalid response structure from server."); }
            } catch (err: any) {
                const errorMessageText = err.message || "Gagal mendapatkan respons dari server.";
                console.error("Submit Error:", err); setError(errorMessageText);
                const assistantErrorMessage: Message = { role: "assistant", content: `Error: ${errorMessageText}`, timestamp: getCurrentTimestamp() };
                setMessages((prevMessages) => [...prevMessages, assistantErrorMessage]);
                await playSound(assistantErrorMessage.content);
            } finally {
                setIsLoading(false);
            }
        }
    };
    
    const anyTTSSpeaking = isSpeakingTTSBrowser || isPlayingTTSFromElement;

    return (
        // JSX sama persis seperti di respons sebelumnya, menggunakan styles.xyz
        <div className={styles.appContainer}>
            <audio ref={audioPlayerRef} style={{ display: 'none' }} crossOrigin="anonymous" />
            <header className={styles.appHeader}>
                <h1>Asisten AI Cerdas Hukum</h1>
                {(isSpeakingTTSBrowser || (isPlayingTTSFromElement && ttsAudioElementAnalyserNodeRef.current)) && (
                    <div className={styles.ttsWaveformContainer}>
                        {isPlayingTTSFromElement && ttsAudioElementAnalyserNodeRef.current ? (
                            <VoiceWaveform
                                analyserNode={ttsAudioElementAnalyserNodeRef.current}
                                isListening={isPlayingTTSFromElement} // Prop ini menandakan visualisasi aktif
                                width={100} 
                                height={40} // Ukuran lebih kecil untuk di header
                            />
                        ) : isSpeakingTTSBrowser ? (
                            <RadialPulseWaveform isActive={isSpeakingTTSBrowser} width={70} height={30} />
                        ) : null}
                    </div>
                )}
            </header>

            <main className={styles.mainContent}>
                <div className={styles.messagesListContainer}>
                    {messages.map((message, index) => (
                        <MessageCard
                            key={index} role={message.role} message={message.content}
                            timestamp={message.timestamp} onPlaySound={playSound} audioData={message.audioData}
                        />
                    ))}
                    {isLoading && (
                        <div className={styles.loadingIndicatorContainer}>
                            <div className={styles.loadingIndicatorAvatar}>A</div>
                            <div className={styles.loadingIndicatorBubble}>
                                <div className={styles.loadingDots}>
                                    <span className="sr-only">Mengetik...</span>
                                    <div></div> <div></div> <div></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} style={{ height: '1px' }}/>
                </div>

                {isListening && !anyTTSSpeaking && sttAnalyserNodeRef.current && (
                    <div className={styles.waveformContainerRadial}>
                        <VoiceWaveform 
                            analyserNode={sttAnalyserNodeRef.current} 
                            isListening={isListening} 
                            width={240} 
                            height={120}
                        />
                        <p className={styles.listeningText}>Mendengarkan...</p>
                    </div>
                )}

                {error && !isLoading && (
                       <div className={styles.errorMessageContainer}>
                           <strong>Error:</strong> {error}
                       </div>
                )}

                <form 
                    onSubmit={handleSubmit} 
                    className={`${styles.messageInputForm} ${isListening && !anyTTSSpeaking && sttAnalyserNodeRef.current ? styles.messageInputFormPaddedForWaveform : ''}`}
                >
                    <div className={styles.inputFormInnerWrapper}>
                        <textarea
                            ref={textareaRef} placeholder="Tulis pesan Anda..." value={input}
                            onChange={(e) => { setInput(e.target.value); }}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isLoading && !isListening) { e.preventDefault(); handleSubmit(e as any); } }}
                            className={styles.inputTextArea} rows={1} disabled={isLoading || anyTTSSpeaking || isListening}
                        />
                        <button
                            type="button" onClick={handleToggleListen}
                            className={`${styles.iconButton} ${isListening ? styles.micButtonListening : styles.micButtonIdle} ${isListening ? styles.micButtonWithText : ''}`}
                            aria-label={isListening ? "Hentikan Merekam" : "Rekam Suara"}
                            disabled={isLoading || anyTTSSpeaking} 
                        >
                            {isListening ? <span>Hentikan</span> : <MicrophoneIcon />}
                        </button>
                        <button
                            type="submit" disabled={!input.trim() || isLoading || anyTTSSpeaking || isListening}
                            className={styles.sendButton} aria-label="Kirim pesan"
                        >
                            <SendIcon />
                        </button>
                    </div>
                </form>
            </main>
        </div>
    );
}

export default App;
