// frontend/src/App.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageCard } from "./components/MessageCard";
import styles from './App.module.css'; // Impor CSS Module untuk App

type Message = {
    role: "assistant" | "user";
    content: string;
    timestamp: string;
};

const SendIcon = () => ( // Komponen ikon ini bisa tetap karena stylingnya via className props, tapi kita akan style buttonnya
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 md:w-5 md:h-5"> {/* Ukuran bisa diatur di CSS jika perlu */}
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

    const messagesEndRef = useRef<null | HTMLDivElement>(null);
    const textareaRef = useRef<null | HTMLTextAreaElement>(null);

    const scrollToBottom = () => { /* ... (tetap sama) ... */ };
    useEffect(() => { scrollToBottom(); }, [messages]);
    const autoGrowTextarea = useCallback(() => { /* ... (tetap sama) ... */ }, []);
    useEffect(() => { autoGrowTextarea(); }, [input, autoGrowTextarea]);
    const handleSubmit = async (e: React.FormEvent) => { /* ... (logika submit tetap sama, tanpa perubahan pada styling di sini) ... */ 
        e.preventDefault();
        const trimmedInput = input.trim();
        if (trimmedInput && !isLoading) {
            const newMessage: Message = { 
                role: "user", 
                content: trimmedInput, 
                timestamp: getCurrentTimestamp()
            };
            setMessages((prevMessages) => [...prevMessages, newMessage]);

            setInput("");
            if (textareaRef.current) {
                textareaRef.current.style.height = "auto";
            }
            setIsLoading(true);
            setError(null);

            try {
                const messagesForApi = [{ role: newMessage.role, content: newMessage.content }];
                const backendUrl = "http://192.168.100.29:3001/api/chat"; 

                const response = await fetch(backendUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages: messagesForApi }),
                });

                if (!response.ok) {
                    let errorMessage = `HTTP error! status: ${response.status}`;
                    try {
                        const errData = await response.json();
                        errorMessage = errData.error || errorMessage;
                    } catch (parseError) {
                        console.error("Could not parse error response JSON:", parseError);
                    }
                    throw new Error(errorMessage);
                }
                const data = await response.json();
                if (data.reply && data.reply.content) {
                     setMessages((prevMessages) => [
                        ...prevMessages,
                        { 
                            role: "assistant", 
                            content: data.reply.content, 
                            timestamp: getCurrentTimestamp()
                        },
                    ]);
                } else {
                    throw new Error("Invalid response structure from server.");
                }
            } catch (err: any) {
                console.error("Failed to send message or connect to backend:", err);
                const errorMessage = err.message || "Gagal mendapatkan respons. Periksa jaringan & backend.";
                setError(errorMessage);
                setMessages((prevMessages) => [
                    ...prevMessages,
                    { 
                        role: "assistant", 
                        content: `Error: ${errorMessage}`, 
                        timestamp: getCurrentTimestamp()
                    },
                ]);
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <div className={styles.appContainer}>
            <header className={styles.header}>
                <h1 className={styles.headerTitle}>
                    Asisten AI Cerdas Hukum
                </h1>
            </header>

            <main className={styles.mainContent}>
                <div className={styles.chatArea}>
                    {messages.map((message, index) => (
                        <MessageCard
                            key={index}
                            role={message.role}
                            message={message.content}
                            timestamp={message.timestamp}
                        />
                    ))}
                    {isLoading && (
                        <div className={styles.loadingIndicatorContainer}>
                             <div className={styles.loadingAvatar}>A</div>
                            <div className={styles.loadingBubble}>
                                <div className={styles.loadingDots}>
                                    <span className="sr-only">Mengetik...</span> {/* Untuk aksesibilitas */}
                                    <div className={styles.loadingDot}></div>
                                    <div className={styles.loadingDot}></div>
                                    <div className={styles.loadingDot}></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} className={styles.messagesEndRef} />
                </div>

                {error && !isLoading && (
                    <div className={styles.errorDisplay}>
                        <strong>Error:</strong> {error}
                    </div>
                )}

                <form 
                    onSubmit={handleSubmit} 
                    className={styles.inputForm} // Mungkin tambahkan styles.shadowTop jika mau
                >
                    <div className={styles.inputFormInner}>
                        <textarea
                            ref={textareaRef}
                            placeholder="Tulis pesan Anda..."
                            value={input}
                            onChange={(e) => { setInput(e.target.value); }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey && !isLoading) {
                                    e.preventDefault();
                                    handleSubmit(e as any);
                                }
                            }}
                            className={styles.inputTextarea}
                            rows={1}
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className={styles.sendButton}
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