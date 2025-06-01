// backend/server.js

// 1. Impor modul
require('dotenv').config(); 

// 2. Impor modul-modul lain
const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');
// const { Client } = require("@gradio/client"); // BARIS INI DIHAPUS/DIKOMENTARI

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
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar.");
} else {
    console.log("Pustaka Ollama terdeteksi dan siap digunakan saat startup.");
}

// Fungsi untuk timeout
function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms));
}

// Fungsi untuk memformat pesan ke template Zephyr (jika masih digunakan untuk LLM fallback)
function formatMessagesForZephyr(messagesArray) {
    const relevantMessages = messagesArray.slice(-5); 
    let promptString = "<|system|>\nAnda adalah asisten AI yang membantu dan ramah. Jawablah dengan jelas.</s>\n";
    relevantMessages.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') { 
            promptString += `<|${msg.role}|>\n${msg.content}</s>\n`;
        }
    });
    promptString += "<|assistant|>\n";
    return promptString;
}

// Fungsi untuk Terjemahan dengan MyMemory API
async function translateTextWithMyMemory(textToTranslate, sourceLang = 'en', targetLang = 'id') {
    if (!textToTranslate || typeof textToTranslate !== 'string' || textToTranslate.trim() === '') return textToTranslate; 
    try {
        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}`;
        console.log(`Menerjemahkan teks dengan MyMemory: "${textToTranslate.substring(0, 50)}..."`);
        const response = await fetch(myMemoryUrl);
        if (!response.ok) throw new Error(`MyMemory API error: ${response.status} ${response.statusText}`);
        const data = await response.json();
        if (data.responseData && data.responseData.translatedText && !data.responseData.translatedText.toUpperCase().includes("QUERY") && !data.responseData.translatedText.toUpperCase().includes("INVALID")) {
            console.log("Teks berhasil diterjemahkan oleh MyMemory.");
            return data.responseData.translatedText;
        } else if (data.matches && Array.isArray(data.matches) && data.matches.length > 0 && data.matches[0].translation) {
            console.log("Teks berhasil diterjemahkan (dari matches) oleh MyMemory.");
            return data.matches[0].translation;
        } else {
            console.warn("MyMemory tidak mengembalikan terjemahan valid:", data);
            return textToTranslate;
        }
    } catch (error) {
        console.error("Error saat menerjemahkan dengan MyMemory:", error.message);
        return textToTranslate;
    }
}

// --- Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    const ollamaModel = req.body.model || "tinyllama"; 
    const OLLAMA_TIMEOUT = 60000; 
    
    let rawReplyContent = ""; 
    let finalReplyContent = ""; 
    let respondedBy = "";
    let audioDataForFrontend = null; 
    let ollamaErrorOccurred = null;

    try {
        if (!ollama || typeof ollama.chat !== 'function') { throw new Error("Ollama service not ready."); }
        console.log(`Mencoba model Ollama: ${ollamaModel} ...`);
        const ollamaChatMessages = messages.map(m => ({role: m.role, content: m.content}));
        const ollamaOperation = ollama.chat({ model: ollamaModel, messages: ollamaChatMessages, stream: false });
        
        const ollamaResponse = await Promise.race([
            ollamaOperation,
            createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${ollamaModel}) timeout.`)
        ]);

        if (ollamaResponse && ollamaResponse.message && typeof ollamaResponse.message.content === 'string') {
            rawReplyContent = ollamaResponse.message.content;
            respondedBy = `Ollama (${ollamaModel})`;
            console.log("Respons teks dari Ollama:", rawReplyContent.substring(0,100)+"...");
        } else {
            throw new Error("Struktur respons tidak valid dari Ollama.");
        }
    } catch (ollamaError) {
        console.warn(`Gagal mendapatkan respons dari Ollama (${ollamaModel}): ${ollamaError.message}`);
        ollamaErrorOccurred = ollamaError; 
        
        // Logika Fallback LLM (misalnya ke Zephyr via Hugging Face API) bisa ditaruh di sini jika diinginkan
        // Jika fallback LLM juga gagal, rawReplyContent akan tetap kosong.
        // Untuk contoh ini, kita sederhanakan: jika Ollama gagal, tidak ada fallback LLM, langsung error.
         if (!rawReplyContent) { 
            // Jangan return res di sini dulu, biarkan terjemahan dan TTS dicoba (misal untuk pesan error)
            // atau langsung kirim error jika memang tidak ada teks sama sekali.
            // Untuk kasus ini, kita akan biarkan rawReplyContent kosong jika Ollama gagal dan tidak ada fallback LLM.
            console.log("Tidak ada konten dari Ollama, akan coba proses error jika ada.");
        }
    }

    // Jika tidak ada konten setelah mencoba Ollama (dan fallback LLM jika ada),
    // maka teks yang akan diproses selanjutnya adalah pesan error dari Ollama.
    if (!rawReplyContent && ollamaErrorOccurred) {
        rawReplyContent = `Maaf, terjadi masalah dengan AI utama: ${ollamaErrorOccurred.message}`;
        respondedBy = "Sistem Error";
    } else if (!rawReplyContent && !ollamaErrorOccurred) {
        // Kasus aneh jika tidak ada error tapi juga tidak ada konten
        rawReplyContent = "Maaf, terjadi kesalahan internal dan tidak ada respons yang bisa dihasilkan.";
        respondedBy = "Sistem Error";
    }


    // Terjemahan teks (baik itu dari AI atau pesan error)
    if (rawReplyContent) {
        finalReplyContent = await translateTextWithMyMemory(rawReplyContent, 'en', 'id');
    } else {
        finalReplyContent = "Tidak ada konten untuk diproses."; // Seharusnya tidak tercapai jika logika di atas benar
    }
    
    // Membuat Audio dengan Gradio Client untuk NihalGazi/Text-To-Speech-Unlimited
    if (finalReplyContent && HF_TOKEN) { 
        try {
            console.log(`Mencoba generate audio untuk teks: "${finalReplyContent.substring(0, 100)}..." menggunakan Gradio.`);
            
            // VVV PERBAIKAN: Impor dinamis Client VVV
            const { Client } = await import('@gradio/client');
            // ^^^ Pastikan ini di dalam fungsi async ^^^

            const gradioClient = await Client.connect("NihalGazi/Text-To-Speech-Unlimited", { 
                hf_token: HF_TOKEN 
            });
            
            const ttsResult = await gradioClient.predict("/text_to_speech_app", { 		
                prompt: finalReplyContent, 
                voice: "alloy",      // CONTOH. Ganti dengan suara valid (misal, dari dropdown demo)
                emotion: "neutral",  // CONTOH. Ganti dengan emosi valid
                use_random_seed: true, 		
                specific_seed: Math.floor(Math.random() * 100000), 
            });

            console.log("Hasil mentah dari Gradio TTS predict:", JSON.stringify(ttsResult, null, 2));
            if (ttsResult && ttsResult.data && Array.isArray(ttsResult.data) && ttsResult.data[0]) {
                audioDataForFrontend = ttsResult.data[0]; 
                console.log("Data audio berhasil didapatkan dari Gradio:", audioDataForFrontend);
                if (ttsResult.data[1]) console.log("Status dari Gradio TTS:", ttsResult.data[1]);
            } else {
                console.warn("Gradio tidak mengembalikan data audio yang diharapkan:", ttsResult);
            }
        } catch (gradioError) {
            console.error("Error saat memanggil Gradio Client untuk TTS:", gradioError);
        }
    } else if (finalReplyContent && !HF_TOKEN) {
        console.warn("HF_TOKEN tidak tersedia, TTS dengan Gradio tidak dijalankan.");
    }
    
    console.log(`Mengirim balasan akhir. Provider Teks: ${respondedBy}`);
    res.json({ 
        reply: { 
            role: "assistant", 
            content: finalReplyContent, 
            provider: respondedBy,
            audioData: audioDataForFrontend 
        } 
    });
});

app.get('/', (req, res) => { res.send('Chat backend is running and ready!'); });
app.listen(port, '0.0.0.0', () => { 
    console.log(`Node.js chat backend listening on all interfaces at port ${port}`);
    console.log("Server started. Ready to receive requests.");
});