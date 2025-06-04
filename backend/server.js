// backend/server.js
require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN; 
const ollama = ollamaImport.default;

// --- Konfigurasi Model Ollama ---
// Pastikan nama model ini sesuai dengan yang sudah Anda 'ollama pull'
const OLLAMA_DEFAULT_MODEL = "phi3:mini"; 
const OLLAMA_TIMEOUT = 300000; // Timeout Ollama 5 menit

if (!ollama || typeof ollama.chat !== 'function') {
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar. Ollama tidak akan tersedia.");
} else {
    console.log("Pustaka Ollama terdeteksi dan siap digunakan saat startup.");
}

function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms));
}

// WAJIB VERIFIKASI TEMPLATE INI DENGAN DOKUMENTASI ZEPHYR-7B-BETA DI HUGGING FACE HUB
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

// WAJIB VERIFIKASI TEMPLATE INI DENGAN DOKUMENTASI LLAMA-3-8B-INSTRUCT DI HUGGING FACE HUB
// Ini juga berlaku untuk unsloth/llama-3-8b-Instruct karena biasanya mengikuti template asli Llama 3
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

// Template untuk Mistral-8x7B-Instruct-v0.1
// Format: <s>[INST] User Message 1 [/INST] Assistant Response 1</s>[INST] User Message 2 [/INST]
function formatMessagesForMixtral(messagesArray, systemMessage = "Anda adalah asisten AI yang membantu dan ramah. Jawablah dengan jelas dalam Bahasa Indonesia.") {
    const relevantMessages = messagesArray.slice(-5); // Ambil 5 pesan terakhir untuk konteks
    let promptString = "<s>"; // Awal string prompt

    // Tambahkan system message sebagai instruksi awal dalam tag [INST]
    promptString += `[INST] ${systemMessage} [/INST]`;

    relevantMessages.forEach((msg, index) => {
        if (msg.role === 'user') {
            promptString += `[INST] ${msg.content} [/INST]`;
        } else if (msg.role === 'assistant') {
            // Jawaban asisten diikuti dengan </s>, lalu jika ada user message lagi, mulai [INST] baru
            promptString += ` ${msg.content}</s>`; 
        }
    });

    return promptString;
}


