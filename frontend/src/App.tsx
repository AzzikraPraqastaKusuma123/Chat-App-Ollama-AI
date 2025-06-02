import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageCard } from "./components/MessageCard";
import styles from './App.module.css';

// Definisi tipe global untuk Web Speech API (VERSI DIPERBARUI)
interface SpeechRecognitionEventMap {
    "audiostart": Event;
    "audioend": Event;
    "end": Event;
    "error": SpeechRecognitionErrorEvent;
    "nomatch": SpeechRecognitionEvent;
    "result": SpeechRecognitionEvent;
    "soundstart": Event;
    "soundend": Event;
    "speechstart": Event;
    "speechend": Event;
    "start": Event;
}

interface SpeechRecognition extends EventTarget {
    grammars: SpeechGrammarList;
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    serviceURI: string;

    start(): void;
    stop(): void;
    abort(): void;

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

interface SpeechRecognitionStatic {
    new(): SpeechRecognition;
}

declare global {
    interface Window {
        SpeechRecognition: SpeechRecognitionStatic;
        webkitSpeechRecognition: SpeechRecognitionStatic;
        AudioContext: typeof AudioContext;
        webkitAudioContext: typeof AudioContext;
    }

    interface SpeechGrammarList {
        readonly length: number;
        item(index: number): SpeechGrammar;
        addFromURI(src: string, weight?: number): void;
        addFromString(string: string, weight?: number): void;
        [index: number]: SpeechGrammar;
    }
    interface SpeechGrammar {
        src: string;
        weight: number;
    }

    interface SpeechRecognitionResult {
        readonly length: number;
        item(index: number): SpeechRecognitionAlternative;
        readonly isFinal: boolean;
        [index: number]: SpeechRecognitionAlternative;
    }
    interface SpeechRecognitionAlternative {
        readonly transcript: string;
        readonly confidence: number;
    }
    interface SpeechRecognitionResultList {
        readonly length: number;
        item(index: number): SpeechRecognitionResult;
        [index: number]: SpeechRecognitionResult;
    }

    interface SpeechRecognitionEvent extends Event {
        resultIndex: number;
        results: SpeechRecognitionResultList;
    }

    type SpeechRecognitionErrorCode =
        | "no-speech"
        | "aborted"
        | "audio-capture"
        | "network"
        | "not-allowed"
        | "service-not-allowed"
        | "bad-grammar"
        | "language-not-supported";

    interface SpeechRecognitionErrorEvent extends Event {
        error: SpeechRecognitionErrorCode;
        message: string;
    }
}


type Message = {
    role: "assistant" | "user";
    content: string;
    timestamp: string;
    provider?: string;
    audioData?: any;
};

// Icon Send (tidak perlu diubah jika sudah sesuai)
const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        {/* Path disesuaikan dengan App.module.css untuk .sendButton svg jika perlu */}
        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
    </svg>
);

// Icon Microphone (className={styles.micIcon} akan diterapkan dari button)
const MicrophoneIcon = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={styles.micIcon} // className ini akan mengambil style dari App.module.css
    >
        <path d="M12 18.75a6 6 0 0 0 6-6v-1.5a6 6 0 0 0-12 0v1.5a6 6 0 0 0 6 6Z" />
        <path d="M12 22.5A8.25 8.25 0 0 0 20.25 14.25v-1.5a8.25 8.25 0 0 0-16.5 0v1.5A8.25 8.25 0 0 0 12 22.5Z" />
        <path d="M15.75 6.75a.75.75 0 0 0-1.5 0v1.659a4.504 4.504 0 0 0-2.25-1.106A4.504 4.504 0 0 0 9.75 8.409V6.75a.75.75 0 0 0-1.5 0v4.019a.75.75 0 0 0 1.085.693A3.001 3.001 0 0 1 12 10.5a2.999 2.999 0 0 1 2.665 1.462.75.75 0 0 0 1.085-.693V6.75Z" />
    </svg>
);

