// backend/server.js

// 1. Impor modul
require('dotenv').config(); 

// 2. Impor modul-modul lain
const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');

// 3. Inisialisasi aplikasi Express
const app = express();
const port = process.env.PORT || 3001;

// 4. Middleware
app.use(cors());
app.use(express.json());

// 5. Ambil API key dari environment variable
const HF_TOKEN = process.env.HF_TOKEN; 

// 6. Inisialisasi instance Ollama
const ollama = ollamaImport.default;

// 7. Cek startup Ollama
if (!ollama || typeof ollama.chat !== 'function') {
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar atau ollama.chat bukan fungsi.");
} else {
    console.log("Pustaka Ollama terdeteksi dan siap digunakan saat startup.");
}

// Fungsi untuk timeout
function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(errorMessage));
        }, ms);
    });
}

// Fungsi untuk memformat pesan ke template Zephyr (PERLU VERIFIKASI & PENYESUAIAN)
function formatMessagesForZephyr(messagesArray) {
    // Template dasar Zephyr: <|system|>\nSYSTEM_MESSAGE</s>\n<|user|>\nUSER_MESSAGE</s>\n<|assistant|>
    // Anda mungkin perlu menyesuaikan system message atau cara histori digabungkan.
    // Mengambil beberapa pesan terakhir untuk konteks (misalnya 3)
    const relevantMessages = messagesArray.slice(-3); 
    let promptString = "<|system|>\nKamu adalah asisten AI yang cerdas dan membantu. Jawablah pertanyaan pengguna dengan jelas.</s>\n";
    
    relevantMessages.forEach(msg => {
        if (msg.role === 'user') {
            promptString += `<|user|>\n${msg.content}</s>\n`;
        } else if (msg.role === 'assistant') {
            promptString += `<|assistant|>\n${msg.content}</s>\n`;
        }
    });
    promptString += "<|assistant|>\n"; // Agar model melanjutkan sebagai asisten
    return promptString;
}

// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    const ollamaModel = req.body.model || "tinyllama"; // Default ke model Ollama yang ringan
    const OLLAMA_TIMEOUT = 60000; // 60 detik

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required and cannot be empty." });
    }
    // const lastUserMessage = messages[messages.length - 1]; // Sudah ada di dalam formatMessagesForZephyr
    // if (!lastUserMessage || !lastUserMessage.content) {
    //     return res.status(400).json({ error: "User message content is missing." });
    // }
    // const lastUserMessageContent = lastUserMessage.content;

    let replyContent = "";
    let respondedBy = "";

    try {
        // --- Mencoba Ollama ---
        if (!ollama || typeof ollama.chat !== 'function') {
            throw new Error("Konfigurasi server bermasalah: Pustaka Ollama tidak termuat.");
        }
        console.log(`Mencoba model Ollama: ${ollamaModel} dengan batas waktu ${OLLAMA_TIMEOUT / 1000} detik...`);
        
        const ollamaOperation = ollama.chat({
            model: ollamaModel,
            messages: messages, 
            stream: false,
        });

        const ollamaResponse = await Promise.race([
            ollamaOperation,
            createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${ollamaModel}) tidak merespons dalam ${OLLAMA_TIMEOUT / 1000} detik.`)
        ]);

        if (ollamaResponse && ollamaResponse.message && typeof ollamaResponse.message.content === 'string') {
            replyContent = ollamaResponse.message.content;
            respondedBy = `Ollama (${ollamaModel})`;
            console.log("Respons berhasil dari Ollama.");
        } else {
            throw new Error("Struktur respons tidak valid dari Ollama.");
        }

    } catch (ollamaError) {
        console.warn(`Gagal mendapatkan respons dari Ollama (${ollamaModel}): ${ollamaError.message}`);
        
        // --- Mencoba Fallback ke Hugging Face API ---
        if (HF_TOKEN) {
            console.log("Mencoba fallback ke Hugging Face Inference API...");
            try {
                const HF_MODEL_ID = "HuggingFaceH4/zephyr-7b-beta"; 
                const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL_ID}`;
                
                // Format input untuk Zephyr. PERIKSA DOKUMENTASI MODELNYA DI HF HUB!
                const zephyrFormattedPrompt = formatMessagesForZephyr(messages); // Mengirim seluruh histori (atau slice)

                const hfPayload = {
                    inputs: zephyrFormattedPrompt,
                    parameters: { 
                        return_full_text: false, 
                        max_new_tokens: 350,   
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                    options: {
                        wait_for_model: true,     
                        use_cache: false          
                    }
                };

                console.log(`Mengirim permintaan ke Hugging Face API (Model: ${HF_MODEL_ID}). Inputs (awal): "${zephyrFormattedPrompt.substring(0,150)}..."`);
                
                const hfAPIResponse = await fetch(HF_API_URL, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${HF_TOKEN}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(hfPayload)
                });

                const responseText = await hfAPIResponse.text();
                // console.log("Respons mentah teks dari Hugging Face API:", responseText); // Aktifkan untuk debugging

                if (!hfAPIResponse.ok) {
                    let errorDetail = `Hugging Face API error: ${hfAPIResponse.status} - ${responseText}`;
                    try { 
                        const errorJson = JSON.parse(responseText);
                        errorDetail = errorJson.error || (Array.isArray(errorJson.errors) ? errorJson.errors.join(', ') : errorDetail);
                    } catch (e) { /* biarkan errorDetail sebagai text jika bukan JSON */ }
                    throw new Error(errorDetail);
                }
                
                const hfData = JSON.parse(responseText); 
                console.log("Respons data JSON dari Hugging Face API:", hfData);

                // Parsing Respons dari Zephyr/Mistral (biasanya array dengan generated_text)
                // !!! WAJIB VERIFIKASI STRUKTUR RESPONS DARI MODEL SPESIFIK INI !!!
                if (Array.isArray(hfData) && hfData[0] && typeof hfData[0].generated_text === 'string') {
                    replyContent = hfData[0].generated_text.trim();
                } else if (typeof hfData.generated_text === 'string') { // Beberapa model mungkin langsung
                     replyContent = hfData.generated_text.trim();
                } else {
                    console.error(`Struktur respons tidak dikenal dari Hugging Face (Model: ${HF_MODEL_ID}):`, hfData);
                    throw new Error(`Struktur respons tidak dikenal dari Hugging Face (Model: ${HF_MODEL_ID}). Periksa log untuk detail.`);
                }
                
                respondedBy = `Hugging Face (${HF_MODEL_ID.split('/')[1] || HF_MODEL_ID})`;
                console.log("Respons berhasil dari Hugging Face API.");

            } catch (hfError) {
                console.error("Gagal mendapatkan respons dari Hugging Face API juga:", hfError.message);
            }
        } else {
            console.log("HF_TOKEN tidak tersedia, tidak melakukan fallback ke Hugging Face.");
        }

        if (!replyContent) { 
            let finalErrorMessage = `Gagal mendapatkan respons. Ollama error: ${ollamaError.message}`;
            if (HF_TOKEN && respondedBy !== `Ollama (${ollamaModel})`) { 
                finalErrorMessage += ". Upaya fallback ke Hugging Face juga gagal.";
            } else if (!HF_TOKEN && ollamaError) { 
                finalErrorMessage += ". Tidak ada API Key untuk fallback ke Hugging Face.";
            }
            return res.status(500).json({ error: finalErrorMessage });
        }
    }

    console.log(`Mengirim balasan dari: ${respondedBy}`);
    res.json({ reply: { role: "assistant", content: replyContent, provider: respondedBy } });
});

// --- Health Check Endpoint ---
app.get('/', (req, res) => {
    res.send('Chat backend is running and ready!');
});

// Start the server
app.listen(port, '0.0.0.0', () => { 
    console.log(`Node.js chat backend listening on all interfaces at port ${port}`);
    console.log(`Ollama API endpoint available at POST /api/chat`);
    console.log("Server started. Ready to receive requests.");
});