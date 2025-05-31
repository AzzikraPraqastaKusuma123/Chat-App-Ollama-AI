// frontend/src/App.tsx
import React, { useState, useEffect, useRef } from "react";
import { MessageCard } from "./components/MessageCard"; // PASTIKAN PATH INI BENAR

type Message = {
    role: "assistant" | "user";
    content: string;
};

function App() {
    const [messages, setMessages] = useState<Message[]>([
        { role: "assistant", content: "Hello! How can I assist you today?" },
    ]);
    const [input, setInput] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const messagesEndRef = useRef<null | HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !isLoading) {
            const newMessage: Message = { role: "user", content: input };
            setMessages((prevMessages) => [...prevMessages, newMessage]);

            setInput("");
            setIsLoading(true);
            setError(null);

            try {
                const messagesForApi = [newMessage];

                // VVV ALAMAT IP BACKEND SUDAH DIMASUKKAN VVV
                // Ganti IP ini jika laptop backend Anda menggunakan IP yang lain dari daftar (misal, 192.168.100.40)
                // untuk terhubung ke jaringan yang sama dengan laptop frontend.
                const backendUrl = "http://192.168.100.29:3001/api/chat";
                // ^^^ PERIKSA KEMBALI IP INI ^^^

                const response = await fetch(backendUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        messages: messagesForApi,
                        // model: "phi:2.7b" // Model sudah di-default di backend
                    }),
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
                        { role: "assistant", content: data.reply.content },
                    ]);
                } else {
                    throw new Error("Invalid response structure from server.");
                }

            } catch (err: any) {
                console.error("Failed to send message or connect to backend:", err);
                const errorMessage = err.message || "Failed to get response. Check network & backend.";
                setError(errorMessage);
                setMessages((prevMessages) => [
                    ...prevMessages,
                    { role: "assistant", content: `Error: ${errorMessage}` },
                ]);
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gradient-to-br from-slate-900 to-slate-700 font-sans">
            <header className="bg-slate-800 shadow-xl p-4">
                <h1 className="text-2xl font-bold text-center text-white">AI Chat (Ollama)</h1>
            </header>

            <main className="flex-grow overflow-hidden p-4 md:p-6">
                <div className="max-w-3xl mx-auto h-full flex flex-col bg-white/90 backdrop-blur-md shadow-2xl rounded-xl">
                    <div className="flex-grow overflow-y-auto p-4 space-y-3">
                        {messages.map((message, index) => (
                            <MessageCard
                                key={index}
                                role={message.role}
                                message={message.content}
                            />
                        ))}
                        {isLoading && (
                            <div className="self-start flex items-center space-x-2">
                                <div className="bg-gray-200 text-gray-800 rounded-lg px-4 py-2 my-1 max-w-md w-fit shadow-md">
                                    <div className="flex items-center justify-center space-x-1">
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-75"></div>
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-150"></div>
                                        <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-225"></div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    {error && !isLoading && (
                        <div className="p-3 bg-red-100 text-red-700 border border-red-300 rounded-md mx-4 mb-2 text-sm">
                            <strong>Error:</strong> {error}
                        </div>
                    )}
                    <form onSubmit={handleSubmit} className="flex items-center p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                        <textarea
                            placeholder="Type your message here..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSubmit(e as any);
                                }
                            }}
                            className="flex-grow mr-3 p-3 border rounded-xl border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                            rows={1}
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="p-3 bg-blue-600 rounded-xl text-white font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-colors duration-150 shadow-md"
                        >
                            Send
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
}

export default App;