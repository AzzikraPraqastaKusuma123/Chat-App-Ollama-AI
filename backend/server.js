// backend/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');

const app = express();
const port = process.env.PORT || 3001;

// Middleware untuk logging semua permintaan masuk
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] Menerima permintaan: ${req.method} ${req.url} dari Origin: ${req.headers.origin}`);
    next();
});

// --- KONFIGURASI CORS YANG DISEMPURNAKAN DAN DISEMPAN ---
const corsOptions = {
    origin: (origin, callback) => {
        // Untuk debugging, izinkan semua origin.
        // PERINGATAN: Untuk produksi, Anda HARUS membatasi ini ke domain frontend Anda yang sebenarnya.
        console.log(`    CORS Middleware: Memeriksa origin: ${origin}`);
        callback(null, true); // Izinkan semua untuk debugging saat ini
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true,
    optionsSuccessStatus: 204 // Standar untuk preflight adalah 204 No Content.
                               // Middleware `cors` akan menangani respons untuk permintaan OPTIONS.
};

// Terapkan middleware CORS untuk SEMUA rute dan SEMUA metode (termasuk OPTIONS).
// Pustaka `cors` akan secara otomatis menangani permintaan preflight OPTIONS.
app.use(cors(corsOptions));
// --- AKHIR KONFIGURASI CORS ---

app.use(express.json()); // Middleware untuk mem-parsing body JSON

const HF_TOKEN = process.env.HF_TOKEN;
const ollama = ollamaImport.default;

if (!ollama || typeof ollama.chat !== 'function') {
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar.");
} else {
    console.log("Pustaka Ollama terdeteksi dan siap digunakan saat startup.");
}

function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms));
}

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

function formatMessagesForLlama3(messagesArray, systemMessage = "Anda adalah asisten AI yang membantu dan ramah. Jawablah dengan jelas dalam Bahasa Indonesia.") {
    const relevantMessages = messagesArray.slice(-5);
    let promptString = "<|begin_of_text|>";
    if (systemMessage) {
        promptString += `<|start_header_id|>system<|end_header_id|>\n\n${systemMessage}<|eot_id|>`;
    }
    relevantMessages.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') {
            promptString += `<|start_header_id|>${msg.role}<|end_header_id|>\n\n${msg.content}<|eot_id|>`;
        }
    });
    promptString += "<|start_header_id|>assistant<|end_header_id|>\n\n";
    return promptString;
}

// Fungsi format untuk model Llama-3-8B-Instruct-abliterated-v2
// Model ini menggunakan format yang sama dengan Llama 3 Instruct asli.
function formatMessagesForLlama3Abliterated(messagesArray, systemMessage = "Anda adalah asisten AI yang membantu, ramah, dan profesional. Jawablah dengan akurat, jelas, ringkas, dan tanpa typo dalam Bahasa Indonesia. Fokus pada inti pertanyaan.") {
    return formatMessagesForLlama3(messagesArray, systemMessage);
}


async function processTextInChunks(text, sourceLang, targetLang, maxChunkLength) {
    const translatedParts = [];
    let remainingText = text;
    if (text.length > maxChunkLength) {
        console.log(`Menerjemahkan teks panjang (${text.length} chars) dalam beberapa bagian...`);
    }

    while (remainingText.length > 0) {
        let chunkToSend;
        if (remainingText.length <= maxChunkLength) {
            chunkToSend = remainingText;
            remainingText = "";
        } else {
            let splitPoint = remainingText.lastIndexOf(' ', maxChunkLength);
            if (splitPoint === -1 || splitPoint === 0) { 
                splitPoint = maxChunkLength;
            }
            chunkToSend = remainingText.substring(0, splitPoint);
            remainingText = remainingText.substring(splitPoint).trimStart(); 
        }

        if (chunkToSend.trim() === '') continue;

        try {
            const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunkToSend)}&langpair=${sourceLang}|${targetLang}`;
            const response = await fetch(myMemoryUrl);

            if (!response.ok) {
                const errorText = await response.text(); 
                console.warn(`MyMemory API error untuk bagian: ${response.status} ${response.statusText} - ${errorText}. Bagian asli dipertahankan.`);
                translatedParts.push(chunkToSend); 
                continue;
            }
            const data = await response.json();
            const translatedChunk = data.responseData?.translatedText;
            const detailError = data.responseData?.responseDetails || data.responseDetails;

            if (translatedChunk && typeof translatedChunk === 'string' && !translatedChunk.toUpperCase().includes("QUERY LENGTH LIMIT EXCEEDED") && !translatedChunk.toUpperCase().includes("INVALID")) {
                return translatedChunk; // BUG FIX: Harus dikembalikan translatedChunk, bukan translatedText
            } else if (data.matches?.[0]?.translation) { 
                 translatedParts.push(data.matches[0].translation);
            } else {
                console.warn(`MyMemory tidak mengembalikan terjemahan valid untuk bagian: ${detailError || JSON.stringify(data)}. Bagian asli dipertahankan.`);
                translatedParts.push(chunkToSend); 
            }
        } catch (chunkError) {
            console.error(`Error saat menerjemahkan bagian: ${chunkError.message}. Bagian asli dipertahankan.`);
            translatedParts.push(chunkToSend); 
        }
    }
    if (text.length > maxChunkLength) {
        console.log("Semua bagian selesai diproses.");
    }
    return translatedParts.join(" ").trim(); 
}

