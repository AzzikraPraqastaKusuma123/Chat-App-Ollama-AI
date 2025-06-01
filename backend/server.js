// backend/server.js

require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');
// const fetch = require('node-fetch'); // Jika menggunakan Node.js versi lama, Anda mungkin perlu ini. Versi baru sudah built-in.

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN; 
const ollama = ollamaImport.default;

if (!ollama || typeof ollama.chat !== 'function') { /* ... Cek startup Ollama ... */ }
else { console.log("Pustaka Ollama terdeteksi dan siap digunakan saat startup."); }

function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') { /* ... sama ... */ }
function formatMessagesForZephyr(messagesArray) { /* ... sama, jika masih menggunakan Zephyr untuk HF ... */ 
    const relevantMessages = messagesArray.slice(-3); 
    let promptString = "<|system|>\nKamu adalah asisten AI yang membantu.</s>\n";
    relevantMessages.forEach(msg => {
        promptString += msg.role === 'user' ? `<|user|>\n${msg.content}</s>\n` : `<|assistant|>\n${msg.content}</s>\n`;
    });
    promptString += "<|assistant|>\n";
    return promptString;
}

// --- Fungsi Baru untuk Terjemahan dengan MyMemory API ---
async function translateTextWithMyMemory(textToTranslate, sourceLang = 'en', targetLang = 'id') {
    if (!textToTranslate || typeof textToTranslate !== 'string' || textToTranslate.trim() === '') {
        return textToTranslate; // Kembalikan teks asli jika kosong atau bukan string
    }
    try {
        // Untuk penggunaan anonim, Anda bisa menambahkan email Anda di parameter 'de' untuk batas yang sedikit lebih tinggi
        // const developerEmail = "email_anda@example.com"; // Ganti dengan email Anda jika mau
        // const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}&de=${developerEmail}`;
        
        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}`;
        console.log(`Menerjemahkan teks dengan MyMemory: "${textToTranslate.substring(0, 50)}..."`);

        const response = await fetch(myMemoryUrl);
        if (!response.ok) {
            throw new Error(`MyMemory API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        
        if (data.responseData && data.responseData.translatedText) {
            // Kadang MyMemory mengembalikan "NO QUERY SPECIFIED!" atau pesan error lain di translatedText
            if (data.responseData.translatedText.toUpperCase().includes("NO QUERY SPECIFIED") || 
                data.responseData.translatedText.toUpperCase().includes("INVALID LANGUAGE PAIR") ||
                data.responseData.translatedText.toUpperCase().includes("PLEASE CONTACT US") ) {
                console.warn("MyMemory mengembalikan pesan yang bukan terjemahan:", data.responseData.translatedText);
                return textToTranslate; // Kembalikan teks asli jika ada indikasi error dari MyMemory
            }
            console.log("Teks berhasil diterjemahkan oleh MyMemory.");
            return data.responseData.translatedText;
        } else if (data.matches && Array.isArray(data.matches) && data.matches.length > 0) {
            // Kadang hasil terbaik ada di 'matches' array
             console.log("Teks berhasil diterjemahkan (dari matches) oleh MyMemory.");
            return data.matches[0].translation;
        }
        else {
            console.warn("Struktur respons MyMemory tidak memiliki translatedText atau matches yang valid:", data);
            return textToTranslate; // Kembalikan teks asli jika tidak ada hasil terjemahan
        }
    } catch (error) {
        console.error("Error saat menerjemahkan dengan MyMemory:", error.message);
        return textToTranslate; // Jika error, kembalikan teks asli
    }
}


// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    const ollamaModel = req.body.model || "tinyllama"; 
    const OLLAMA_TIMEOUT = 60000; 

    if (!messages || !Array.isArray(messages) || messages.length === 0) { /* ... validasi ... */ }
    const lastUserMessage = messages[messages.length - 1];
    if (!lastUserMessage || !lastUserMessage.content) { /* ... validasi ... */ }
    // const lastUserMessageContent = lastUserMessage.content; // Digunakan di formatMessagesForZephyr

    let rawReplyContent = ""; // Konten sebelum diterjemahkan
    let finalReplyContent = ""; // Konten setelah mungkin diterjemahkan
    let respondedBy = "";

    try {
        // --- Mencoba Ollama ---
        // ... (Logika try Ollama dengan Promise.race tetap sama) ...
        if (!ollama || typeof ollama.chat !== 'function') { throw new Error("Ollama service not ready."); }
        console.log(`Mencoba model Ollama: ${ollamaModel} ...`);
        const ollamaOperation = ollama.chat({ model: ollamaModel, messages: messages, stream: false });
        const ollamaResponse = await Promise.race([
            ollamaOperation,
            createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${ollamaModel}) timeout.`)
        ]);

        if (ollamaResponse && ollamaResponse.message && typeof ollamaResponse.message.content === 'string') {
            rawReplyContent = ollamaResponse.message.content;
            respondedBy = `Ollama (${ollamaModel})`;
            console.log("Respons berhasil dari Ollama (sebelum terjemahan):", rawReplyContent.substring(0,100)+"...");
        } else {
            throw new Error("Struktur respons tidak valid dari Ollama.");
        }

    } catch (ollamaError) {
        console.warn(`Gagal mendapatkan respons dari Ollama (${ollamaModel}): ${ollamaError.message}`);
        
        // --- Mencoba Fallback ke Hugging Face API ---
        if (HF_TOKEN) {
            console.log("Mencoba fallback ke Hugging Face Inference API...");
            try {
                const HF_MODEL_ID = "HuggingFaceH4/zephyr-7b-beta"; // Atau model HF pilihan Anda
                const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL_ID}`;
                const zephyrFormattedPrompt = formatMessagesForZephyr(messages);
                const hfPayload = {
                    inputs: zephyrFormattedPrompt,
                    parameters: { return_full_text: false, max_new_tokens: 350, temperature: 0.7 },
                    options: { wait_for_model: true, use_cache: false }
                };

                console.log(`Mengirim permintaan ke Hugging Face API (Model: ${HF_MODEL_ID})...`);
                const hfAPIResponse = await fetch(HF_API_URL, { /* ... (sama seperti kode lengkap terakhir) ... */ 
                    method: "POST",
                    headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
                    body: JSON.stringify(hfPayload)
                });
                const responseText = await hfAPIResponse.text();
                if (!hfAPIResponse.ok) { /* ... error handling sama ... */ }
                const hfData = JSON.parse(responseText); 
                if (Array.isArray(hfData) && hfData[0] && typeof hfData[0].generated_text === 'string') {
                    rawReplyContent = hfData[0].generated_text.trim();
                } else { /* ... error handling sama ... */ throw new Error(`Struktur respons HF tidak dikenal.`);}
                
                respondedBy = `Hugging Face (${HF_MODEL_ID.split('/')[1] || HF_MODEL_ID})`;
                console.log("Respons berhasil dari Hugging Face API (sebelum terjemahan):", rawReplyContent.substring(0,100)+"...");

            } catch (hfError) {
                console.error("Gagal mendapatkan respons dari Hugging Face API juga:", hfError.message);
            }
        } else {
            console.log("HF_TOKEN tidak tersedia, tidak melakukan fallback ke Hugging Face.");
        }

        // Jika setelah semua upaya (Ollama & HF) tidak ada balasan mentah, kirim error
        if (!rawReplyContent) { 
            let finalErrorMessage = `Gagal mendapatkan respons. Ollama error: ${ollamaError.message}`;
            if (HF_TOKEN && respondedBy !== `Ollama (${ollamaModel})`) { 
                finalErrorMessage += ". Upaya fallback ke Hugging Face juga gagal.";
            } else if (!HF_TOKEN && ollamaError) { 
                finalErrorMessage += ". Tidak ada API Key untuk fallback ke Hugging Face.";
            }
            return res.status(500).json({ error: finalErrorMessage });
        }
    }

    // --- Lakukan Terjemahan Jika Ada Respons dari AI ---
    if (rawReplyContent) {
        console.log("Memulai proses terjemahan untuk respons AI...");
        finalReplyContent = await translateTextWithMyMemory(rawReplyContent, 'en', 'id');
        if (finalReplyContent === rawReplyContent) {
            console.log("Terjemahan tidak mengubah teks (mungkin sudah Indonesia atau error terjemahan).");
        } else {
            console.log("Teks AI berhasil diterjemahkan ke Bahasa Indonesia.");
        }
    } else {
        // Ini seharusnya tidak tercapai jika logika di atas benar
        if (!res.headersSent) { 
           return res.status(500).json({ error: "Tidak ada konten balasan awal dari AI untuk diterjemahkan." });
        }
    }

    // Kirim balasan akhir (sudah diterjemahkan jika perlu)
    console.log(`Mengirim balasan akhir dari: ${respondedBy}. Konten:`, finalReplyContent.substring(0,100)+"...");
    res.json({ reply: { role: "assistant", content: finalReplyContent, provider: respondedBy } });
});

// --- Health Check Endpoint ---
app.get('/', (req, res) => { /* ... sama ... */ });

// Start the server
app.listen(port, '0.0.0.0', () => { /* ... sama ... */ });