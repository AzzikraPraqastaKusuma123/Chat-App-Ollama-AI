// backend/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama'); // Nama variabel diubah untuk kejelasan
// const { Client } = require("@gradio/client"); // Akan diimpor dinamis

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN;
const ollama = ollamaImport.default; // Menggunakan instance ollama

if (!ollama || typeof ollama.chat !== 'function') {
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar.");
} else {
    console.log("Pustaka Ollama terdeteksi dan siap digunakan saat startup.");
}

function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms));
}

// !!! WAJIB VERIFIKASI TEMPLATE INI DENGAN DOKUMENTASI ZEPHYR-7B-BETA DI HUGGING FACE HUB !!!
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

// !!! WAJIB VERIFIKASI TEMPLATE INI DENGAN DOKUMENTASI LLAMA-3-8B-INSTRUCT DI HUGGING FACE HUB !!!
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

async function processTextInChunks(text, sourceLang, targetLang, maxChunkLength) {
    // ... (Fungsi ini tetap sama seperti yang Anda berikan sebelumnya)
    const translatedParts = [];
    let remainingText = text;
    console.log(`Menerjemahkan teks panjang (${text.length} chars) dalam beberapa bagian...`);

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
                console.warn(`MyMemory API error untuk bagian: ${response.status} ${response.statusText}. Bagian asli dipertahankan.`);
                translatedParts.push(chunkToSend);
                continue;
            }
            const data = await response.json();
            const translatedChunk = data.responseData?.translatedText;
            const detailError = data.responseData?.responseDetails || data.responseDetails;

            if (translatedChunk && typeof translatedChunk === 'string' && !translatedChunk.toUpperCase().includes("QUERY LENGTH LIMIT EXCEEDED") && !translatedChunk.toUpperCase().includes("INVALID")) {
                translatedParts.push(translatedChunk);
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
    console.log("Semua bagian selesai diproses.");
    return translatedParts.join(" ").trim();
}