async function translateTextWithMyMemory(textToTranslate, sourceLang = 'en', targetLang = 'id') {
    if (!textToTranslate || typeof textToTranslate !== 'string' || textToTranslate.trim() === '') return textToTranslate;

    const MAX_CHARS_MYMEMORY_FREE = 480; 

    if (textToTranslate.length <= MAX_CHARS_MYMEMORY_FREE) {
        try {
            const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}`;
            const response = await fetch(myMemoryUrl);
            if (!response.ok) {
                const errorText = await response.text(); 
                throw new Error(`MyMemory API error: ${response.status} ${response.statusText} - ${errorText}`);
            }
            const data = await response.json();
            const translatedText = data.responseData?.translatedText;
            const detailError = data.responseData?.responseDetails || data.responseDetails;

            if (translatedText && typeof translatedText === 'string' && !translatedText.toUpperCase().includes("QUERY LENGTH LIMIT EXCEEDED") && !translatedText.toUpperCase().includes("INVALID")) {
                return translatedText;
            } else if (data.matches?.[0]?.translation) { 
                return data.matches[0].translation;
            } else {
                console.warn(`MyMemory tidak mengembalikan terjemahan valid (permintaan tunggal): ${detailError || JSON.stringify(data)}`);
                return textToTranslate; 
            }
        } catch (error) {
            console.error("Error saat menerjemahkan dengan MyMemory (permintaan tunggal):", error.message);
            return textToTranslate; 
        }
    } else {
        return await processTextInChunks(textToTranslate, sourceLang, targetLang, MAX_CHARS_MYMEMORY_FREE);
    }
}


app.post('/api/chat', async (req, res) => {
    console.log(`    [${new Date().toISOString()}] /api/chat POST handler. Body:`, req.body ? JSON.stringify(req.body).substring(0, 100) + '...' : 'No body');
    const { messages } = req.body;
    const ollamaModel = req.body.model || "tinyllama"; // Tetap gunakan tinyllama sebagai default untuk Ollama

    const OLLAMA_TIMEOUT = 30000; // 30 detik
    const HF_ABLITERATED_TIMEOUT = 30000; // 30 detik
    const HF_ZEPHYR_TIMEOUT = 25000; // 25 detik
    const HF_LLAMA3_TIMEOUT = 45000; // 45 detik 

    let rawReplyContent = "";
    let respondedBy = "";
    let audioProvider = "";
    let audioDataForFrontend = null;
    let primaryAIError = null;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required." });
    }

    // --- STRATEGI FALLBACK BARU ---
    // 1. Coba Llama-3-8B-Instruct-abliterated-v2 (Pilihan Utama HF)
    // 2. Fallback ke Zephyr
    // 3. Fallback ke Llama 3 asli
    // 4. Fallback terakhir ke Ollama

    if (HF_TOKEN) {
        try {
            // --- COBA HUGGING FACE (Llama-3-8B-Instruct-abliterated-v2) ---
            console.log("    Mencoba LLM Hugging Face (Llama-3-8B-Instruct-abliterated-v2)...");
            const HF_LLM_MODEL_ID_ABLITERATED_LLAMA3 = "cognitivecomputations/Llama-3-8B-Instruct-abliterated-v2";
            const HF_LLM_API_URL_ABLITERATED_LLAMA3 = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_ABLITERATED_LLAMA3}`;
            const abliteratedLlama3FormattedInputs = formatMessagesForLlama3Abliterated(messages);
            const hfAbliteratedLlama3Payload = { inputs: abliteratedLlama3FormattedInputs, parameters: { return_full_text: false, max_new_tokens: 450, temperature: 0.6, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
            
            console.log(`    Mengirim ke HF LLM (Llama-3-8B-Instruct-abliterated-v2) (Timeout: ${HF_ABLITERATED_TIMEOUT / 1000}s). Prompt (awal): "${abliteratedLlama3FormattedInputs.substring(0, 70)}..."`);
            const abliteratedLlama3Operation = fetch(HF_LLM_API_URL_ABLITERATED_LLAMA3, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfAbliteratedLlama3Payload) });
            
            const hfAbliteratedLlama3Response = await Promise.race([
                abliteratedLlama3Operation,
                createTimeoutPromise(HF_ABLITERATED_TIMEOUT, `Model HF (Llama-3-8B-Instruct-abliterated-v2) timeout (${HF_ABLITERATED_TIMEOUT / 1000}s).`)
            ]);
            const responseAbliteratedLlama3Text = await hfAbliteratedLlama3Response.text();
            
            if (!hfAbliteratedLlama3Response.ok) { 
                let e = `HF LLM (Llama-3-8B-Instruct-abliterated-v2) error: ${hfAbliteratedLlama3Response.status} - ${responseAbliteratedLlama3Text}`; 
                try { e = JSON.parse(responseAbliteratedLlama3Text).error || (Array.isArray(JSON.parse(responseAbliteratedLlama3Text).errors) ? JSON.parse(responseAbliteratedLlama3Text).errors.join(', ') : e); } catch (_) { } 
                throw new Error(e); 
            }
            
            const hfAbliteratedLlama3Data = JSON.parse(responseAbliteratedLlama3Text);
            if (Array.isArray(hfAbliteratedLlama3Data) && hfAbliteratedLlama3Data[0]?.generated_text) {
                rawReplyContent = hfAbliteratedLlama3Data[0].generated_text.trim();
                respondedBy = `HF (Llama-3-8B-Instruct-abliterated-v2)`;
                console.log("    Respons dari HF LLM (Llama-3-8B-Instruct-abliterated-v2):", rawReplyContent.substring(0, 70) + "...");
                primaryAIError = null; // Reset error jika berhasil
            } else { throw new Error(`Struktur respons HF LLM (Llama-3-8B-Instruct-abliterated-v2) tidak dikenal.`); }

        } catch (abliteratedLlama3Error) {
            console.error("    Gagal dari HF LLM (Llama-3-8B-Instruct-abliterated-v2):", abliteratedLlama3Error.message);
            primaryAIError = abliteratedLlama3Error;

            // --- FALLBACK KE HUGGING FACE (Zephyr) ---
            console.log("    Abliterated Llama 3 gagal, mencoba fallback LLM ke Hugging Face (Zephyr)...");
            try {
                const HF_LLM_MODEL_ID_ZEPHYR = "HuggingFaceH4/zephyr-7b-beta";
                const HF_LLM_API_URL_ZEPHYR = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_ZEPHYR}`;
                const zephyrFormattedPrompt = formatMessagesForZephyr(messages);
                const hfZephyrPayload = { inputs: zephyrFormattedPrompt, parameters: { return_full_text: false, max_new_tokens: 350, temperature: 0.7, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
                console.log(`    Mengirim ke HF LLM (Zephyr) (Timeout: ${HF_ZEPHYR_TIMEOUT / 1000}s). Prompt (awal): "${zephyrFormattedPrompt.substring(0, 70)}..."`);
                const zephyrOperation = fetch(HF_LLM_API_URL_ZEPHYR, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfZephyrPayload) });
                const hfZephyrResponse = await Promise.race([
                    zephyrOperation,
                    createTimeoutPromise(HF_ZEPHYR_TIMEOUT, `Model HF (Zephyr) timeout (${HF_ZEPHYR_TIMEOUT / 1000}s).`)
                ]);
                const responseZephyrText = await hfZephyrResponse.text();
                if (!hfZephyrResponse.ok) { let e = `HF LLM (Zephyr) error: ${hfZephyrResponse.status} - ${responseZephyrText}`; try { e = JSON.parse(responseZephyrText).error || (Array.isArray(JSON.parse(responseZephyrText).errors) ? JSON.parse(responseZephyrText).errors.join(', ') : e); } catch (_) { } throw new Error(e); }
                const hfZephyrData = JSON.parse(responseZephyrText);
                if (Array.isArray(hfZephyrData) && hfZephyrData[0]?.generated_text) {
                    rawReplyContent = hfZephyrData[0].generated_text.trim();
                    respondedBy = `HF (Zephyr)`;
                    console.log("    Respons dari HF LLM (Zephyr):", rawReplyContent.substring(0, 70) + "...");
                    primaryAIError = null;
                } else { throw new Error(`Struktur respons HF LLM (Zephyr) tidak dikenal.`); }
            } catch (zephyrError) {
                console.error("    Gagal dari HF LLM (Zephyr):", zephyrError.message);
                primaryAIError = zephyrError;

                // --- FALLBACK KE HUGGING FACE (Llama 3) ---
                console.log("    Zephyr gagal, mencoba fallback LLM ke Hugging Face (Llama 3)...");
                try {
                    const HF_LLM_MODEL_ID_LLAMA3 = "meta-llama/Llama-3-8B-Instruct";
                    const HF_LLM_API_URL_LLAMA3 = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_LLAMA3}`;
                    const llama3FormattedInputs = formatMessagesForLlama3(messages);
                    const hfLlama3Payload = { inputs: llama3FormattedInputs, parameters: { return_full_text: false, max_new_tokens: 450, temperature: 0.6, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
                    console.log(`    Mengirim ke HF LLM (Llama 3) (Timeout: ${HF_LLAMA3_TIMEOUT / 1000}s). Prompt (awal): "${llama3FormattedInputs.substring(0, 70)}..."`);
                    const llama3Operation = fetch(HF_LLM_API_URL_LLAMA3, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfLlama3Payload) });
                    const hfLlama3Response = await Promise.race([
                        llama3Operation,
                        createTimeoutPromise(HF_LLAMA3_TIMEOUT, `Model HF (Llama 3) timeout (${HF_LLAMA3_TIMEOUT / 1000}s).`)
                    ]);
                    const responseLlama3Text = await hfLlama3Response.text();
                    if (!hfLlama3Response.ok) { let e = `HF LLM (Llama 3) error: ${hfLlama3Response.status} - ${responseLlama3Text}`; try { e = JSON.parse(responseLlama3Text).error || (Array.isArray(JSON.parse(responseLlama3Text).errors) ? JSON.parse(responseLlama3Text).errors.join(', ') : e); } catch (_) { } throw new Error(e); }
                    const hfLlama3Data = JSON.parse(responseLlama3Text);
                    if (Array.isArray(hfLlama3Data) && hfLlama3Data[0]?.generated_text) {
                        rawReplyContent = hfLlama3Data[0].generated_text.trim();
                        respondedBy = `HF (Llama 3)`;
                        console.log("    Respons dari HF LLM (Llama 3):", rawReplyContent.substring(0, 70) + "...");
                        primaryAIError = null;
                    } else { throw new Error(`Struktur respons HF LLM (Llama 3) tidak dikenal.`); }
                } catch (llama3Error) {
                    console.error("    Gagal dari HF LLM (Llama 3) juga:", llama3Error.message);
                    primaryAIError = llama3Error;
                }
            }
        }
    }

    // --- FALLBACK TERAKHIR KE OLLAMA (JIKA SEMUA HF GAGAL ATAU HF_TOKEN TIDAK ADA) ---
    if (!rawReplyContent && (!HF_TOKEN || primaryAIError)) { // Hanya coba Ollama jika belum ada respons dari HF atau HF_TOKEN tidak ada
        try {
            if (!ollama || typeof ollama.chat !== 'function') { throw new Error("Ollama service not ready."); }
            console.log(`    Semua model HF gagal atau tidak tersedia. Mencoba Ollama: ${ollamaModel} (Timeout: ${OLLAMA_TIMEOUT / 1000}s)...`);
            const ollamaChatMessages = messages.map(m => ({ role: m.role, content: m.content }));
            const ollamaOperation = ollama.chat({ model: ollamaModel, messages: ollamaChatMessages, stream: false });
            const ollamaResponse = await Promise.race([
                ollamaOperation,
                createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${ollamaModel}) timeout.`)
            ]);
            if (ollamaResponse?.message?.content) {
                rawReplyContent = ollamaResponse.message.content;
                respondedBy = `Ollama (${ollamaModel})`;
                console.log("    Respons teks dari Ollama:", rawReplyContent.substring(0, 70) + "...");
                primaryAIError = null; // Reset error jika Ollama berhasil
            } else { throw new Error("Struktur respons tidak valid dari Ollama."); }
        } catch (ollamaFinalError) {
            console.error(`    Gagal dari Ollama (${ollamaModel}) sebagai fallback terakhir: ${ollamaFinalError.message}`);
            primaryAIError = ollamaFinalError; // Simpan error terakhir
        }
    }

    let textForProcessing = "";
    if (rawReplyContent) { textForProcessing = rawReplyContent; }
    else if (primaryAIError) { textForProcessing = `Maaf, terjadi masalah dengan AI: ${primaryAIError.message}`; if (respondedBy === "") respondedBy = `Sistem Error (Ollama: ${ollamaModel})`; }
    else { textForProcessing = "Maaf, terjadi kesalahan internal."; if (respondedBy === "") respondedBy = "Sistem Error"; }

    // Untuk saat ini, kita biarkan terjemahan tetap berjalan untuk keamanan,
    // sampai ada konfirmasi bahwa model selalu menjawab dalam Bahasa Indonesia.
    const finalReplyContent = await translateTextWithMyMemory(textForProcessing, 'en', 'id');

    if (finalReplyContent && HF_TOKEN) {
        try {
            console.log(`    Mencoba Gradio TTS: "${finalReplyContent.substring(0, 50)}..."`);
            const { Client } = await import('@gradio/client'); 
            const gradioClient = await Client.connect("NihalGazi/Text-To-Speech-Unlimited", { hf_token: HF_TOKEN });
            const ttsResult = await gradioClient.predict("/text_to_speech_app", {
                prompt: finalReplyContent, voice: "alloy", emotion: "neutral", use_random_seed: true,
                specific_seed: Math.floor(Math.random() * 100000),
            });
            if (ttsResult?.data?.[0]) {
                const audioInfo = ttsResult.data[0];
                if (audioInfo.url || (audioInfo.data && audioInfo.name) || (audioInfo.path && audioInfo.is_file)) {
                    audioDataForFrontend = audioInfo;
                    audioProvider = "NihalGazi/TTS";
                    console.log("    Audio Gradio didapatkan.");
                } else { console.warn("    Gradio data[0] tidak ada 'url'/'data+name'/'path(file)' valid:", audioInfo); }
            } else { console.warn("    Gradio TTS tidak mengembalikan data audio valid.", ttsResult?.data); }
        } catch (gradioError) { console.error("    Error Gradio TTS:", gradioError); }
    }

    let providerInfo = respondedBy;
    if (audioProvider) { providerInfo += ` + Suara: ${audioProvider}`; }
    console.log(`    [${new Date().toISOString()}] Mengirim respons untuk /api/chat:`, { role: "assistant", content: finalReplyContent.substring(0,50)+'...', provider: providerInfo, audioData: audioDataForFrontend ? 'Ada data audio' : 'Tidak ada data audio' });
    res.json({ reply: { role: "assistant", content: finalReplyContent, provider: providerInfo, audioData: audioDataForFrontend } });
});

app.get('/', (req, res) => { res.send('Chat backend siap!'); });

app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Terjadi error tidak tertangani: ${err.message}`);
    console.error(err.stack);
    if (!res.headersSent) { 
        res.status(500).send('Terjadi kesalahan pada server!');
    }
});

app.listen(port, '0.0.0.0', () => { console.log(`Backend listening di port ${port}`); });