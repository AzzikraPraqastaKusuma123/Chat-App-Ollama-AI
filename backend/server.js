// backend/server.js
require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');
// const { Client } = require("@gradio/client"); // Akan diimpor dinamis jika digunakan

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

// !!! VERIFIKASI TEMPLATE INI DENGAN DOKUMENTASI ZEPHYR-7B-BETA !!!
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

// !!! VERIFIKASI TEMPLATE INI DENGAN DOKUMENTASI LLAMA-3-8B-INSTRUCT !!!
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

async function translateTextWithMyMemory(textToTranslate, sourceLang = 'en', targetLang = 'id') {
    if (!textToTranslate || typeof textToTranslate !== 'string' || textToTranslate.trim() === '') return textToTranslate; 
    try {
        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}`;
        // console.log(`Menerjemahkan teks: "${textToTranslate.substring(0, 50)}..."`); 
        const response = await fetch(myMemoryUrl);
        if (!response.ok) throw new Error(`MyMemory API error: ${response.status} ${response.statusText}`);
        const data = await response.json();
        if (data.responseData && data.responseData.translatedText && !data.responseData.translatedText.toUpperCase().includes("QUERY") && !data.responseData.translatedText.toUpperCase().includes("INVALID")) {
            // console.log("Teks berhasil diterjemahkan oleh MyMemory.");
            return data.responseData.translatedText;
        } else if (data.matches && Array.isArray(data.matches) && data.matches.length > 0 && data.matches[0].translation) {
            // console.log("Teks berhasil diterjemahkan (dari matches) oleh MyMemory.");
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

app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    const ollamaModelFromRequest = req.body.model;
    const ollamaModel = ollamaModelFromRequest || "tinyllama"; 
    const OLLAMA_TIMEOUT = 5000; // Timeout Ollama 5 detik
    
    let rawReplyContent = ""; 
    let respondedBy = ""; 
    let audioProvider = ""; 
    let audioDataForFrontend = null; 
    let primaryAIError = null;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required." });
    }
    
    try { 
        if (!ollama || typeof ollama.chat !== 'function') { throw new Error("Ollama service not ready."); }
        console.log(`Mencoba model Ollama: ${ollamaModel} (Timeout: ${OLLAMA_TIMEOUT/1000}s)...`);
        const ollamaChatMessages = messages.map(m => ({role: m.role, content: m.content}));
        const ollamaOperation = ollama.chat({ model: ollamaModel, messages: ollamaChatMessages, stream: false });
        const ollamaResponse = await Promise.race([
            ollamaOperation,
            createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${ollamaModel}) timeout.`)
        ]);
        if (ollamaResponse && ollamaResponse.message && typeof ollamaResponse.message.content === 'string') {
            rawReplyContent = ollamaResponse.message.content;
            respondedBy = `Ollama (${ollamaModel})`;
            console.log("Respons teks dari Ollama:", rawReplyContent.substring(0,70)+"...");
        } else { throw new Error("Struktur respons tidak valid dari Ollama."); }
    } catch (ollamaError) {
        console.warn(`Gagal dari Ollama (${ollamaModel}): ${ollamaError.message}`);
        primaryAIError = ollamaError; 
        
        if (HF_TOKEN) {
            console.log("Ollama gagal, mencoba fallback LLM ke Hugging Face (Zephyr)...");
            try { 
                const HF_LLM_MODEL_ID_ZEPHYR = "HuggingFaceH4/zephyr-7b-beta"; 
                const HF_LLM_API_URL_ZEPHYR = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_ZEPHYR}`;
                const zephyrFormattedPrompt = formatMessagesForZephyr(messages); 
                const hfZephyrPayload = { inputs: zephyrFormattedPrompt, parameters: { return_full_text: false, max_new_tokens: 350, temperature: 0.7, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
                console.log(`Mengirim ke HF LLM (Zephyr). Prompt (awal): "${zephyrFormattedPrompt.substring(0,70)}..."`);
                const hfZephyrResponse = await fetch(HF_LLM_API_URL_ZEPHYR, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfZephyrPayload) });
                const responseZephyrText = await hfZephyrResponse.text();
                if (!hfZephyrResponse.ok) { 
                    let e = `HF LLM (Zephyr) error: ${hfZephyrResponse.status} - ${responseZephyrText}`; try {e = JSON.parse(responseZephyrText).error||e;}catch(_){} throw new Error(e);
                }
                const hfZephyrData = JSON.parse(responseZephyrText); 
                if (Array.isArray(hfZephyrData) && hfZephyrData[0]?.generated_text) {
                    rawReplyContent = hfZephyrData[0].generated_text.trim(); 
                    respondedBy = `HF (Zephyr)`;
                    console.log("Respons dari HF LLM (Zephyr):", rawReplyContent.substring(0,70)+"...");
                    primaryAIError = null; 
                } else { throw new Error(`Struktur respons HF LLM (Zephyr) tidak dikenal.`);}
            } catch (zephyrError) {
                console.error("Gagal dari HF LLM (Zephyr):", zephyrError.message);
                console.log("Zephyr gagal, mencoba fallback LLM ke Hugging Face (Llama 3)...");
                try { 
                    const HF_LLM_MODEL_ID_LLAMA3 = "meta-llama/Llama-3-8B-Instruct"; 
                    const HF_LLM_API_URL_LLAMA3 = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_LLAMA3}`;
                    const llama3FormattedInputs = formatMessagesForLlama3(messages);
                    const hfLlama3Payload = { inputs: llama3FormattedInputs, parameters: { return_full_text: false, max_new_tokens: 450, temperature: 0.6, top_p: 0.9 }, options: { wait_for_model: true, use_cache: false } };
                    console.log(`Mengirim ke HF LLM (Llama 3). Prompt (awal): "${llama3FormattedInputs.substring(0,70)}..."`);
                    const hfLlama3Response = await fetch(HF_LLM_API_URL_LLAMA3, { method: "POST", headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(hfLlama3Payload) });
                    const responseLlama3Text = await hfLlama3Response.text();
                    if (!hfLlama3Response.ok) { 
                        let e = `HF LLM (Llama 3) error: ${hfLlama3Response.status} - ${responseLlama3Text}`; try {e = JSON.parse(responseLlama3Text).error||e;}catch(_){} throw new Error(e);
                    }
                    const hfLlama3Data = JSON.parse(responseLlama3Text); 
                    if (Array.isArray(hfLlama3Data) && hfLlama3Data[0]?.generated_text) {
                        rawReplyContent = hfLlama3Data[0].generated_text.trim(); 
                        respondedBy = `HF (Llama 3)`;
                        console.log("Respons dari HF LLM (Llama 3):", rawReplyContent.substring(0,70)+"...");
                        primaryAIError = null; 
                    } else { throw new Error(`Struktur respons HF LLM (Llama 3) tidak dikenal.`);}
                } catch (llama3Error) {
                    console.error("Gagal dari HF LLM (Llama 3) juga:", llama3Error.message);
                }
            }
        }
    }

    let textForProcessing = "";
    if (rawReplyContent) { textForProcessing = rawReplyContent; } 
    else if (primaryAIError) { textForProcessing = `Maaf, terjadi masalah dengan AI: ${primaryAIError.message}`; if (respondedBy === "") respondedBy = `Sistem Error (Ollama: ${ollamaModel})`; } 
    else { textForProcessing = "Maaf, terjadi kesalahan internal."; if (respondedBy === "") respondedBy = "Sistem Error"; }

    const finalReplyContent = await translateTextWithMyMemory(textForProcessing, 'en', 'id');
    
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
app.listen(port, '0.0.0.0', () => { console.log(`Backend listening di port ${port}`); });