// backend/server.js
require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');
const { Client } = require("@gradio/client"); 

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
        ollamaErrorOccurred = ollamaError; // Simpan error Ollama
        
        if (HF_TOKEN) { // Coba Fallback LLM ke Hugging Face (Zephyr)
            console.log("Mencoba fallback LLM ke Hugging Face Inference API (Zephyr)...");
            try {
                const HF_LLM_MODEL_ID = "HuggingFaceH4/zephyr-7b-beta"; 
                const HF_LLM_API_URL = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID}`;
                const zephyrFormattedPrompt = formatMessagesForZephyr(messages);
                const hfLLMPayload = {
                    inputs: zephyrFormattedPrompt,
                    parameters: { return_full_text: false, max_new_tokens: 350, temperature: 0.7, top_p: 0.9 },
                    options: { wait_for_model: true, use_cache: false }
                };
                console.log(`Mengirim permintaan ke Hugging Face LLM API (Model: ${HF_LLM_MODEL_ID}). Inputs (awal): "${zephyrFormattedPrompt.substring(0,150)}..."`);
                const hfLLMResponse = await fetch(HF_LLM_API_URL, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
                    body: JSON.stringify(hfLLMPayload)
                });
                const responseLLMText = await hfLLMResponse.text();
                if (!hfLLMResponse.ok) { 
                    let errorDetail = `HF LLM API error: ${hfLLMResponse.status} - ${responseLLMText}`;
                    try { const errorJson = JSON.parse(responseLLMText); errorDetail = errorJson.error || (Array.isArray(errorJson.errors) ? errorJson.errors.join(', ') : errorDetail); } catch (e) {}
                    throw new Error(errorDetail);
                }
                const hfLLMData = JSON.parse(responseLLMText); 
                if (Array.isArray(hfLLMData) && hfLLMData[0] && typeof hfLLMData[0].generated_text === 'string') {
                    rawReplyContent = hfLLMData[0].generated_text.trim(); // Dapat respons dari fallback LLM
                    respondedBy = `Hugging Face (${HF_LLM_MODEL_ID.split('/')[1] || HF_LLM_MODEL_ID})`;
                    console.log("Respons teks dari Hugging Face LLM:", rawReplyContent.substring(0,100)+"...");
                } else { throw new Error(`Struktur respons HF LLM tidak dikenal.`);}
            } catch (hfLlmError) {
                console.error("Gagal mendapatkan respons dari Hugging Face LLM juga:", hfLlmError.message);
                // Jika fallback LLM juga gagal, biarkan rawReplyContent kosong
            }
        }
    }

    // Jika tidak ada balasan teks sama sekali setelah mencoba Ollama (dan fallback LLM jika ada)
    if (!rawReplyContent) {
        let errorMessage = "Gagal mendapatkan respons dari semua sumber AI yang dikonfigurasi.";
        if (ollamaErrorOccurred) {
            errorMessage = `Ollama error: ${ollamaErrorOccurred.message}. ` + (HF_TOKEN ? "Upaya fallback juga gagal." : "Tidak ada fallback API Key.");
        }
        return res.status(500).json({ error: errorMessage });
    }

    // Terjemahan teks AI jika sudah didapatkan
    finalReplyContent = await translateTextWithMyMemory(rawReplyContent, 'en', 'id');
    if (finalReplyContent === rawReplyContent) {
        console.log("Terjemahan tidak mengubah teks atau gagal.");
    } else {
        console.log("Teks AI berhasil diterjemahkan ke Bahasa Indonesia.");
    }
    
    // Membuat Audio dengan Gradio Client untuk NihalGazi/Text-To-Speech-Unlimited
    if (finalReplyContent && HF_TOKEN) { 
        try {
            console.log(`Mencoba generate audio untuk teks: "${finalReplyContent.substring(0, 100)}..." menggunakan Gradio.`);
            const gradioClient = await Client.connect("NihalGazi/Text-To-Speech-Unlimited", { hf_token: HF_TOKEN });
            
            // !!! PENTING: SESUAIKAN PARAMETER 'voice' dan 'emotion' DI BAWAH INI !!!
            // Cari tahu opsi yang valid dari demo Gradio Space model ini.
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