async function translateTextWithMyMemory(textToTranslate, sourceLang = 'en', targetLang = 'id') {
    if (!textToTranslate || typeof textToTranslate !== 'string' || textToTranslate.trim() === '') return textToTranslate; 
    try {
        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}`;
        const response = await fetch(myMemoryUrl);
        if (!response.ok) throw new Error(`MyMemory API error: ${response.status} ${response.statusText}`);
        const data = await response.json();
        if (data.responseData?.translatedText && !data.responseData.translatedText.toUpperCase().includes("QUERY") && !data.responseData.translatedText.toUpperCase().includes("INVALID")) {
            return data.responseData.translatedText;
        } else if (data.matches?.[0]?.translation) {
            return data.matches[0].translation;
        } else {
            console.warn("MyMemory tidak mengembalikan terjemahan valid:", data.responseData?.responseDetails || data);
            return textToTranslate;
        }
    } catch (error) {
        console.error("Error saat menerjemahkan dengan MyMemory:", error.message);
        return textToTranslate;
    }
}

// Fungsi untuk melakukan pemanasan (warm-up) model Ollama
async function warmUpOllamaModel(modelName) {
    if (!ollama || typeof ollama.chat !== 'function') {
        console.warn("Ollama tidak siap untuk warm-up.");
        return;
    }
    console.log(`Melakukan pemanasan model Ollama: ${modelName}...`);
    const warmUpPrompt = "Sebutkan satu kata untuk pemanasan."; // Prompt singkat
    try {
        const warmUpOperation = ollama.chat({ 
            model: modelName, 
            messages: [{ role: 'user', content: warmUpPrompt }], 
            stream: false 
        });
        const warmUpResponse = await Promise.race([
            warmUpOperation,
            createTimeoutPromise(OLLAMA_TIMEOUT, `Warm-up Ollama (${modelName}) timeout.`)
        ]);

        if (warmUpResponse?.message?.content) {
            console.log(`Pemanasan Ollama (${modelName}) berhasil! Respons: "${warmUpResponse.message.content.substring(0, 50)}..."`);
        } else {
            console.warn(`Pemanasan Ollama (${modelName}) tidak mengembalikan respons valid.`);
        }
    } catch (error) {
        console.error(`Gagal melakukan pemanasan Ollama (${modelName}): ${error.message}`);
    }
}


app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    
    // Timeout untuk model Hugging Face
    const HF_ZEPHYR_TIMEOUT = 300000; // Timeout Zephyr 5 menit
    const HF_UNSLOTH_LLAMA3_TIMEOUT = 300000; // Timeout Unsloth Llama 3 5 menit
    const HF_MIXTRAL_TIMEOUT = 300000; // Timeout Mixtral 5 menit
    
    let rawReplyContent = ""; 
    let respondedBy = ""; 
    let audioProvider = ""; 
    let audioDataForFrontend = null; 
    let primaryAIError = null; // Menyimpan error dari model yang gagal

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required." });
    }
    
    // --- PRIORITAS 1: Ollama (phi3:mini) ---
    if (ollama && typeof ollama.chat === 'function') {
        console.log(`Mencoba model Ollama: ${OLLAMA_DEFAULT_MODEL} (Timeout: ${OLLAMA_TIMEOUT/1000}s)...`);
        try { 
            const ollamaChatMessages = messages.map(m => ({role: m.role, content: m.content}));
            const ollamaOperation = ollama.chat({ model: OLLAMA_DEFAULT_MODEL, messages: ollamaChatMessages, stream: false });
            const ollamaResponse = await Promise.race([
                ollamaOperation,
                createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${OLLAMA_DEFAULT_MODEL}) timeout.`)
            ]);
            if (ollamaResponse?.message?.content) {
                rawReplyContent = ollamaResponse.message.content;
                respondedBy = `Ollama (${OLLAMA_DEFAULT_MODEL})`;
                console.log("Respons teks dari Ollama:", rawReplyContent.substring(0,70)+"...");
                primaryAIError = null; // Reset error jika berhasil
            } else { throw new Error("Struktur respons tidak valid dari Ollama."); }
        } catch (ollamaError) {
            console.error(`Gagal dari Ollama (${OLLAMA_DEFAULT_MODEL}): ${ollamaError.message}`);
            primaryAIError = ollamaError; // Simpan error Ollama
        }
    } else {
        console.warn("Ollama tidak siap atau tidak diatur. Mencoba fallback ke Hugging Face.");
        primaryAIError = new Error("Ollama service not ready."); // Error awal jika Ollama tidak siap
    }

    // --- FALLBACK KE HUGGING FACE MODELS JIKA OLLAMA GAGAL ---
    if (!rawReplyContent && HF_TOKEN) { // Coba HF hanya jika Ollama gagal DAN HF_TOKEN ada
        console.log("Ollama gagal, mencoba fallback ke Hugging Face Models...");
        try { 
            // Coba Mixtral
            console.log(`Mencoba model Hugging Face (Mixtral-8x7B-Instruct-v0.1) (Timeout: ${HF_MIXTRAL_TIMEOUT/1000}s)...`);
            const HF_LLM_MODEL_ID_MIXTRAL = "mistralai/Mixtral-8x7B-Instruct-v0.1"; 
            const HF_LLM_API_URL_MIXTRAL = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_MIXTRAL}`;
            const mixtralFormattedPrompt = formatMessagesForMixtral(messages); 
            const hfMixtralPayload = { inputs: mixtralFormattedPrompt, parameters: { return_full_text: false, max_new_tokens: 500, temperature: 0.7, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
            const mixtralOperation = fetch(HF_LLM_API_URL_MIXTRAL, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfMixtralPayload) });
            const hfMixtralResponse = await Promise.race([
                mixtralOperation,
                createTimeoutPromise(HF_MIXTRAL_TIMEOUT, `Model HF (Mixtral) timeout (${HF_MIXTRAL_TIMEOUT/1000}s).`)
            ]);
            const responseMixtralText = await hfMixtralResponse.text();
            if (!hfMixtralResponse.ok) { 
                let e = `HF LLM (Mixtral) error: ${hfMixtralResponse.status} - ${responseMixtralText}`; 
                try {e = JSON.parse(responseMixtralText).error||(Array.isArray(JSON.parse(responseMixtralText).errors) ? JSON.parse(responseMixtralText).errors.join(', ') : e);}catch(_){} 
                throw new Error(e); 
            }
            const hfMixtralData = JSON.parse(responseMixtralText); 
            if (Array.isArray(hfMixtralData) && hfMixtralData[0]?.generated_text) {
                rawReplyContent = hfMixtralData[0].generated_text.trim(); 
                respondedBy = `HF (Mixtral)`;
                console.log("Respons dari HF LLM (Mixtral):", rawReplyContent.substring(0,70)+"...");
                primaryAIError = null; 
            } else { throw new Error(`Struktur respons HF LLM (Mixtral) tidak dikenal.`);}
        } catch (mixtralError) {
            console.warn(`Gagal dari Hugging Face (Mixtral): ${mixtralError.message}`);
            primaryAIError = mixtralError; 

            // Coba Zephyr
            console.log("Mixtral gagal, mencoba fallback LLM ke Hugging Face (Zephyr)...");
            try { 
                const HF_LLM_MODEL_ID_ZEPHYR = "HuggingFaceH4/zephyr-7b-beta"; 
                const HF_LLM_API_URL_ZEPHYR = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_ZEPHYR}`;
                const zephyrFormattedPrompt = formatMessagesForZephyr(messages); 
                const hfZephyrPayload = { inputs: zephyrFormattedPrompt, parameters: { return_full_text: false, max_new_tokens: 350, temperature: 0.7, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
                const zephyrOperation = fetch(HF_LLM_API_URL_ZEPHYR, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfZephyrPayload) });
                const hfZephyrResponse = await Promise.race([
                    zephyrOperation,
                    createTimeoutPromise(HF_ZEPHYR_TIMEOUT, `Model HF (Zephyr) timeout (${HF_ZEPHYR_TIMEOUT/1000}s).`)
                ]);
                const responseZephyrText = await hfZephyrResponse.text();
                if (!hfZephyrResponse.ok) { let e = `HF LLM (Zephyr) error: ${hfZephyrResponse.status} - ${responseZephyrText}`; try {e = JSON.parse(responseZephyrText).error||(Array.isArray(JSON.parse(responseZephyrText).errors) ? JSON.parse(responseZephyrText).errors.join(', ') : e);}catch(_){} throw new Error(e); }
                const hfZephyrData = JSON.parse(responseZephyrText); 
                if (Array.isArray(hfZephyrData) && hfZephyrData[0]?.generated_text) {
                    rawReplyContent = hfZephyrData[0].generated_text.trim(); 
                    respondedBy = `HF (Zephyr)`;
                    console.log("Respons dari HF LLM (Zephyr):", rawReplyContent.substring(0,70)+"...");
                    primaryAIError = null; 
                } else { throw new Error(`Struktur respons HF LLM (Zephyr) tidak dikenal.`);}
            } catch (zephyrErrorFallback) {
                console.error("Gagal dari HF LLM (Zephyr):", zephyrErrorFallback.message);
                primaryAIError = zephyrErrorFallback; 

                // Coba Unsloth Llama 3
                console.log("Zephyr gagal, mencoba fallback LLM ke Hugging Face (Unsloth Llama 3)...");
                try { 
                    const HF_LLM_MODEL_ID_UNSLOTH_LLAMA3 = "unsloth/llama-3-8b-Instruct"; 
                    const HF_LLM_API_URL_UNSLOTH_LLAMA3 = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_UNSLOTH_LLAMA3}`;
                    const unslothLlama3FormattedInputs = formatMessagesForLlama3(messages); 
                    const hfUnslothLlama3Payload = { inputs: unslothLlama3FormattedInputs, parameters: { return_full_text: false, max_new_tokens: 450, temperature: 0.6, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
                    const unslothLlama3Operation = fetch(HF_LLM_API_URL_UNSLOTH_LLAMA3, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfUnslothLlama3Payload) });
                    const hfUnslothLlama3Response = await Promise.race([
                        unslothLlama3Operation,
                        createTimeoutPromise(HF_UNSLOTH_LLAMA3_TIMEOUT, `Model HF (Unsloth Llama 3) timeout (${HF_UNSLOTH_LLAMA3_TIMEOUT/1000}s).`)
                    ]);
                    const responseUnslothLlama3Text = await hfUnslothLlama3Response.text();
                    if (!hfUnslothLlama3Response.ok) { let e = `HF LLM (Unsloth Llama 3) error: ${hfUnslothLlama3Response.status} - ${responseUnslothLlama3Text}`; try {e = JSON.parse(responseUnslothLlama3Text).error||(Array.isArray(JSON.parse(responseUnslothLlama3Text).errors) ? JSON.parse(responseUnslothLlama3Text).errors.join(', ') : e);}catch(_){} throw new Error(e); }
                    const hfUnslothLlama3Data = JSON.parse(responseUnslothLlama3Text); 
                    if (Array.isArray(hfUnslothLlama3Data) && hfUnslothLlama3Data[0]?.generated_text) {
                        rawReplyContent = hfUnslothLlama3Data[0].generated_text.trim(); 
                        respondedBy = `HF (Unsloth Llama 3)`;
                        console.log("Respons dari HF LLM (Unsloth Llama 3):", rawReplyContent.substring(0,70)+"...");
                        primaryAIError = null; 
                    } else { throw new Error(`Struktur respons HF LLM (Unsloth Llama 3) tidak dikenal.`);}
                } catch (unslothLlama3ErrorFallback) {
                    console.error("Gagal dari HF LLM (Unsloth Llama 3):", unslothLlama3ErrorFallback.message);
                    primaryAIError = unslothLlama3ErrorFallback; 
                }
            }
        }
    } else if (!rawReplyContent && !HF_TOKEN) {
        console.warn("HF_TOKEN tidak ditemukan. Tidak dapat mencoba model Hugging Face. Hanya Ollama yang tersedia.");
        primaryAIError = new Error("HF_TOKEN tidak ditemukan, model Hugging Face tidak tersedia.");
    }
    // Jika tidak ada model yang berhasil, primaryAIError akan tetap ada

    let textForProcessing = "";
    if (rawReplyContent) { textForProcessing = rawReplyContent; } 
    else if (primaryAIError) { 
        textForProcessing = `Maaf, terjadi masalah dengan AI: ${primaryAIError.message}.`; 
        if (respondedBy === "") respondedBy = `Sistem Error (No LLM)`; 
    } 
    else { 
        textForProcessing = "Maaf, terjadi kesalahan internal."; 
        if (respondedBy === "") respondedBy = "Sistem Error"; 
    }

    const finalReplyContent = await translateTextWithMyMemory(textForProcessing, 'en', 'id');
    
    // Gradio TTS membutuhkan HF_TOKEN
    if (finalReplyContent && HF_TOKEN) { 
        try {
            console.log(`Mencoba Gradio TTS: "${finalReplyContent.substring(0, 50)}..."`);
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
                    console.log("Audio Gradio didapatkan.");
                } else { console.warn("Gradio data[0] tidak ada 'url'/'data+name'/'path(file)' valid:", audioInfo); }
            } else { console.warn("Gradio TTS tidak mengembalikan data audio valid.", ttsResult?.data); }
        } catch (gradioError) { console.error("Error Gradio TTS:", gradioError); }
    }
    
    let providerInfo = respondedBy;
    if(audioProvider) { providerInfo += ` + Suara: ${audioProvider}`; }
    res.json({ reply: { role: "assistant", content: finalReplyContent, provider: providerInfo, audioData: audioDataForFrontend } });
});

app.get('/', (req, res) => { res.send('Chat backend siap!'); });

// --- PANGGIL FUNGSI PEMANASAN SETELAH SERVER MULAI ---
app.listen(port, '0.0.0.0', () => { 
    console.log(`Backend listening di port ${port}`); 
    warmUpOllamaModel(OLLAMA_DEFAULT_MODEL); // Panggil fungsi pemanasan
});