async function translateTextWithMyMemory(textToTranslate, sourceLang = 'en', targetLang = 'id') {
    // ... (Fungsi ini tetap sama seperti yang Anda berikan sebelumnya)
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
    const { messages } = req.body;
    // Model Ollama untuk fallback sekarang di-hardcode ke tinyllama
    const ollamaFallbackModel = "tinyllama"; 

    const OLLAMA_TIMEOUT = 10000; // Timeout Ollama 10 detik
    const HF_ZEPHYR_TIMEOUT = 25000; // Timeout Zephyr 25 detik
    const HF_LLAMA3_TIMEOUT = 45000;  // Timeout Llama 3 45 detik

    let rawReplyContent = "";
    let respondedBy = "";
    let audioProvider = "";
    let audioDataForFrontend = null;
    let lastError = null; // Menyimpan error terakhir jika semua gagal
    let attemptSuccessful = false;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required." });
    }

    // --- URUTAN BARU MODEL ---

    // 1. Coba meta-llama/Llama-3-8B-Instruct (Hugging Face)
    if (HF_TOKEN && !attemptSuccessful) {
        try {
            const HF_LLM_MODEL_ID_LLAMA3 = "meta-llama/Llama-3-8B-Instruct";
            const HF_LLM_API_URL_LLAMA3 = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_LLAMA3}`;
            const llama3FormattedInputs = formatMessagesForLlama3(messages);
            // Sesuaikan payload jika perlu, parameter yang ada sudah cukup baik
            const hfLlama3Payload = { inputs: llama3FormattedInputs, parameters: { return_full_text: false, max_new_tokens: 450, temperature: 0.6, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
            
            console.log(`Mencoba model HF (Llama 3) (Timeout: ${HF_LLAMA3_TIMEOUT / 1000}s). Prompt (awal): "${llama3FormattedInputs.substring(0, 70)}..."`);
            const llama3Operation = fetch(HF_LLM_API_URL_LLAMA3, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfLlama3Payload) });
            const hfLlama3Response = await Promise.race([
                llama3Operation,
                createTimeoutPromise(HF_LLAMA3_TIMEOUT, `Model HF (Llama 3) timeout (${HF_LLAMA3_TIMEOUT / 1000}s).`)
            ]);
            const responseLlama3Text = await hfLlama3Response.text();

            if (!hfLlama3Response.ok) { 
                let e = `HF LLM (Llama 3) error: ${hfLlama3Response.status} - ${responseLlama3Text}`; 
                try { e = JSON.parse(responseLlama3Text).error || (Array.isArray(JSON.parse(responseLlama3Text).errors) ? JSON.parse(responseLlama3Text).errors.join(', ') : e); } catch (_) { } 
                throw new Error(e); 
            }
            const hfLlama3Data = JSON.parse(responseLlama3Text);

            if (Array.isArray(hfLlama3Data) && hfLlama3Data[0]?.generated_text) {
                rawReplyContent = hfLlama3Data[0].generated_text.trim();
                respondedBy = `HF (Llama 3)`;
                console.log("Respons dari HF LLM (Llama 3):", rawReplyContent.substring(0, 70) + "...");
                attemptSuccessful = true;
                lastError = null;
            } else { 
                throw new Error(`Struktur respons HF LLM (Llama 3) tidak dikenal.`); 
            }
        } catch (llama3Error) {
            console.warn(`Gagal dari HF (Llama 3): ${llama3Error.message}`);
            lastError = llama3Error;
        }
    } else if (!HF_TOKEN) {
        console.log("HF_TOKEN tidak tersedia, melewati percobaan model Llama 3.");
        if (!lastError) lastError = new Error("HF_TOKEN tidak tersedia untuk model Llama 3.");
    }

    // 2. Coba HuggingFaceH4/zephyr-7b-beta (Hugging Face) - jika Llama 3 gagal
    if (HF_TOKEN && !attemptSuccessful) {
        try {
            console.log("Llama 3 gagal atau dilewati, mencoba fallback ke Hugging Face (Zephyr)...");
            const HF_LLM_MODEL_ID_ZEPHYR = "HuggingFaceH4/zephyr-7b-beta";
            const HF_LLM_API_URL_ZEPHYR = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_ZEPHYR}`;
            const zephyrFormattedPrompt = formatMessagesForZephyr(messages);
            // Sesuaikan payload jika perlu, parameter yang ada sudah cukup baik
            const hfZephyrPayload = { inputs: zephyrFormattedPrompt, parameters: { return_full_text: false, max_new_tokens: 350, temperature: 0.7, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
            
            console.log(`Mengirim ke HF LLM (Zephyr) (Timeout: ${HF_ZEPHYR_TIMEOUT / 1000}s). Prompt (awal): "${zephyrFormattedPrompt.substring(0, 70)}..."`);
            const zephyrOperation = fetch(HF_LLM_API_URL_ZEPHYR, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfZephyrPayload) });
            const hfZephyrResponse = await Promise.race([
                zephyrOperation,
                createTimeoutPromise(HF_ZEPHYR_TIMEOUT, `Model HF (Zephyr) timeout (${HF_ZEPHYR_TIMEOUT / 1000}s).`)
            ]);
            const responseZephyrText = await hfZephyrResponse.text();

            if (!hfZephyrResponse.ok) { 
                let e = `HF LLM (Zephyr) error: ${hfZephyrResponse.status} - ${responseZephyrText}`; 
                try { e = JSON.parse(responseZephyrText).error || (Array.isArray(JSON.parse(responseZephyrText).errors) ? JSON.parse(responseZephyrText).errors.join(', ') : e); } catch (_) { } 
                throw new Error(e); 
            }
            const hfZephyrData = JSON.parse(responseZephyrText);

            if (Array.isArray(hfZephyrData) && hfZephyrData[0]?.generated_text) {
                rawReplyContent = hfZephyrData[0].generated_text.trim();
                respondedBy = `HF (Zephyr)`;
                console.log("Respons dari HF LLM (Zephyr):", rawReplyContent.substring(0, 70) + "...");
                attemptSuccessful = true;
                lastError = null;
            } else { 
                throw new Error(`Struktur respons HF LLM (Zephyr) tidak dikenal.`); 
            }
        } catch (zephyrError) {
            console.warn(`Gagal dari HF (Zephyr): ${zephyrError.message}`);
            lastError = zephyrError; // Timpa error sebelumnya jika Llama 3 juga gagal
        }
    } else if (!HF_TOKEN && !attemptSuccessful) { // Jika Llama 3 dilewati karena token, Zephyr juga
        console.log("HF_TOKEN tidak tersedia, melewati percobaan model Zephyr.");
        if (!lastError) lastError = new Error("HF_TOKEN tidak tersedia untuk model Zephyr.");
    }

    // 3. Coba tinyllama (Ollama) - jika semua model HF gagal atau HF_TOKEN tidak ada
    if (!attemptSuccessful) {
        try {
            if (!ollama || typeof ollama.chat !== 'function') {
                throw new Error("Layanan Ollama tidak siap untuk fallback.");
            }
            console.log("Model HF gagal atau dilewati, mencoba fallback ke Ollama (tinyllama)...");
            const ollamaChatMessages = messages.map(m => ({ role: m.role, content: m.content }));
            const ollamaOperation = ollama.chat({ model: ollamaFallbackModel, messages: ollamaChatMessages, stream: false });
            const ollamaResponse = await Promise.race([
                ollamaOperation,
                createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${ollamaFallbackModel}) timeout.`)
            ]);

            if (ollamaResponse?.message?.content) {
                rawReplyContent = ollamaResponse.message.content;
                respondedBy = `Ollama (${ollamaFallbackModel})`;
                console.log("Respons teks dari Ollama:", rawReplyContent.substring(0, 70) + "...");
                attemptSuccessful = true;
                lastError = null;
            } else {
                throw new Error("Struktur respons tidak valid dari Ollama.");
            }
        } catch (ollamaError) {
            console.warn(`Gagal dari Ollama (${ollamaFallbackModel}): ${ollamaError.message}`);
            lastError = ollamaError; // Ini adalah error terakhir jika semua gagal
        }
    }

    // Penentuan teks final untuk diproses (terjemahan & TTS)
    let textForProcessing = "";
    if (attemptSuccessful && rawReplyContent) {
        textForProcessing = rawReplyContent;
    } else if (lastError) {
        textForProcessing = `Maaf, terjadi masalah dengan AI: ${lastError.message}`;
        if (respondedBy === "") respondedBy = `Sistem Error (Semua model gagal: ${lastError.message.substring(0,50)}...)`;
    } else {
        // Kasus ini seharusnya tidak terjadi jika lastError selalu diisi saat gagal
        textForProcessing = "Maaf, terjadi kesalahan internal atau tidak ada model AI yang dapat merespons.";
        if (respondedBy === "") respondedBy = "Sistem Error (Tidak diketahui)";
    }

    const finalReplyContent = await translateTextWithMyMemory(textForProcessing, 'en', 'id');

    // Logika TTS (Gradio) tetap sama
    if (finalReplyContent && HF_TOKEN) { // TTS tetap butuh HF_TOKEN untuk Gradio
        try {
            console.log(`Mencoba Gradio TTS: "${finalReplyContent.substring(0, 50)}..."`);
            const { Client } = await import('@gradio/client'); // Impor dinamis
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
                    console.log("Audio Gradio didapatkan.");
                } else { console.warn("Gradio data[0] tidak ada 'url'/'data+name'/'path(file)' valid:", audioInfo); }
            } else { console.warn("Gradio TTS tidak mengembalikan data audio valid.", ttsResult?.data); }
        } catch (gradioError) { console.error("Error Gradio TTS:", gradioError); }
    }

    let providerInfo = respondedBy;
    if (audioProvider) { providerInfo += ` + Suara: ${audioProvider}`; }
    res.json({ reply: { role: "assistant", content: finalReplyContent, provider: providerInfo, audioData: audioDataForFrontend } });
});

app.get('/', (req, res) => { res.send('Chat backend siap!'); });
app.listen(port, '0.0.0.0', () => { console.log(`Backend listening di port ${port}`); });