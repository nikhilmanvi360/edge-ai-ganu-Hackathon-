import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

// In-memory array to store the latest logs
let telemetryLogs = [];

app.post('/api/telemetry', (req, res) => {
    const data = req.body;

    const newLog = {
        id: Date.now().toString(),
        created_at: new Date().toISOString(),
        ...data
    };

    telemetryLogs.push(newLog);
    // Keep only the last 1000 logs to prevent memory leaks
    if (telemetryLogs.length > 1000) {
        telemetryLogs.shift();
    }

    res.status(200).json({ success: true });
});

app.get('/api/telemetry', (req, res) => {
    // Return the last 100 entries for the dashboard
    res.json(telemetryLogs.slice(-100));
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Local Telemetry Server running on http://localhost:${PORT}`);
});