interface VoiceWaveformProps {
    analyserNode: AnalyserNode | null;
    isListening: boolean;
    width?: number;
    height?: number;
}
const VoiceWaveform: React.FC<VoiceWaveformProps> = ({
    analyserNode,
    isListening,
    width = 280, // Default dari kode lama
    height = 280, // Default dari kode lama
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    // Konstanta Waveform (bisa dipindahkan ke atas jika digunakan di tempat lain)
    const NUM_BARS = 90; const CENTER_ORB_MIN_RADIUS = 20; const CENTER_ORB_MAX_RADIUS = 25; const RING_RADIUS = 70; const MAX_BAR_LENGTH = 60; const BAR_WIDTH = 3; const BAR_COLORS = ['#67E8F9', '#4FD1C5', '#A7F3D0', '#3B82F6']; const CENTER_MAIN_COLOR = 'rgba(150, 230, 255, 0.9)'; const CENTER_GLOW_COLOR = 'rgba(150, 230, 255, 0.2)';

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!isListening || !analyserNode || !canvas) {
            if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
            if (canvas) { const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); }
            return;
        }
        const context = canvas.getContext('2d'); if (!context) return;
        analyserNode.fftSize = 256; analyserNode.smoothingTimeConstant = 0.7; const bufferLength = analyserNode.frequencyBinCount; const dataArray = new Uint8Array(bufferLength); const centerX = canvas.width / 2; const centerY = canvas.height / 2;

        const draw = () => {
            animationFrameIdRef.current = requestAnimationFrame(draw); analyserNode.getByteFrequencyData(dataArray); context.clearRect(0, 0, canvas.width, canvas.height); let avgVol = dataArray.reduce((s, v) => s + v, 0) / bufferLength; avgVol = Math.min(avgVol / 100, 1); const orbR = CENTER_ORB_MIN_RADIUS + (CENTER_ORB_MAX_RADIUS - CENTER_ORB_MIN_RADIUS) * avgVol; context.save(); context.shadowBlur = 30; context.shadowColor = CENTER_GLOW_COLOR; context.fillStyle = CENTER_MAIN_COLOR; context.beginPath(); context.arc(centerX, centerY, orbR, 0, 2 * Math.PI); context.fill(); context.restore(); context.lineWidth = BAR_WIDTH; context.lineCap = 'round';
            for (let i = 0; i < NUM_BARS; i++) { const angle = (i / NUM_BARS) * 2 * Math.PI - Math.PI / 2; const dataIdx = Math.floor(Math.pow(i / NUM_BARS, 0.8) * (bufferLength * 0.85)); const barVal = dataArray[dataIdx] / 255.0; const barLen = 2 + barVal * MAX_BAR_LENGTH * (0.5 + avgVol * 0.5); if (barLen <= 2) continue; const sX = centerX + RING_RADIUS * Math.cos(angle); const sY = centerY + RING_RADIUS * Math.sin(angle); const eX = centerX + (RING_RADIUS + barLen) * Math.cos(angle); const eY = centerY + (RING_RADIUS + barLen) * Math.sin(angle); context.strokeStyle = BAR_COLORS[i % BAR_COLORS.length]; context.globalAlpha = 0.6 + barVal * 0.4; context.beginPath(); context.moveTo(sX, sY); context.lineTo(eX, eY); context.stroke(); }
            context.globalAlpha = 1.0;
        }; draw();
        return () => { if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current); if (canvas) {const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height);}};
    }, [isListening, analyserNode, width, height]);
    return <canvas ref={canvasRef} width={width} height={height} className={styles.voiceWaveformCanvasRadial} />;
};

