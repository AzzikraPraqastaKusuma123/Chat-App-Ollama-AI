// backend/server.js
require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama');
// const { Client } = require("@gradio/client"); // Akan diimpor dinamis

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

// Fungsi untuk memformat pesan ke template Zephyr
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

// Fungsi untuk memformat pesan ke template Llama 3 Instruct
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
        console.log(`Menerjemahkan teks: "${textToTranslate.substring(0, 50)}..."`);
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
    let respondedBy = ""; 
    let audioProvider = ""; 
    let audioDataForFrontend = null; 
    let primaryAIError = null;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required." });
    }
    
    try { // Mencoba Ollama
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
        } else { throw new Error("Struktur respons tidak valid dari Ollama."); }
    } catch (ollamaError) {
        console.warn(`Gagal mendapatkan respons dari Ollama (${ollamaModel}): ${ollamaError.message}`);
        primaryAIError = ollamaError; 
        
        if (HF_TOKEN) {
            // --- Fallback 1: Mencoba Hugging Face LLM (Zephyr) ---
            console.log("Ollama gagal, mencoba fallback LLM ke Hugging Face (Zephyr)...");
            try {
                const HF_LLM_MODEL_ID_ZEPHYR = "HuggingFaceH4/zephyr-7b-beta"; 
                const HF_LLM_API_URL_ZEPHYR = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_ZEPHYR}`;
                const zephyrFormattedPrompt = formatMessagesForZephyr(messages); 
                const hfZephyrPayload = {
                    inputs: zephyrFormattedPrompt,
                    parameters: { return_full_text: false, max_new_tokens: 350, temperature: 0.7, top_p: 0.9 },
                    options: { wait_for_model: true, use_cache: false }
                };
                console.log(`Mengirim permintaan ke HF LLM API (Zephyr). Inputs (awal): "${zephyrFormattedPrompt.substring(0,150)}..."`);
                const hfZephyrResponse = await fetch(HF_LLM_API_URL_ZEPHYR, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
                    body: JSON.stringify(hfZephyrPayload)
                });
                const responseZephyrText = await hfZephyrResponse.text();
                if (!hfZephyrResponse.ok) { 
                    let errorDetail = `HF LLM API error (Zephyr): ${hfZephyrResponse.status} - ${responseZephyrText}`;
                    try { const errorJson = JSON.parse(responseZephyrText); errorDetail = errorJson.error || (Array.isArray(errorJson.errors) ? errorJson.errors.join(', ') : errorDetail); } catch (e) {}
                    throw new Error(errorDetail);
                }
                const hfZephyrData = JSON.parse(responseZephyrText); 
                if (Array.isArray(hfZephyrData) && hfZephyrData[0] && typeof hfZephyrData[0].generated_text === 'string') {
                    rawReplyContent = hfZephyrData[0].generated_text.trim(); 
                    respondedBy = `Hugging Face (Zephyr)`;
                    console.log("Respons teks dari Hugging Face LLM (Zephyr):", rawReplyContent.substring(0,100)+"...");
                    primaryAIError = null; 
                } else { throw new Error(`Struktur respons HF LLM (Zephyr) tidak dikenal.`);}
            } catch (zephyrError) {
                console.error("Gagal dari HF LLM (Zephyr):", zephyrError.message);
                // Jika Zephyr gagal, primaryAIError (dari Ollama) masih ada, kita akan coba Llama 3

                console.log("Zephyr gagal, mencoba fallback LLM ke Hugging Face (Llama 3)...");
                try { // Fallback 2: Llama 3
                    const HF_LLM_MODEL_ID_LLAMA3 = "meta-llama/Llama-3-8B-Instruct"; 
                    const HF_LLM_API_URL_LLAMA3 = `https://api-inference.huggingface.co/models/${HF_LLM_MODEL_ID_LLAMA3}`;
                    const llama3FormattedInputs = formatMessagesForLlama3(messages); // Gunakan fungsi format Llama 3
                    const hfLlama3Payload = {
                        inputs: llama3FormattedInputs,
                        parameters: { return_full_text: false, max_new_tokens: 450, temperature: 0.6, top_p: 0.9 },
                        options: { wait_for_model: true, use_cache: false }
                    };
                    console.log(`Mengirim permintaan ke HF LLM API (Llama 3). Inputs (awal): "${llama3FormattedInputs.substring(0,200)}..."`);
                    const hfLlama3Response = await fetch(HF_LLM_API_URL_LLAMA3, {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${HF_TOKEN}`, "Content-Type": "application/json" },
                        body: JSON.stringify(hfLlama3Payload)
                    });
                    const responseLlama3Text = await hfLlama3Response.text();
                    if (!hfLlama3Response.ok) { 
                        let errorDetail = `HF LLM API error (Llama 3): ${hfLlama3Response.status} - ${responseLlama3Text}`;
                        try { const errorJson = JSON.parse(responseLlama3Text); errorDetail = errorJson.error || (Array.isArray(errorJson.errors) ? errorJson.errors.join(', ') : errorDetail); } catch (e) {}
                        throw new Error(errorDetail);
                    }
                    const hfLlama3Data = JSON.parse(responseLlama3Text); 
                    if (Array.isArray(hfLlama3Data) && hfLlama3Data[0] && typeof hfLlama3Data[0].generated_text === 'string') {
                        rawReplyContent = hfLlama3Data[0].generated_text.trim(); 
                        respondedBy = `Hugging Face (Llama 3)`;
                        console.log("Respons teks dari Hugging Face LLM (Llama 3):", rawReplyContent.substring(0,100)+"...");
                        primaryAIError = null; 
                    } else { throw new Error(`Struktur respons HF LLM (Llama 3) tidak dikenal.`);}
                } catch (llama3Error) {
                    console.error("Gagal mendapatkan respons dari Hugging Face LLM (Llama 3) juga:", llama3Error.message);
                    // Jika Llama 3 juga gagal, primaryAIError (dari Ollama) akan tetap digunakan.
                }
            }
        } else {
            console.log("HF_TOKEN tidak tersedia, tidak melakukan fallback LLM ke Hugging Face.");
        }
    }

    // --- Tahap 2: Menentukan Teks Final untuk Diproses (Terjemahan & TTS) ---
    let textForProcessing = "";
    if (rawReplyContent) { 
        textForProcessing = rawReplyContent;
    } else if (primaryAIError) { 
        textForProcessing = `Maaf, terjadi masalah dengan AI: ${primaryAIError.message}`;
        if (respondedBy === "") respondedBy = `Sistem Error (Sumber: ${ollamaModel || 'Ollama'})`;
    } else { 
        textForProcessing = "Maaf, terjadi kesalahan internal yang tidak terduga dalam pemrosesan AI.";
        if (respondedBy === "") respondedBy = "Sistem Error (Umum)";
    }

    const finalReplyContent = await translateTextWithMyMemory(textForProcessing, 'en', 'id');
    if (finalReplyContent !== textForProcessing) {
        console.log("Teks AI berhasil diterjemahkan ke Bahasa Indonesia.");
    } else {
        console.log("Terjemahan tidak mengubah teks atau gagal.");
    }
    
    // --- Tahap 3: Membuat Audio dengan Gradio Client ---
    if (finalReplyContent && HF_TOKEN) { 
        try {
            console.log(`Mencoba generate audio untuk teks: "${finalReplyContent.substring(0, 100)}..." menggunakan Gradio.`);
            const { Client } = await import('@gradio/client');
            const gradioClient = await Client.connect("NihalGazi/Text-To-Speech-Unlimited", { hf_token: HF_TOKEN });
            
            const ttsResult = await gradioClient.predict("/text_to_speech_app", { 		
                prompt: finalReplyContent, 
                voice: "alloy",      // !!! VERIFIKASI & SESUAIKAN !!!
                emotion: "neutral",  // !!! VERIFIKASI & SESUAIKAN !!!
                use_random_seed: true, 		
                specific_seed: Math.floor(Math.random() * 100000), 
            });

            console.log("Hasil mentah dari Gradio TTS predict:", JSON.stringify(ttsResult, null, 2));
            if (ttsResult && ttsResult.data && Array.isArray(ttsResult.data) && ttsResult.data[0]) {
                const audioInfo = ttsResult.data[0];
                if (audioInfo.url || (audioInfo.data && audioInfo.name) || (audioInfo.path && audioInfo.is_file)) { 
                    audioDataForFrontend = audioInfo; 
                    console.log("Data audio berhasil didapatkan dari Gradio:", audioDataForFrontend);
                    audioProvider = "NihalGazi/TTS (Gradio)";
                    if (ttsResult.data[1]) console.log("Status dari Gradio TTS:", ttsResult.data[1]);
                } else {
                     console.warn("Gradio mengembalikan data[0], tetapi tidak ada 'url' atau 'data+name' atau 'path (file)' yang valid:", audioInfo);
                }
            } else {
                console.warn("Gradio tidak mengembalikan data audio yang diharapkan dalam result.data[0]:", ttsResult.data);
            }
        } catch (gradioError) {
            console.error("Error saat memanggil Gradio Client untuk TTS:", gradioError);
        }
    } else if (finalReplyContent && !HF_TOKEN) {
        console.warn("HF_TOKEN tidak tersedia, TTS dengan Gradio tidak dijalankan.");
    }
    
    // --- Tahap 4: Kirim Respons ke Frontend ---
    let providerInfo = respondedBy;
    if(audioProvider) {
        providerInfo += ` + Suara oleh ${audioProvider}`;
    }

    console.log(`Mengirim balasan akhir. Provider Teks: ${respondedBy}. Konten: ${finalReplyContent.substring(0,50)}...`);
    res.json({ 
        reply: { 
            role: "assistant", 
            content: finalReplyContent, 
            provider: providerInfo,
            audioData: audioDataForFrontend 
        } 
    });
});

app.get('/', (req, res) => { res.send('Chat backend is running and ready!'); });
app.listen(port, '0.0.0.0', () => { 
    console.log(`Node.js chat backend listening on all interfaces at port ${port}`);
    console.log("Server started. Ready to receive requests.");
});