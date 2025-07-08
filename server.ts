import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { v4 as uuidv4 } from "uuid";

interface User {
  id: string;
  username: string;
  ws: WebSocket;
  isOnline: boolean;
}

interface Message {
  type:
    | "join"
    | "leave"
    | "offer"
    | "answer"
    | "ice-candidate"
    | "typing"
    | "stop-typing"
    | "user-list"
    | "message"
    | "joined"
    | "error";
  userId?: string;
  username?: string;
  targetUserId?: string;
  data?: any;
  timestamp?: number;
}

class SignalingServer {
  private users: Map<string, User> = new Map();
  private wss: WebSocketServer;

  constructor() {
    const server = createServer((req, res) => {
      // Enable CORS for HTTP requests
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("WebSocket signaling server is running");
    });

    const port = parseInt(process.env.PORT || "8080", 10);

    // Configure WebSocket server with proper options
    this.wss = new WebSocketServer({ 
      server,
      perMessageDeflate: false, // Disable compression for better compatibility
      clientTracking: true
    });
    
    this.setupWebSocket();

    server.listen(port, '0.0.0.0', () => {
      console.log(`Signaling server running on port ${port}`);
      console.log(`WebSocket URL: ws://localhost:${port} (development)`);
      console.log(`WebSocket URL: wss://your-domain.onrender.com (production)`);
    });

    // Handle server shutdown gracefully
    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down gracefully');
      this.shutdown();
    });

    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down gracefully');
      this.shutdown();
    });
  }

  private setupWebSocket() {
    this.wss.on("connection", (ws: WebSocket, req) => {
      console.log(`New WebSocket connection from ${req.socket.remoteAddress}`);

      // Send a ping to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000); // 30 seconds

      ws.on("message", (data: Buffer) => {
        try {
          const message: Message = JSON.parse(data.toString());
          console.log('Received message:', message.type, message.username || message.userId);
          this.handleMessage(ws, message);
        } catch (error) {
          console.error("Error parsing message:", error);
          this.sendError(ws, "Invalid message format");
        }
      });

      ws.on("close", (code, reason) => {
        console.log(`WebSocket connection closed: ${code} ${reason}`);
        clearInterval(pingInterval);
        this.handleDisconnect(ws);
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        clearInterval(pingInterval);
      });

      ws.on("pong", () => {
        // Connection is alive
      });
    });

    this.wss.on("error", (error) => {
      console.error("WebSocket server error:", error);
    });
  }

  private handleMessage(ws: WebSocket, message: Message) {
    switch (message.type) {
      case "join":
        this.handleJoin(ws, message);
        break;
      case "offer":
      case "answer":
      case "ice-candidate":
        this.handleWebRTCSignaling(message);
        break;
      case "typing":
      case "stop-typing":
        this.handleTyping(message);
        break;
      case "message":
        this.handleChatMessage(message);
        break;
      default:
        console.log("Unknown message type:", message.type);
        this.sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  private handleJoin(ws: WebSocket, message: Message) {
    if (!message.username) {
      this.sendError(ws, "Username is required");
      return;
    }

    const userId = uuidv4();
    const user: User = {
      id: userId,
      username: message.username,
      ws,
      isOnline: true,
    };

    this.users.set(userId, user);

    // Send user ID back to client
    ws.send(
      JSON.stringify({
        type: "joined",
        userId,
        username: user.username,
      })
    );

    // Broadcast updated user list to all clients
    this.broadcastUserList();

    console.log(`User ${user.username} joined with ID ${userId}. Total users: ${this.users.size}`);
  }

  private handleWebRTCSignaling(message: Message) {
    if (!message.targetUserId) {
      console.error("Target user ID missing for WebRTC signaling");
      return;
    }

    const targetUser = this.users.get(message.targetUserId);
    if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
      targetUser.ws.send(JSON.stringify(message));
    } else {
      console.error(`Target user ${message.targetUserId} not found or not connected`);
    }
  }

  private handleTyping(message: Message) {
    if (!message.userId) {
      console.error("User ID missing for typing message");
      return;
    }

    // Broadcast typing status to all users except sender
    this.users.forEach((user, userId) => {
      if (userId !== message.userId && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(message));
      }
    });
  }

  private handleChatMessage(message: Message) {
    if (!message.userId || !message.username) {
      console.error("User ID or username missing for chat message");
      return;
    }

    const timestampedMessage = {
      ...message,
      timestamp: Date.now(),
    };

    console.log(`Broadcasting message from ${message.username}: ${message.data?.content}`);

    // Broadcast message to all users
    this.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(timestampedMessage));
      }
    });
  }

  private handleDisconnect(ws: WebSocket) {
    let disconnectedUserId: string | null = null;
    let disconnectedUsername: string | null = null;

    this.users.forEach((user, userId) => {
      if (user.ws === ws) {
        disconnectedUserId = userId;
        disconnectedUsername = user.username;
      }
    });

    if (disconnectedUserId) {
      this.users.delete(disconnectedUserId);
      this.broadcastUserList();
      console.log(`User ${disconnectedUsername} disconnected. Total users: ${this.users.size}`);
    }
  }

  private broadcastUserList() {
    const userList = Array.from(this.users.values()).map((user) => ({
      id: user.id,
      username: user.username,
      isOnline: user.isOnline,
    }));

    const message = JSON.stringify({
      type: "user-list",
      users: userList,
    });

    this.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(message);
      }
    });
  }

  private sendError(ws: WebSocket, errorMessage: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "error",
        error: errorMessage
      }));
    }
  }

  private shutdown() {
    console.log('Shutting down server...');
    
    // Close all WebSocket connections
    this.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.close(1000, 'Server shutting down');
      }
    });

    // Close WebSocket server
    this.wss.close(() => {
      console.log('WebSocket server closed');
      process.exit(0);
    });
  }
}

// Create server instance
new SignalingServer();