// backend/server.js

// Import necessary modules
const express = require('express');
const cors = require('cors');
const ollamaImport = require('ollama'); // Mengimpor pustaka ollama

// Initialize Express app
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Akses instance Ollama yang sebenarnya melalui .default
const ollama = ollamaImport.default;

// Cek saat server dimulai apakah ollama (instance) dan ollama.chat ada
if (!ollama || typeof ollama.chat !== 'function') {
    console.error("KESALAHAN KRITIS SAAT STARTUP: Pustaka Ollama tidak termuat dengan benar atau ollama.chat bukan fungsi.");
    console.error("Pastikan pustaka 'ollama' (npm install ollama) terinstal dengan benar di folder backend.");
    console.error("Objek ollamaImport yang diimpor:", ollamaImport);
    if (ollamaImport && ollamaImport.default) {
        console.error("Tipe dari ollamaImport.default.chat:", typeof ollamaImport.default.chat);
    } else if (ollamaImport) {
        console.error("ollamaImport.default tidak ada. Properti yang tersedia di ollamaImport:", Object.keys(ollamaImport));
    }
    // process.exit(1); // Hentikan server jika kritis
} else {
    console.log("Pustaka Ollama (instance default, dengan metode .chat) terdeteksi dan siap digunakan saat startup.");
}

// --- Ollama Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
    // VVV MODEL DEFAULT DIUBAH DI SINI VVV
    const { messages, model = "gemma:2b" } = req.body;
    // ^^^ MODEL DEFAULT SEKARANG gemma:2b ^^^

    // Validasi input dasar
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required and cannot be empty." });
    }
    for (const message of messages) {
        if (!message.role || !message.content) {
            return res.status(400).json({ error: "Each message must have a 'role' and 'content'." });
        }
    }

    // Validasi Pustaka Ollama sebelum digunakan di endpoint
    if (!ollama || typeof ollama.chat !== 'function') {
        console.error("Kesalahan Kritis di Endpoint /api/chat: ollama.chat bukan fungsi.");
        return res.status(500).json({ error: "Konfigurasi server bermasalah: Pustaka Ollama tidak termuat dengan benar." });
    }

    try {
        console.log(`Received request for model: ${model} with messages:`, messages);

        const response = await ollama.chat({
            model: model, // Akan menggunakan "gemma:2b" jika tidak ada model dari body request
            messages: messages,
            stream: false,
        });

        console.log("Ollama response:", response);

        if (response && response.message && typeof response.message.content === 'string') {
            res.json({ reply: response.message });
        } else {
            console.error("Unexpected response structure from Ollama:", response);
            res.status(500).json({ error: "Received an unexpected response structure from Ollama." });
        }

    } catch (error) {
        console.error("Error during Ollama API call:", error);
        if (error.message && error.message.includes("model") && error.message.includes("not found")) {
             res.status(404).json({ error: `The model '${model}' was not found by Ollama. Ensure it is pulled.` });
        } else if (error.response && error.response.data && error.response.data.error) {
            res.status(500).json({ error: error.response.data.error });
        } else if (error.message && (error.message.toLowerCase().includes('failed to fetch') || error.message.toLowerCase().includes('econrefused'))) {
            const ollamaHost = (ollama && ollama.config && ollama.config.host) ? ollama.config.host : 'layanan Ollama';
            res.status(503).json({ error: `Service Unavailable: Could not connect to ${ollamaHost}. Ensure Ollama is running.`});
        } else {
            res.status(500).json({ error: error.message || "An internal server error occurred while contacting Ollama." });
        }
    }
});

// --- Health Check Endpoint ---
app.get('/', (req, res) => {
    res.send('Chat backend is running and ready!');
});

// Start the server
app.listen(port, '0.0.0.0', () => { // Mendengarkan di semua antarmuka jaringan
    console.log(`Node.js chat backend listening on all interfaces at port ${port}`);
    console.log(`Ollama API endpoint available at POST /api/chat`);
    console.log("Server started. Ready to receive requests.");
});