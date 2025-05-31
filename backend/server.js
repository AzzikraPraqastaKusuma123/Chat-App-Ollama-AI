// ... (bagian atas server.js tetap sama)
require('dotenv').config();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
// --- Ollama Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
    const { messages, model = "gemma:2b" } = req.body; // Model Ollama default
    const OLLAMA_TIMEOUT = 60000; // 60 detik
    // VVV PENTING: Simpan API Key Anda dengan aman, jangan di-hardcode jika memungkinkan VVV
    // Idealnya gunakan environment variable: const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    // Untuk contoh ini, kita akan gunakan placeholder. Ganti dengan API Key Anda.
    const DEEPSEEK_API_KEY = "sk-69b5388e856a441492c51fccc79ec908"; 
    // ^^^ GANTI DENGAN API KEY DEEPSEEK ANDA ^^^

    // Validasi input dasar ... (tetap sama)
    if (!messages || !Array.isArray(messages) || messages.length === 0) { /* ... */ return res.status(400).json({ error: "..." }); }
    for (const message of messages) { if (!message.role || !message.content) { /* ... */ return res.status(400).json({ error: "..." }); } }

    let replyContent = "";
    let respondedBy = "";

    try {
        console.log(`Mencoba model Ollama: ${model} dengan batas waktu ${OLLAMA_TIMEOUT / 1000} detik...`);
        
        const ollamaOperation = ollama.chat({
            model: model,
            messages: messages,
            stream: false,
        });

        const ollamaResponse = await Promise.race([
            ollamaOperation,
            createTimeoutPromise(OLLAMA_TIMEOUT, `Model Ollama (${model}) tidak merespons dalam ${OLLAMA_TIMEOUT / 1000} detik.`)
        ]);

        if (ollamaResponse && ollamaResponse.message && typeof ollamaResponse.message.content === 'string') {
            replyContent = ollamaResponse.message.content;
            respondedBy = `Ollama (${model})`;
            console.log("Respons berhasil dari Ollama.");
        } else {
            throw new Error("Struktur respons tidak valid dari Ollama setelah Promise.race.");
        }

    } catch (ollamaError) {
        console.warn(`Gagal mendapatkan respons dari Ollama (${model}): ${ollamaError.message}`);
        console.log("Mencoba fallback ke DeepSeek API...");

        if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === "API_KEY_DEEPSEEK_ANDA_DI_SINI") {
            console.error("API Key DeepSeek belum diatur!");
            return res.status(500).json({ error: `Gagal mendapatkan respons dari semua sumber. Ollama error: ${ollamaError.message}. DeepSeek API Key tidak valid.` });
        }
        
        try {
            // Format pesan untuk DeepSeek API (mungkin perlu disesuaikan)
            // Biasanya API chat mengharapkan array objek dengan 'role' dan 'content'
            const deepseekPayloadMessages = messages.map(msg => ({ role: msg.role, content: msg.content }));

            // URL Endpoint DeepSeek API (GANTI DENGAN URL YANG BENAR DARI DOKUMENTASI DEEPSEEK)
            const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"; // INI HANYA CONTOH, PASTIKAN URL INI BENAR

            console.log("Mengirim permintaan ke DeepSeek API...");
            const deepseekAPIResponse = await fetch(DEEPSEEK_API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    // Nama model spesifik di DeepSeek (GANTI DENGAN NAMA MODEL YANG SESUAI)
                    model: "deepseek-chat", // atau "deepseek-coder", tergantung model yang Anda inginkan
                    messages: deepseekPayloadMessages,
                    // Tambahkan parameter lain jika diperlukan oleh API DeepSeek (misalnya, max_tokens, temperature, dll.)
                    // stream: false, // Jika DeepSeek mendukung opsi stream
                })
            });

            if (!deepseekAPIResponse.ok) {
                const errorData = await deepseekAPIResponse.json().catch(() => deepseekAPIResponse.text()); // Coba parse JSON, jika gagal ambil text
                console.error("DeepSeek API Error Data:", errorData);
                throw new Error( (typeof errorData === 'string' ? errorData : errorData?.error?.message) || `DeepSeek API error: ${deepseekAPIResponse.status}`);
            }
            
            const deepseekData = await deepseekAPIResponse.json();
            console.log("Respons dari DeepSeek API:", deepseekData);

            // Ekstrak konten balasan dari deepseekData
            // Ini SANGAT BERGANTUNG pada struktur respons API DeepSeek. Anda HARUS memeriksa dokumentasi mereka.
            // Contoh umum (mungkin perlu diubah):
            if (deepseekData.choices && deepseekData.choices[0] && deepseekData.choices[0].message && deepseekData.choices[0].message.content) {
                replyContent = deepseekData.choices[0].message.content;
            } else {
                // Jika struktur tidak sesuai, log dan lempar error
                console.error("Struktur respons tidak dikenal dari DeepSeek API:", deepseekData);
                throw new Error("Struktur respons tidak dikenal dari DeepSeek API.");
            }
            
            respondedBy = "DeepSeek API";
            console.log("Respons berhasil dari DeepSeek API.");

        } catch (deepseekError) {
            console.error("Gagal mendapatkan respons dari DeepSeek API juga:", deepseekError); // Log error lengkap
            return res.status(500).json({ error: `Gagal mendapatkan respons dari semua sumber. Ollama error: ${ollamaError.message}. DeepSeek error: ${deepseekError.message}` });
        }
    }

    // Kirim balasan yang berhasil didapatkan
    if (replyContent) {
        console.log(`Mengirim balasan dari: ${respondedBy}`);
        res.json({ reply: { role: "assistant", content: replyContent, provider: respondedBy } });
    } else {
        // Fallback jika tidak ada konten sama sekali (seharusnya sudah ditangani di atas)
        if (!res.headersSent) { // Pastikan header belum dikirim
           res.status(500).json({ error: "Tidak ada konten balasan yang bisa dikirim setelah mencoba semua sumber." });
        }
    }
});

// Fungsi createTimeoutPromise tetap sama
function createTimeoutPromise(ms, errorMessage = 'Operasi melebihi batas waktu') {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(errorMessage));
        }, ms);
    });
}

// ... (sisa kode server.js: Health Check, app.listen)
// app.get('/', (req, res) => { res.send('Chat backend is running and ready!'); });
// app.listen(port, '0.0.0.0', () => { console.log(`Node.js chat backend listening...`); });