interface RadialPulseWaveformProps { isActive: boolean; width?: number; height?: number; }
const RadialPulseWaveform: React.FC<RadialPulseWaveformProps> = ({ isActive, width = 100, height = 100 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null); const animationFrameIdRef = useRef<number | null>(null); const phaseRef = useRef(0);
    const NUM_BARS = 40; const CENTER_ORB_MIN_RADIUS = 8; const CENTER_ORB_MAX_RADIUS = 12; const RING_RADIUS = 22; const MAX_BAR_LENGTH = 20; const MIN_BAR_LENGTH = 4; const BAR_WIDTH = 2; const BAR_COLORS = ['#A7F3D0', '#67E8F9', '#4FD1C5', '#3B82F6']; const CENTER_MAIN_COLOR = 'rgba(180, 240, 255, 0.8)'; const CENTER_GLOW_COLOR = 'rgba(180, 240, 255, 0.25)';

    useEffect(() => {
        const canvas = canvasRef.current; if (!isActive || !canvas) { if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current); if (canvas) {const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); } return; }
        const context = canvas.getContext('2d'); if (!context) return; const centerX = width / 2; const centerY = height / 2;

        const draw = () => {
            animationFrameIdRef.current = requestAnimationFrame(draw); phaseRef.current += 0.04; context.clearRect(0, 0, width, height); const orbPulse = (1 + Math.sin(phaseRef.current * 1.8)) / 2; const orbR = CENTER_ORB_MIN_RADIUS + (CENTER_ORB_MAX_RADIUS - CENTER_ORB_MIN_RADIUS) * orbPulse; context.save(); context.shadowBlur = 15; context.shadowColor = CENTER_GLOW_COLOR; context.fillStyle = CENTER_MAIN_COLOR; context.beginPath(); context.arc(centerX, centerY, orbR, 0, 2 * Math.PI); context.fill(); context.restore(); context.lineWidth = BAR_WIDTH; context.lineCap = 'round';
            for (let i = 0; i < NUM_BARS; i++) { const angle = (i / NUM_BARS) * 2 * Math.PI - Math.PI / 2; const barAnimPhase = phaseRef.current + (i * Math.PI * 2.8) / NUM_BARS; const barPulse = (1 + Math.sin(barAnimPhase)) / 2; const barLen = MIN_BAR_LENGTH + barPulse * (MAX_BAR_LENGTH - MIN_BAR_LENGTH); const sX = centerX + RING_RADIUS * Math.cos(angle); const sY = centerY + RING_RADIUS * Math.sin(angle); const eX = centerX + (RING_RADIUS + barLen) * Math.cos(angle); const eY = centerY + (RING_RADIUS + barLen) * Math.sin(angle); context.strokeStyle = BAR_COLORS[i % BAR_COLORS.length]; context.globalAlpha = 0.5 + barPulse * 0.5; context.beginPath(); context.moveTo(sX, sY); context.lineTo(eX, eY); context.stroke(); }
            context.globalAlpha = 1.0;
        }; draw();
        return () => { if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current); if(canvas) {const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height);}};
    }, [isActive, width, height]);
    return <canvas ref={canvasRef} width={width} height={height} className={styles.ttsWaveformCanvas} />;
};


const getCurrentTimestamp = () => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
};

