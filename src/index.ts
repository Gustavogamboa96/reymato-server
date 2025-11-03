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

const PORT = 2567;

gameServer.listen(PORT);
console.log(`🎮 Rey Mato server running on port ${PORT}`);
console.log(`🌐 Health check: http://localhost:${PORT}/health`);