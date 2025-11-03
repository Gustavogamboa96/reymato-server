import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { ReyMatoRoom } from "./ReyMatoRoom";

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const gameServer = new Server({
  server,
});

// Register the Rey Mato room
gameServer.define("rey_mato", ReyMatoRoom);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Use PORT from environment (Render provides this) or fallback to 2567 for local development
const PORT = Number.parseInt(process.env.PORT || '2567', 10);

gameServer.listen(PORT);
console.log(`🎮 Rey Mato server running on port ${PORT}`);
console.log(`🌐 Health check: http://localhost:${PORT}/health`);