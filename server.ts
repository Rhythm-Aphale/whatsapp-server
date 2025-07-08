import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';

interface User {
  id: string;
  username: string;
  ws: WebSocket;
  isOnline: boolean;
}

interface Message {
  type: 'join' | 'leave' | 'offer' | 'answer' | 'ice-candidate' | 'typing' | 'stop-typing' | 'user-list' | 'message';
  userId?: string;
  username?: string;
  targetUserId?: string;
  messageId?: string; // New field
  data?: any;
  timestamp?: number;
}

class SignalingServer {
  private users: Map<string, User> = new Map();
  private wss: WebSocketServer;

  constructor() {
    const server = createServer();
    const port = parseInt(process.env.PORT || '8080', 10);

    this.wss = new WebSocketServer({ server });
    this.setupWebSocket();
    
    server.listen(port, () => {
      console.log(`Signaling server running on port ${port}`);
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket connection');

      ws.on('message', (data: Buffer) => {
        try {
          const message: Message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  private handleMessage(ws: WebSocket, message: Message) {
    switch (message.type) {
      case 'join':
        this.handleJoin(ws, message);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.handleWebRTCSignaling(message);
        break;
      case 'typing':
      case 'stop-typing':
        this.handleTyping(message);
        break;
      case 'message':
        this.handleChatMessage(message);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private handleJoin(ws: WebSocket, message: Message) {
    const userId = uuidv4();
    const user: User = {
      id: userId,
      username: message.username || 'Anonymous',
      ws,
      isOnline: true
    };

    this.users.set(userId, user);

    ws.send(JSON.stringify({
      type: 'joined',
      userId,
      username: user.username
    }));

    this.broadcastUserList();
    
    console.log(`User ${user.username} joined with ID ${userId}`);
  }

  private handleWebRTCSignaling(message: Message) {
    const targetUser = this.users.get(message.targetUserId!);
    if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
      targetUser.ws.send(JSON.stringify(message));
    }
  }

  private handleTyping(message: Message) {
    const targetUser = this.users.get(message.targetUserId!);
    if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
      targetUser.ws.send(JSON.stringify(message));
    }
  }

  private handleChatMessage(message: Message) {
    const targetUser = this.users.get(message.targetUserId!);
    const sender = this.users.get(message.userId!);
    
    const messageToSend = {
      ...message,
      timestamp: Date.now()
    };

    if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
      targetUser.ws.send(JSON.stringify(messageToSend));
    }
    
    if (sender && sender.ws.readyState === WebSocket.OPEN && sender.id !== message.targetUserId) {
      sender.ws.send(JSON.stringify(messageToSend));
    }
  }

  private handleDisconnect(ws: WebSocket) {
    let disconnectedUserId: string | null = null;
    
    this.users.forEach((user, userId) => {
      if (user.ws === ws) {
        disconnectedUserId = userId;
        console.log(`User ${user.username} disconnected`);
      }
    });

    if (disconnectedUserId) {
      this.users.delete(disconnectedUserId);
      this.broadcastUserList();
    }
  }

  private broadcastUserList() {
    const userList = Array.from(this.users.values()).map(user => ({
      id: user.id,
      username: user.username,
      isOnline: user.isOnline
    }));

    const message = JSON.stringify({
      type: 'user-list',
      users: userList
    });

    this.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(message);
      }
    });
  }
}

new SignalingServer();