function App() {
    const [messages, setMessages] = useState<Message[]>([
        { role: "assistant", content: "Halo! Saya Asisten AI Anda. Ada yang bisa dibantu?", timestamp: getCurrentTimestamp() },
    ]);
    const [input, setInput] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [isListening, setIsListening] = useState<boolean>(false);
    const [isSpeakingTTS, setIsSpeakingTTS] = useState<boolean>(false);

    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const messagesEndRef = useRef<null | HTMLDivElement>(null);
    const textareaRef = useRef<null | HTMLTextAreaElement>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const analyserNodeRef = useRef<AnalyserNode | null>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    const autoGrowTextarea = useCallback(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            const scrollHeight = textareaRef.current.scrollHeight;
            // maxHeight diambil dari App.module.css (.inputTextArea max-height)
            // Untuk JS, kita bisa set batas atas atau biarkan CSS yang mengatur
            const maxHeightStyle = window.getComputedStyle(textareaRef.current).getPropertyValue('max-height');
            const maxHeight = maxHeightStyle.endsWith('px') ? parseInt(maxHeightStyle, 10) : 120; // Default 120px
            textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
        }
    }, []);

    const playSound = useCallback((dataOrText: string | any) => {
        if (!dataOrText) return;
        if (typeof speechSynthesis !== 'undefined') {
            speechSynthesis.cancel();
        }
        setIsSpeakingTTS(false);
        if (recognitionRef.current && isListening) {
            recognitionRef.current.stop();
        }

        if (typeof dataOrText === 'object' && dataOrText !== null) {
            let audioSrc = null;
            if (dataOrText.url) audioSrc = dataOrText.url;
            else if (dataOrText.path && (dataOrText.is_file === true || typeof dataOrText.is_file === 'undefined') && dataOrText.path.startsWith('http')) audioSrc = dataOrText.path;
            else if (dataOrText.data && dataOrText.name) {
                const audioType = dataOrText.name.endsWith('.mp3') ? 'audio/mpeg' : dataOrText.name.endsWith('.wav') ? 'audio/wav' : dataOrText.name.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav';
                audioSrc = `data:${audioType};base64,${dataOrText.data}`;
            }

            if (audioSrc && audioPlayerRef.current) {
                audioPlayerRef.current.src = audioSrc;
                audioPlayerRef.current.play().catch(e => console.error("Error playing audio from backend:", e));
            } else {
                const fallbackText = typeof dataOrText.prompt === 'string' ? dataOrText.prompt : (messages.length > 0 && messages[messages.length -1].role === 'assistant' ? messages[messages.length -1].content : "Tidak dapat memutar audio.");
                playSound(fallbackText); // Fallback to TTS
            }
        } else if (typeof dataOrText === 'string') {
            if (typeof speechSynthesis === 'undefined') { console.warn("Browser does not support Web Speech API for TTS."); return; }
            const utterance = new SpeechSynthesisUtterance(dataOrText);
            utterance.lang = "id-ID";
            let selectedVoice = availableVoices.find(v => v.lang.startsWith('id') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('wanita')));
            if (!selectedVoice && availableVoices.length > 0) selectedVoice = availableVoices.find(v => v.lang.startsWith('id'));
            if (selectedVoice) utterance.voice = selectedVoice;
            utterance.pitch = 1; utterance.rate = 0.92; utterance.volume = 1;
            
            utterance.onstart = () => {
                setIsSpeakingTTS(true);
                if (isListening && recognitionRef.current) {
                    recognitionRef.current.stop();
                }
            };
            utterance.onend = () => setIsSpeakingTTS(false);
            utterance.onerror = (event) => { console.error("SpeechSynthesis Utterance Error:", event.error); setIsSpeakingTTS(false); };
            speechSynthesis.speak(utterance);
        }
    }, [availableVoices, messages, isListening]); // playSound dependencies

    useEffect(() => {
        const populateVoiceList = () => {
            if (typeof speechSynthesis === 'undefined') return;
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                setAvailableVoices(voices.filter(voice => voice.lang.startsWith('id')));
            }
        };
        populateVoiceList();
        if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = populateVoiceList;
        }
        return () => {
            if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = null;
            }
        };
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);
    useEffect(() => { autoGrowTextarea(); }, [input, autoGrowTextarea]);

    useEffect(() => {
        const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) {
            console.warn("Browser does not support Web Speech Recognition API (STT).");
            return;
        }
        const recognitionInstance: SpeechRecognition = new SpeechRecognitionAPI();
        recognitionInstance.continuous = false; // True untuk mode dikte panjang
        recognitionInstance.interimResults = true; // Dapat result sementara
        recognitionInstance.lang = 'id-ID';

        recognitionInstance.onstart = () => {
            setIsListening(true);
            setError(null); // Bersihkan error sebelumnya saat mulai mendengar
            if (isSpeakingTTS) {
                if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
                setIsSpeakingTTS(false);
            }
        };
        recognitionInstance.onend = () => {
            setIsListening(false);
            // Pastikan stream audio ditutup jika tidak digunakan lagi oleh STT
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach(track => track.stop());
                mediaStreamRef.current = null;
            }
            if (mediaStreamSourceRef.current) {
                mediaStreamSourceRef.current.disconnect();
                mediaStreamSourceRef.current = null;
            }
            analyserNodeRef.current = null;
        };
        recognitionInstance.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error('Speech recognition error:', event.error, event.message);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                setError('Akses mikrofon tidak diizinkan atau layanan STT tidak tersedia. Mohon periksa izin browser Anda.');
                alert('Akses mikrofon tidak diizinkan atau layanan STT tidak tersedia. Mohon periksa izin browser Anda.');
            } else if (event.error === 'no-speech') {
                // setError("Tidak ada suara terdeteksi. Coba lagi."); // Bisa ditampilkan sebagai error atau hanya di console
                console.warn("STT: Tidak ada suara terdeteksi.");
            } else if (event.error === 'audio-capture') {
                setError("Masalah dengan perangkat input audio. Pastikan mikrofon terhubung dan berfungsi.");
            } else {
                setError(`Error STT: ${event.error}. ${event.message}`);
            }
            setIsListening(false); // Ini akan memicu cleanup di useEffect setupAudioVisualization
        };
        recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                setInput(prevInput => (prevInput ? prevInput.trim() + " " : "") + finalTranscript.trim());
            } else if (interimTranscript) {
                // Bisa juga menampilkan interim transcript di UI jika diinginkan
                // setInput(prevInput => (prevInputDiFinalTranscriptSebelumnya) + interimTranscript);
            }
        };
        recognitionRef.current = recognitionInstance;
        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.onstart = null; recognitionRef.current.onresult = null;
                recognitionRef.current.onerror = null; recognitionRef.current.onend = null;
                try { recognitionRef.current.abort(); } catch (e) { /* ignore */ }
            }
        };
    }, [isSpeakingTTS]);

    useEffect(() => {
        const setupAudioVisualization = async () => {
            if (isListening) {
                try {
                    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                    }
                    if (audioContextRef.current.state === 'suspended') {
                        await audioContextRef.current.resume();
                    }
                    if (!mediaStreamRef.current) { // Hanya getUserMedia jika belum ada stream
                        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    }
                    if (audioContextRef.current && mediaStreamRef.current && (!mediaStreamSourceRef.current || !analyserNodeRef.current || mediaStreamSourceRef.current.mediaStream !== mediaStreamRef.current )) {
                        if(mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect(); // Disconnect source lama
                        
                        mediaStreamSourceRef.current = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                        const newAnalyserNode = audioContextRef.current.createAnalyser();
                        mediaStreamSourceRef.current.connect(newAnalyserNode);
                        // Tidak menghubungkan analyser ke destination agar tidak ada feedback audio
                        analyserNodeRef.current = newAnalyserNode;
                    }
                } catch (err: any) {
                    console.error("Error setting up audio for STT waveform:", err);
                    setError(`Gagal mengakses mikrofon: ${err.message}. Pastikan izin telah diberikan.`);
                    if (recognitionRef.current) recognitionRef.current.stop();
                    setIsListening(false); // Ini akan memicu cleanup resources
                }
            } else { // Cleanup when not listening
                if (mediaStreamSourceRef.current) { mediaStreamSourceRef.current.disconnect(); mediaStreamSourceRef.current = null; }
                analyserNodeRef.current = null;
                if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(track => track.stop()); mediaStreamRef.current = null; }
                // Jangan close AudioContext di sini, biarkan tetap ada untuk penggunaan berikutnya
                // if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                //     audioContextRef.current.close().catch(e => console.warn("Error closing AudioContext", e));
                //     audioContextRef.current = null;
                // }
            }
        };
        setupAudioVisualization();
        
        return () => { // Cleanup on component unmount
            if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(track => track.stop());
            if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                // audioContextRef.current.close().catch(e=>console.warn("Error closing AudioContext on unmount",e));
            }
        };
    }, [isListening]); // Re-run ketika isListening berubah

    const handleToggleListen = async () => {
        if (!recognitionRef.current) {
            setError("Fitur input suara tidak tersedia atau belum siap.");
            alert("Fitur input suara tidak tersedia atau belum siap.");
            return;
        }
        if (isListening) {
            recognitionRef.current.stop();
            // setIsListening(false) akan dihandle oleh recognition.onend -> yang juga akan mematikan audio stream
        } else {
            setError(null); // Clear previous errors
            if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
            setIsSpeakingTTS(false);
            
            // Meminta izin mikrofon dan setup audio context SEBELUM recognition.start()
            try {
                if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }
                if (audioContextRef.current.state === 'suspended') {
                    await audioContextRef.current.resume();
                }
                // Pindahkan logic getUserMedia ke sini juga jika perlu memastikan stream baru setiap kali
                // Namun, useEffect [isListening] sudah menangani ini. Jika belum, kita bisa panggil setupAudioVisualization di sini.
                // Untuk kasus ini, kita asumsikan useEffect [isListening] sudah cukup.
                // Jika tidak, kita bisa memanggil `setupAudioVisualization` atau bagian dari itu di sini.

                recognitionRef.current.start();
                // setIsListening(true) dihandle oleh recognition.onstart
            } catch (e: any) {
                console.error("Gagal memulai speech recognition:", e.message, e.name);
                setError(`Gagal memulai STT: ${e.message}.`);
                if (e.name === 'InvalidStateError') {
                    try { recognitionRef.current.abort(); } catch (abortError) { console.error("Failed to abort recognition service:", abortError); }
                } else {
                    setIsListening(false); // Pastikan state kembali konsisten
                }
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedInput = input.trim();
        if (trimmedInput && !isLoading) {
            const newMessage: Message = { role: "user", content: trimmedInput, timestamp: getCurrentTimestamp() };
            setMessages((prevMessages) => [...prevMessages, newMessage]);
            setInput("");
            if (textareaRef.current) { textareaRef.current.style.height = "auto"; } // Reset height
            setIsLoading(true);
            setError(null);

            const currentMessages = [...messages, newMessage];
            const finalMessagesForApi = currentMessages
                .slice(Math.max(0, currentMessages.length - 6))
                .map(m => ({role: m.role, content: m.content}));

            try {
                const backendUrl = "http://192.168.100.29:3001/api/chat";
                const response = await fetch(backendUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages: finalMessagesForApi }),
                });
                if (!response.ok) {
                    let errData = { error: `HTTP error! status: ${response.status} ${response.statusText}`};
                    try { 
                        const errorBody = await response.json();
                        errData.error = errorBody.error || errData.error;
                    } catch (parseError) { /* ignore if not json */ }
                    throw new Error(errData.error);
                }
                const data = await response.json();
                if (data.reply && data.reply.content) {
                    const newAssistantMessage: Message = {
                        role: "assistant",
                        content: data.reply.content,
                        timestamp: getCurrentTimestamp(),
                        provider: data.reply.provider,
                        audioData: data.reply.audioData
                    };
                    setMessages((prevMessages) => [...prevMessages, newAssistantMessage]);
                    if (newAssistantMessage.audioData) {
                        playSound(newAssistantMessage.audioData);
                    } else {
                        playSound(newAssistantMessage.content);
                    }
                } else { throw new Error("Invalid response structure from server."); }
            } catch (err: any) {
                const errorMessageText = err.message || "Gagal mendapatkan respons dari server.";
                console.error("Submit Error:", err);
                setError(errorMessageText);
                const assistantErrorMessage: Message = { role: "assistant", content: `Error: ${errorMessageText}`, timestamp: getCurrentTimestamp() };
                setMessages((prevMessages) => [...prevMessages, assistantErrorMessage]);
                playSound(assistantErrorMessage.content);
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <div className={styles.appContainer}>
            <audio ref={audioPlayerRef} style={{ display: 'none' }} />
            <header className={styles.appHeader}>
                <h1>Asisten AI Cerdas Hukum</h1>
                {isSpeakingTTS && (
                    <div className={styles.ttsWaveformContainer}>
                        <RadialPulseWaveform isActive={isSpeakingTTS} width={70} height={70} />
                    </div>
                )}
            </header>
            
            <main className={styles.mainContent}>
                <div className={styles.messagesListContainer}>
                    {messages.map((message, index) => (
                        <MessageCard
                            key={index}
                            role={message.role}
                            message={message.content}
                            timestamp={message.timestamp}
                            onPlaySound={playSound}
                            audioData={message.audioData}
                        />
                    ))}
                    {isLoading && (
                        <div className={styles.loadingIndicatorContainer}>
                            <div className={styles.loadingIndicatorAvatar}>A</div>
                            <div className={styles.loadingIndicatorBubble}>
                                <div className={styles.loadingDots}>
                                    <span className="sr-only">Mengetik...</span>
                                    <div></div>
                                    <div></div>
                                    <div></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} style={{ height: '1px' }}/> {/* Untuk auto-scroll */}
                </div>

                {/* Waveform STT ditempatkan di sini agar bisa di-position:absolute oleh CSS */}
                {isListening && !isSpeakingTTS && analyserNodeRef.current && (
                    <div className={styles.waveformContainerRadial}>
                        <VoiceWaveform analyserNode={analyserNodeRef.current} isListening={isListening} width={240} height={240}/>
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
                    // Tambahkan padding bawah pada form jika STT waveform aktif
                    className={`${styles.messageInputForm} ${isListening && !isSpeakingTTS && analyserNodeRef.current ? styles.messageInputFormPaddedForWaveform : ''}`}
                >
                    <div className={styles.inputFormInnerWrapper}>
                        <textarea
                            ref={textareaRef}
                            placeholder="Tulis pesan Anda..."
                            value={input}
                            onChange={(e) => { setInput(e.target.value); }}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isLoading && !isListening) { e.preventDefault(); handleSubmit(e as any); } }}
                            className={styles.inputTextArea}
                            rows={1}
                            disabled={isLoading || isSpeakingTTS || isListening}
                        />
                        <button
                            type="button"
                            onClick={handleToggleListen}
                            className={`${styles.iconButton} ${isListening ? styles.micButtonListening : styles.micButtonIdle} ${isListening ? styles.micButtonWithText : ''}`}
                            aria-label={isListening ? "Hentikan Merekam" : "Rekam Suara"}
                            disabled={isLoading || isSpeakingTTS} 
                        >
                            {isListening ? <span>Hentikan</span> : <MicrophoneIcon />}
                        </button>
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading || isSpeakingTTS || isListening}
                            className={styles.sendButton} // Ini adalah .iconButton yang distyle khusus
                            aria-label="Kirim pesan"
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