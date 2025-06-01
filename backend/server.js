// backend/server.js

// 1. Impor modul yang paling awal dibutuhkan, seperti dotenv
require('dotenv').config(); 

// 2. Impor modul-modul lain
const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');

// 3. Inisialisasi aplikasi Express
const app = express();
const port = process.env.PORT || 3001;

// 4. Terapkan Middleware
app.use(cors());
app.use(express.json());

// 5. Ambil API key dari environment variable
//const HF_TOKEN = process.env.HF_TOKEN; // Mengambil Hugging Face Token dari .env

// 6. Inisialisasi instance Ollama
const ollama = ollamaImport.default;

// 7. Cek startup Ollama
if (!ollama || typeof ollama.chat !== 'function') {
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar atau ollama.chat bukan fungsi.");
    // ... (log error lainnya bisa ditambahkan)
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

// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { messages, model: ollamaModel = "gemma:2b" } = req.body; // Model Ollama default
    const OLLAMA_TIMEOUT = 60000; // 60 detik

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required and cannot be empty." });
    }
    const lastUserMessageContent = messages[messages.length - 1]?.content;
    if (!lastUserMessageContent) {
        return res.status(400).json({ error: "User message content is missing." });
    }

    let replyContent = "";
    let respondedBy = "";

    try {
        // --- Mencoba Ollama ---
        if (!ollama || typeof ollama.chat !== 'function') {
            throw new Error("Konfigurasi server bermasalah: Pustaka Ollama tidak termuat dengan benar.");
        }
        console.log(`Mencoba model Ollama: ${ollamaModel} dengan batas waktu ${OLLAMA_TIMEOUT / 1000} detik...`);
        
        const ollamaOperation = ollama.chat({
            model: ollamaModel,
            messages: messages, // Kirim seluruh histori jika model Ollama mendukungnya
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
            throw new Error("Struktur respons tidak valid dari Ollama setelah Promise.race.");
        }

    } catch (ollamaError) {
        console.warn(`Gagal mendapatkan respons dari Ollama (${ollamaModel}): ${ollamaError.message}`);
        
        // --- Mencoba Fallback ke Hugging Face API ---
        if (HF_TOKEN) {
            console.log("Mencoba fallback ke Hugging Face Inference API...");
            try {
                // GANTI DENGAN MODEL ID YANG ANDA PILIH DARI HUGGING FACE HUB
                const HF_MODEL_ID = "mistralai/Mistral-7B-Instruct-v0.2"; // CONTOH MODEL
                const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL_ID}`;

                // Format payload untuk Hugging Face Inference API.
                // Ini SANGAT BERGANTUNG pada model yang Anda pilih.
                // Untuk model instruksi/chat, seringkali mengirimkan teks input terakhir.
                // Beberapa model mungkin memerlukan format chat history yang spesifik.
                // CEK DOKUMENTASI MODEL DI HUGGING FACE!
                const hfPayload = {
                    inputs: lastUserMessageContent, // Mengirim pesan terakhir pengguna
                    parameters: { // Parameter opsional
                        // return_full_text: false, // Atur false jika Anda hanya ingin teks yang digenerate
                        // max_new_tokens: 250,
                        // temperature: 0.7,
                    },
                    options: {
                        wait_for_model: true // Menunggu model jika sedang loading (cold start)
                    }
                };

                console.log(`Mengirim permintaan ke Hugging Face API (Model: ${HF_MODEL_ID})...`);
                const hfAPIResponse = await fetch(HF_API_URL, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${HF_TOKEN}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(hfPayload)
                });

                if (!hfAPIResponse.ok) {
                    const errorText = await hfAPIResponse.text(); // Ambil teks error mentah
                    console.error("Hugging Face API Error Response Text:", errorText);
                    let errorDetail = `Hugging Face API error: ${hfAPIResponse.status} - ${errorText}`;
                    try { // Coba parse JSON jika errornya dalam format JSON
                        const errorJson = JSON.parse(errorText);
                        errorDetail = errorJson.error || errorDetail; 
                    } catch (e) { /* abaikan jika bukan JSON */ }
                    throw new Error(errorDetail);
                }
                
                const hfData = await hfAPIResponse.json();
                console.log("Respons mentah dari Hugging Face API:", hfData);

                // Ekstrak konten balasan dari hfData.
                // Ini SANGAT BERGANTUNG pada struktur respons model yang Anda pilih.
                // Contoh umum untuk text generation:
                if (Array.isArray(hfData) && hfData[0] && typeof hfData[0].generated_text === 'string') {
                    // Jika input adalah string dan model mengembalikan [{ "generated_text": "..." }]
                    // Kadang inputnya sendiri ikut dalam generated_text, jadi perlu dipotong.
                    let genText = hfData[0].generated_text;
                    if (genText.startsWith(lastUserMessageContent)) { // Hapus input prompt jika ada
                        genText = genText.substring(lastUserMessageContent.length).trim();
                    }
                    replyContent = genText;
                } else if (typeof hfData.generated_text === 'string') { // Untuk beberapa model lain
                    replyContent = hfData.generated_text;
                }
                // Tambahkan parsing lain di sini jika model Anda memiliki format output berbeda
                else {
                    console.error("Struktur respons tidak dikenal atau tidak ada teks yang digenerate dari Hugging Face API:", hfData);
                    throw new Error("Struktur respons tidak dikenal dari Hugging Face API.");
                }
                
                respondedBy = `Hugging Face (${HF_MODEL_ID.split('/')[1] || HF_MODEL_ID})`;
                console.log("Respons berhasil dari Hugging Face API.");

            } catch (hfError) {
                console.error("Gagal mendapatkan respons dari Hugging Face API juga:", hfError.message);
                // Jika fallback gagal, error utama tetap dari Ollama, dan error ini akan ditambahkan ke pesan akhir
            }
        } else {
            console.log("HF_TOKEN tidak tersedia, tidak melakukan fallback ke Hugging Face.");
        }

        // Jika replyContent masih kosong setelah mencoba semua, kirim error yang sesuai
        if (!replyContent) {
            let finalErrorMessage = `Gagal mendapatkan respons. Ollama error: ${ollamaError.message}`;
            if (HF_TOKEN && respondedBy !== `Ollama (${ollamaModel})`) { // Artinya fallback ke HF dicoba tapi gagal
                finalErrorMessage += ". Upaya fallback ke Hugging Face juga gagal.";
            } else if (!HF_TOKEN && ollamaError) { // Ollama error dan tidak ada token HF
                finalErrorMessage += ". Tidak ada API Key untuk fallback.";
            }
            return res.status(500).json({ error: finalErrorMessage });
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