// frontend/src/App.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageCard } from "./components/MessageCard";
// Pastikan ./index.css diimpor di main.tsx atau index.tsx Anda
import styles from './App.module.css'; // Impor CSS Module untuk App
type Message = {
    role: "assistant" | "user";
    content: string;
    timestamp: string;
    provider?: string; 
    audioData?: any; 
};

const SendIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 md:w-5 md:h-5 transform transition-transform duration-150 group-hover:scale-110">
        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
    </svg>
);

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
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const messagesEndRef = useRef<null | HTMLDivElement>(null);
    const textareaRef = useRef<null | HTMLTextAreaElement>(null);

    useEffect(() => {
        const populateVoiceList = () => {
            if (typeof speechSynthesis === 'undefined') { console.warn("Browser tidak mendukung Web Speech API."); return; }
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                const indonesianVoices = voices.filter(voice => voice.lang.startsWith('id'));
                setAvailableVoices(indonesianVoices);
                console.log("Suara Bahasa Indonesia yang tersedia (Web Speech API):", indonesianVoices);
                if (indonesianVoices.length === 0) { console.warn("Tidak ada suara Bahasa Indonesia ditemukan di Web Speech API sistem ini."); }
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

    const playSound = useCallback((dataOrText: string | any) => {
        if (!dataOrText) return;
        if (typeof dataOrText === 'object' && dataOrText !== null) { 
            console.log("Mencoba memutar audioData dari backend:", dataOrText);
            let audioSrc = null;
            // Penyesuaian untuk format output Gradio Client umum
            if (dataOrText.url) { 
                audioSrc = dataOrText.url;
            } else if (dataOrText.path && (dataOrText.is_file === true || typeof dataOrText.is_file === 'undefined') && dataOrText.path.startsWith('http')) {
                audioSrc = dataOrText.path;
            } else if (dataOrText.data && dataOrText.name) { 
                const audioType = dataOrText.name.endsWith('.mp3') ? 'audio/mpeg' : 
                                  dataOrText.name.endsWith('.wav') ? 'audio/wav' : 
                                  dataOrText.name.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav';
                audioSrc = `data:${audioType};base64,${dataOrText.data}`;
            }
            if (audioSrc) {
                if (audioPlayerRef.current) {
                    console.log("Memutar audio dari src:", audioSrc.substring(0,100)+"...");
                    audioPlayerRef.current.src = audioSrc;
                    audioPlayerRef.current.play().catch(e => console.error("Error memutar audio dari backend:", e));
                }
            } else { 
                console.warn("Format audioData tidak dikenali atau tidak ada sumber audio valid:", dataOrText);
                // Jika audioData tidak bisa diputar dan berupa objek, mungkin ada teks di dalamnya?
                if (typeof dataOrText.prompt === 'string') playSound(dataOrText.prompt); // Fallback jika ada prompt di data
                else if (messages.length > 0 && messages[messages.length -1].role === 'assistant') playSound(messages[messages.length -1].content); // Coba putar teks terakhir asisten
            }
        } else if (typeof dataOrText === 'string') { 
            console.log("Memutar teks dengan Web Speech API:", dataOrText);
            if (typeof speechSynthesis === 'undefined') return;
            speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(dataOrText);
            utterance.lang = "id-ID";
            let selectedVoice = availableVoices.find(v => v.lang.startsWith('id') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('wanita')));
            if (!selectedVoice && availableVoices.length > 0) selectedVoice = availableVoices.find(v => v.lang.startsWith('id'));
            if (selectedVoice) { utterance.voice = selectedVoice; console.log("Menggunakan suara TTS (browser):", selectedVoice.name); } 
            else { console.warn("Tidak ada suara id-ID spesifik, menggunakan default browser."); }
            utterance.pitch = 1; utterance.rate = 0.9; utterance.volume = 1;
            speechSynthesis.speak(utterance);
        }
    }, [availableVoices, messages]); // Tambahkan messages sebagai dependency jika Anda mengaksesnya di fallback

    const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); };
    useEffect(() => { scrollToBottom(); }, [messages]);

    const autoGrowTextarea = useCallback(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            const scrollHeight = textareaRef.current.scrollHeight;
            const maxHeight = 128; 
            textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
        }
    }, []);
    useEffect(() => { autoGrowTextarea(); }, [input, autoGrowTextarea]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedInput = input.trim();
        if (trimmedInput && !isLoading) {
            const newMessage: Message = { role: "user", content: trimmedInput, timestamp: getCurrentTimestamp() };
            setMessages((prevMessages) => [...prevMessages, newMessage]);
            setInput("");
            if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
            setIsLoading(true);
            setError(null);
            try {
                const currentMessagesForApi = messages.slice(-5).map(m => ({role: m.role, content: m.content}));
                currentMessagesForApi.push({role: newMessage.role, content: newMessage.content});

                const backendUrl = "http://192.168.100.29:3001/api/chat"; 
                const response = await fetch(backendUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages: currentMessagesForApi }),
                });
                if (!response.ok) { 
                    let errData = { error: `HTTP error! status: ${response.status}`};
                    try { errData = await response.json(); } catch (e) {}
                    throw new Error(errData.error || `HTTP error! status: ${response.status}`);
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
                const errorMessage = err.message || "Gagal mendapatkan respons.";
                setError(errorMessage);
                const assistantErrorMessage: Message = { role: "assistant", content: `Error: ${errorMessage}`, timestamp: getCurrentTimestamp() };
                setMessages((prevMessages) => [...prevMessages, assistantErrorMessage]);
                playSound(assistantErrorMessage.content); 
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-100 font-sans">
            <audio ref={audioPlayerRef} style={{ display: 'none' }} />
            <header className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 shadow-md p-4 sticky top-0 z-20">
                <h1 className="text-xl md:text-2xl font-semibold text-center text-white">Asisten AI Cerdas Hukum</h1>
            </header>
            <main className="flex-grow overflow-hidden flex flex-col">
                <div className="flex-grow overflow-y-auto p-4 md:p-6 w-full max-w-3xl mx-auto">
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
                        <div className={`flex items-end gap-2.5 my-2.5 w-full justify-start`}>
                             <div className="flex-shrink-0 w-8 h-8 md:w-9 md:h-9 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-sm font-medium shadow">A</div>
                            <div className="bg-white text-slate-700 rounded-r-xl rounded-tl-xl rounded-bl-lg border border-slate-200 px-4 py-3 shadow-md">
                                <div className="flex items-center space-x-1.5">
                                    <span className="sr-only">Mengetik...</span>
                                    <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-bounce"></div>
                                    <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.15s'}}></div>
                                    <div className="w-2.5 h-2.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.3s'}}></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} className="h-1"/>
                </div>
                {error && !isLoading && (
                    <div className="p-3 bg-red-100 text-red-700 border-t border-red-200 text-sm text-center w-full max-w-3xl mx-auto">
                        <strong>Error:</strong> {error}
                    </div>
                )}
                <form onSubmit={handleSubmit} className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 p-3 md:p-4 w-full z-10">
                    <div className="max-w-3xl mx-auto flex items-end space-x-2.5">
                        <textarea
                            ref={textareaRef}
                            placeholder="Tulis pesan Anda..."
                            value={input}
                            onChange={(e) => { setInput(e.target.value); }}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isLoading) { e.preventDefault(); handleSubmit(e as any); } }}
                            className="flex-grow p-3 text-sm md:text-base bg-white border-2 rounded-lg border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none min-h-[46px] md:min-h-[48px] max-h-32 overflow-y-auto"
                            rows={1}
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="group p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white font-semibold hover:from-blue-600 hover:to-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 shadow hover:shadow-md flex-shrink-0 h-[46px] md:h-[48px] flex items-center justify-center"
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