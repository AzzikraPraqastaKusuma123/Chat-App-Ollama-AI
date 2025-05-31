// backend/server.js

// 1. Impor modul yang paling awal dibutuhkan, seperti dotenv
require('dotenv').config(); // Panggil ini di paling atas jika Anda menggunakan .env

// 2. Impor modul-modul lain
const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');

// 3. Inisialisasi aplikasi Express SETELAH mengimpor express
const app = express();
const port = process.env.PORT || 3001;

// 4. Terapkan Middleware (menggunakan 'app')
app.use(cors());
app.use(express.json());

// 5. Ambil API key dari environment variable
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// 6. Inisialisasi instance Ollama
const ollama = ollamaImport.default;

// 7. Cek startup Ollama
if (!ollama || typeof ollama.chat !== 'function') {
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar atau ollama.chat bukan fungsi.");
    console.error("Pastikan pustaka 'ollama' terinstal dengan benar.");
    if (ollamaImport && ollamaImport.default) {
        console.error("Tipe dari ollamaImport.default.chat:", typeof ollamaImport.default.chat);
    } else if (ollamaImport) {
        console.error("ollamaImport.default tidak ada. Properti yang tersedia:", Object.keys(ollamaImport));
    }
    // process.exit(1); // Pertimbangkan untuk menghentikan server jika Ollama adalah komponen kritis utama
} else {
    console.log("Pustaka Ollama (instance default, dengan metode .chat) terdeteksi dan siap digunakan saat startup.");
}

// Fungsi untuk membuat promise yang akan reject setelah timeout
function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(errorMessage));
        }, ms);
    });
}

// 8. Definisikan Rute Anda
// --- Ollama Chat Endpoint dengan Fallback ke DeepSeek ---
app.post('/api/chat', async (req, res) => {
    const { messages, model = "gemma:2b" } = req.body; // Model Ollama default
    const OLLAMA_TIMEOUT = 60000; // 60 detik

    // Validasi input dasar
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required and cannot be empty." });
    }
    for (const message of messages) {
        if (!message.role || !message.content) {
            return res.status(400).json({ error: "Each message must have a 'role' and 'content'." });
        }
    }

    let replyContent = "";
    let respondedBy = "";

    try {
        // Validasi Pustaka Ollama sebelum digunakan di endpoint
        if (!ollama || typeof ollama.chat !== 'function') {
            console.error("Kesalahan Kritis di Endpoint /api/chat: ollama.chat bukan fungsi.");
            throw new Error("Konfigurasi server bermasalah: Pustaka Ollama tidak termuat dengan benar.");
        }

        console.log(`Mencoba model Ollama: ${model} dengan batas waktu ${OLLAMA_TIMEOUT / 1000} detik...`);
        
        const ollamaOperation = ollama.chat({
            model: model,
            messages: messages,
            stream: false,
        });

        const ollamaResponse = await Promise.race([
            ollamaOperation,
            createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${model}) tidak merespons dalam ${OLLAMA_TIMEOUT / 1000} detik.`)
        ]);

        if (ollamaResponse && ollamaResponse.message && typeof ollamaResponse.message.content === 'string') {
            replyContent = ollamaResponse.message.content;
            respondedBy = `Ollama (${model})`;
            console.log("Respons berhasil dari Ollama.");
        } else {
            throw new Error("Struktur respons tidak valid dari Ollama setelah Promise.race.");
        }

    } catch (ollamaError) {
        console.warn(`Gagal mendapatkan respons dari Ollama (${model}): ${ollamaError.message}`);
        
        if (DEEPSEEK_API_KEY) {
            console.log("Mencoba fallback ke DeepSeek API...");
            try {
                const deepseekPayloadMessages = messages.map(msg => ({ role: msg.role, content: msg.content }));
                // PASTIKAN URL DAN NAMA MODEL DEEPSEEK INI BENAR SESUAI DOKUMENTASI MEREKA
                const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"; 
                const DEEPSEEK_MODEL_NAME = "deepseek-chat"; // atau "deepseek-coder"

                console.log(`Mengirim permintaan ke DeepSeek API (Model: ${DEEPSEEK_MODEL_NAME})...`);
                const deepseekAPIResponse = await fetch(DEEPSEEK_API_URL, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: DEEPSEEK_MODEL_NAME,
                        messages: deepseekPayloadMessages,
                        // stream: false, // Tambahkan parameter lain jika perlu
                    })
                });

                if (!deepseekAPIResponse.ok) {
                    const errorData = await deepseekAPIResponse.json().catch(() => deepseekAPIResponse.text());
                    console.error("DeepSeek API Error Data:", errorData);
                    throw new Error( (typeof errorData === 'string' ? errorData : errorData?.error?.message) || `DeepSeek API error: ${deepseekAPIResponse.status}`);
                }
                
                const deepseekData = await deepseekAPIResponse.json();
                console.log("Respons mentah dari DeepSeek API:", deepseekData); // Log respons mentah

                // SESUAIKAN CARA MENGAMBIL KONTEN BERDASARKAN STRUKTUR RESPONS DEEPSEEK
                if (deepseekData.choices && deepseekData.choices[0] && deepseekData.choices[0].message && deepseekData.choices[0].message.content) {
                    replyContent = deepseekData.choices[0].message.content;
                } else {
                    console.error("Struktur respons tidak dikenal dari DeepSeek API:", deepseekData);
                    throw new Error("Struktur respons tidak dikenal dari DeepSeek API.");
                }
                respondedBy = `DeepSeek API (${DEEPSEEK_MODEL_NAME})`;
                console.log("Respons berhasil dari DeepSeek API.");

            } catch (deepseekError) {
                console.error("Gagal mendapatkan respons dari DeepSeek API juga:", deepseekError.message);
                // Error akan ditangani oleh blok di bawah jika replyContent tetap kosong
            }
        } else {
            console.log("DEEPSEEK_API_KEY tidak tersedia, tidak melakukan fallback.");
        }

        // Jika replyContent masih kosong setelah mencoba semua (Ollama dan DeepSeek jika ada key),
        // kirim error yang relevan.
        if (!replyContent) {
            // Menggunakan error dari Ollama sebagai error utama jika fallback tidak dicoba atau gagal
            return res.status(500).json({ error: `Gagal mendapatkan respons. Ollama error: ${ollamaError.message}` + (DEEPSEEK_API_KEY ? ". Upaya fallback ke DeepSeek juga gagal." : ". Tidak ada fallback API Key.") });
        }
    }

    // Kirim balasan yang berhasil didapatkan
    if (replyContent) {
        console.log(`Mengirim balasan dari: ${respondedBy}`);
        res.json({ reply: { role: "assistant", content: replyContent, provider: respondedBy } });
    } else {
        // Ini sebagai jaring pengaman terakhir, idealnya tidak akan pernah tercapai.
        if (!res.headersSent) { 
           res.status(500).json({ error: "Terjadi kesalahan internal dan tidak ada balasan yang dapat dihasilkan." });
        }
    }
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