// backend/server.js

// 1. Impor modul
require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');

// 2. Inisialisasi aplikasi Express
const app = express();
const port = process.env.PORT || 3001;

// 3. Middleware
app.use(cors());
app.use(express.json());

// 4. Ambil API key dari environment variable
const HF_TOKEN = process.env.HF_TOKEN; 

// 5. Inisialisasi instance Ollama
const ollama = ollamaImport.default;

// 6. Cek startup Ollama
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

// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    // VVV GANTI MODEL OLLAMA KE YANG SANGAT RINGAN VVV
    const ollamaModel = req.body.model || "tinyllama"; 
    const OLLAMA_TIMEOUT = 60000; // 60 detik

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required and cannot be empty." });
    }
    const lastUserMessage = messages[messages.length - 1];
    if (!lastUserMessage || !lastUserMessage.content) {
        return res.status(400).json({ error: "User message content is missing." });
    }
    const lastUserMessageContent = lastUserMessage.content;


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
                // VVV MENGGUNAKAN MODEL GPT2 UNTUK TES DASAR HUGGING FACE VVV
                const HF_MODEL_ID = "gpt2"; 
                const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL_ID}`;
                
                const hfPayload = {
                    inputs: lastUserMessageContent, // GPT2 biasanya menerima string input sederhana
                    parameters: { max_new_tokens: 150 }, // Batasi panjang output
                    options: { wait_for_model: true }
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

                const responseText = await hfAPIResponse.text(); // Ambil teks dulu untuk logging jika JSON parse gagal
                console.log("Respons mentah teks dari Hugging Face API:", responseText);

                if (!hfAPIResponse.ok) {
                    let errorDetail = `Hugging Face API error: ${hfAPIResponse.status} - ${responseText}`;
                    try { 
                        const errorJson = JSON.parse(responseText);
                        errorDetail = errorJson.error || errorDetail; 
                    } catch (e) { /* biarkan errorDetail sebagai text jika bukan JSON */ }
                    throw new Error(errorDetail);
                }
                
                const hfData = JSON.parse(responseText); // Parse JSON setelah memastikan OK

                // Ekstrak konten balasan dari hfData untuk gpt2
                // Biasanya responsnya adalah array, dengan elemen pertama berisi generated_text
                if (Array.isArray(hfData) && hfData[0] && typeof hfData[0].generated_text === 'string') {
                    let genText = hfData[0].generated_text;
                    // Hapus prompt input dari generated_text jika model mengembalikannya
                    if (genText.startsWith(lastUserMessageContent)) { 
                        genText = genText.substring(lastUserMessageContent.length).trim();
                    }
                    replyContent = genText;
                } else {
                    console.error("Struktur respons tidak dikenal atau tidak ada generated_text dari Hugging Face (gpt2):", hfData);
                    throw new Error("Struktur respons tidak dikenal dari Hugging Face (gpt2).");
                }
                
                respondedBy = `Hugging Face (${HF_MODEL_ID})`;
                console.log("Respons berhasil dari Hugging Face API.");

            } catch (hfError) {
                console.error("Gagal mendapatkan respons dari Hugging Face API juga:", hfError.message);
            }
        } else {
            console.log("HF_TOKEN tidak tersedia, tidak melakukan fallback ke Hugging Face.");
        }

        if (!replyContent) { // Jika setelah semua upaya tidak ada balasan
            let finalErrorMessage = `Gagal mendapatkan respons. Ollama error: ${ollamaError.message}`;
            // Tambahkan detail error Hugging Face jika fallback dicoba tapi gagal
            if (HF_TOKEN && respondedBy !== `Ollama (${ollamaModel})`) { 
                finalErrorMessage += ". Upaya fallback ke Hugging Face juga gagal.";
            } else if (!HF_TOKEN && ollamaError) { 
                finalErrorMessage += ". Tidak ada API Key untuk fallback ke Hugging Face.";
            }
            return res.status(500).json({ error: finalErrorMessage });
        }
    }

    // Kirim balasan yang berhasil didapatkan
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