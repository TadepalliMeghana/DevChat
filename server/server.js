
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const db = require("./db");
const createGroupChatRoutes = require("./groupChatRoutes");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in .env");
}

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json({ limit: "1mb" }));

const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

const onlineUsers = new Map();

// AUTHENTICATION

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Please log in." });
  }

  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token.",
    });
  }
}

async function isMember(conversationId, userId) {
  const [rows] = await db.execute(
    `SELECT 1
     FROM conversation_members
     WHERE conversation_id = ? AND user_id = ?
     LIMIT 1`,
    [conversationId, userId]
  );

  return rows.length > 0;
}

// BASIC ROUTE

app.get("/", (req, res) => {
  res.json({ message: "DevChat backend is running!" });
});

// GROUP CHAT ROUTES

app.use(
  "/api/groups",
  createGroupChatRoutes({ db, authenticate, io })
);

// Serve uploaded images.
// For production, use private file storage and authenticated image access.
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

// REGISTER

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (
      !username?.trim() ||
      !email?.trim() ||
      typeof password !== "string" ||
      password.length < 6
    ) {
      return res.status(400).json({
        message:
          "Enter a username, email, and password of at least 6 characters.",
      });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    const [existing] = await db.execute(
      "SELECT id FROM users WHERE username = ? OR email = ?",
      [cleanUsername, cleanEmail]
    );

    if (existing.length) {
      return res.status(409).json({
        message: "Username or email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash)
       VALUES (?, ?, ?)`,
      [cleanUsername, cleanEmail, passwordHash]
    );

    const user = {
      id: result.insertId,
      username: cleanUsername,
      email: cleanEmail,
    };

    res.status(201).json({
      message: "Account created successfully.",
      user,
      token: createToken(user),
    });
  } catch (error) {
    console.error("Registration error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Username or email already exists.",
      });
    }

    res.status(500).json({ message: "Failed to register." });
  }
});

// LOGIN

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const [rows] = await db.execute(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    if (!rows.length) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const record = rows[0];
    const valid = await bcrypt.compare(password, record.password_hash);

    if (!valid) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const user = {
      id: record.id,
      username: record.username,
      email: record.email,
    };

    res.json({ user, token: createToken(user) });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Failed to log in." });
  }
});

// CURRENT USER

app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, username, email, last_seen FROM users WHERE id = ?",
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "User not found." });
    }

    res.json({ user: rows[0] });
  } catch (error) {
    console.error("Current user error:", error);
    res.status(500).json({ message: "Failed to load user." });
  }
});

// SEARCH USERS

app.get("/api/users/search", authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) return res.json({ users: [] });

    const [rows] = await db.execute(
      `SELECT id, username, email
       FROM users
       WHERE id <> ?
         AND (username LIKE ? OR email LIKE ?)
       ORDER BY username
       LIMIT 20`,
      [req.user.id, `%${q}%`, `%${q}%`]
    );

    res.json({ users: rows });
  } catch (error) {
    console.error("User search error:", error);
    res.status(500).json({ message: "Failed to search users." });
  }
});

// LIST CONVERSATIONS

app.get("/api/conversations", authenticate, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT c.id, c.name, c.type, c.created_at
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.id DESC`,
      [req.user.id]
    );

    res.json({ conversations: rows });
  } catch (error) {
    console.error("Load conversations error:", error);
    res.status(500).json({
      message: "Failed to load conversations.",
    });
  }
});

// CREATE OR FIND DIRECT CONVERSATION

app.post("/api/conversations", authenticate, async (req, res) => {
  let connection;

  try {
    const otherUserId = Number(req.body?.userId);
    const currentUserId = Number(req.user.id);

    if (
      !Number.isInteger(otherUserId) ||
      otherUserId <= 0 ||
      otherUserId === currentUserId
    ) {
      return res.status(400).json({
        message: "A valid userId is required.",
      });
    }

    connection = await db.getConnection();

    const [users] = await connection.execute(
      "SELECT id FROM users WHERE id = ?",
      [otherUserId]
    );

    if (!users.length) {
      return res.status(404).json({ message: "User not found." });
    }

    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT c.id, c.name, c.type
       FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id
       JOIN conversation_members b ON b.conversation_id = c.id
       WHERE c.type = 'direct'
         AND a.user_id = ?
         AND b.user_id = ?
       LIMIT 1`,
      [currentUserId, otherUserId]
    );

    if (existing.length) {
      await connection.commit();
      return res.json({ conversation: existing[0] });
    }

    const [result] = await connection.execute(
      `INSERT INTO conversations (type, name, created_by)
       VALUES ('direct', NULL, ?)`,
      [currentUserId]
    );

    const conversationId = result.insertId;

    await connection.execute(
      `INSERT INTO conversation_members (conversation_id, user_id)
       VALUES (?, ?), (?, ?)`,
      [
        conversationId,
        currentUserId,
        conversationId,
        otherUserId,
      ]
    );

    await connection.commit();

    res.status(201).json({
      conversation: {
        id: conversationId,
        name: null,
        type: "direct",
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    console.error("Create conversation error:", error);
    res.status(500).json({
      message: "Failed to create conversation.",
    });
  } finally {
    if (connection) connection.release();
  }
});

// GET MESSAGES
// Includes image_url so images appear when reopening a conversation.

app.get(
  "/api/conversations/:id/messages",
  authenticate,
  async (req, res) => {
    try {
      const conversationId = Number(req.params.id);

      if (
        !Number.isSafeInteger(conversationId) ||
        conversationId <= 0
      ) {
        return res.status(400).json({
          message: "Invalid conversation ID.",
        });
      }

      if (!(await isMember(conversationId, req.user.id))) {
        return res.status(403).json({ message: "Access denied." });
      }

      const [rows] = await db.execute(
        `SELECT m.id, m.conversation_id, m.sender_id,
                m.content, m.image_url, m.created_at, m.is_read,
                u.username AS sender_username
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ?
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT 500`,
        [conversationId]
      );

      res.json({ messages: rows });
    } catch (error) {
      console.error("Load messages error:", error);
      res.status(500).json({
        message: "Failed to load messages.",
      });
    }
  }
);

// SAVE AN IMAGE MESSAGE
// The image must first be uploaded through POST /api/groups/:id/images.

app.post(
  "/api/conversations/:id/image-message",
  authenticate,
  async (req, res) => {
    try {
      const conversationId = Number(req.params.id);
      const senderId = Number(req.user.id);
      const imageUrl = String(req.body?.imageUrl || "").trim();
      const content = String(req.body?.content || "").trim();

      if (
        !Number.isSafeInteger(conversationId) ||
        conversationId <= 0
      ) {
        return res.status(400).json({
          message: "Invalid conversation ID.",
        });
      }

      if (
        !imageUrl.startsWith("/uploads/") ||
        imageUrl.includes("..") ||
        imageUrl.includes("\\")
      ) {
        return res.status(400).json({
          message: "Invalid image URL.",
        });
      }

      if (content.length > 5000) {
        return res.status(400).json({
          message: "Caption must be 5000 characters or fewer.",
        });
      }

      if (!(await isMember(conversationId, senderId))) {
        return res.status(403).json({
          message: "Access denied.",
        });
      }

      const [result] = await db.execute(
        `INSERT INTO messages
         (conversation_id, sender_id, content, image_url)
         VALUES (?, ?, ?, ?)`,
        [conversationId, senderId, content || null, imageUrl]
      );

      const [rows] = await db.execute(
        `SELECT m.id, m.conversation_id, m.sender_id,
                m.content, m.image_url, m.created_at, m.is_read,
                u.username AS sender_username
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.id = ?`,
        [result.insertId]
      );

      const message = rows[0];

      io.to(`conversation:${conversationId}`).emit(
        "message:new",
        message
      );

      res.status(201).json({ message });
    } catch (error) {
      console.error("Image message error:", error);
      res.status(500).json({
        message: "Failed to send image message.",
      });
    }
  }
);

// SEARCH MESSAGES

app.get(
  "/api/conversations/:id/search",
  authenticate,
  async (req, res) => {
    try {
      const conversationId = Number(req.params.id);
      const q = String(req.query.q || "").trim();

      if (!(await isMember(conversationId, req.user.id))) {
        return res.status(403).json({ message: "Access denied." });
      }

      if (!q) return res.json({ messages: [] });

      const [rows] = await db.execute(
        `SELECT id, conversation_id, sender_id,
                content, image_url, created_at
         FROM messages
         WHERE conversation_id = ? AND content LIKE ?
         ORDER BY created_at DESC
         LIMIT 50`,
        [conversationId, `%${q}%`]
      );

      res.json({ messages: rows });
    } catch (error) {
      console.error("Message search error:", error);
      res.status(500).json({
        message: "Failed to search messages.",
      });
    }
  }
);

// SOCKET AUTHENTICATION

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

// SOCKET EVENTS

io.on("connection", (socket) => {
  const userId = String(socket.user.id);

  socket.join(`user:${userId}`);

  const userSockets = onlineUsers.get(userId) || new Set();
  userSockets.add(socket.id);
  onlineUsers.set(userId, userSockets);

  if (userSockets.size === 1) {
    io.emit("user:online", userId);
  }

  socket.emit("presence:list", [...onlineUsers.keys()]);

  // Join a conversation only if the user is a member.
  socket.on("conversation:join", async (payload) => {
    try {
      const conversationId =
        typeof payload === "object"
          ? payload?.conversationId
          : payload;

      const id = Number(conversationId);

      if (
        Number.isSafeInteger(id) &&
        id > 0 &&
        (await isMember(id, socket.user.id))
      ) {
        socket.join(`conversation:${id}`);
      }
    } catch (error) {
      console.error("Join conversation error:", error);
    }
  });

  // SEND TEXT MESSAGE

  socket.on("message:send", async ({ conversationId, content } = {}) => {
    try {
      const id = Number(conversationId);
      const text = String(content || "").trim();

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !text ||
        text.length > 5000
      ) {
        return;
      }

      if (!(await isMember(id, socket.user.id))) return;

      const [result] = await db.execute(
        `INSERT INTO messages (conversation_id, sender_id, content)
         VALUES (?, ?, ?)`,
        [id, socket.user.id, text]
      );

      const [rows] = await db.execute(
        `SELECT m.id, m.conversation_id, m.sender_id,
                m.content, m.image_url, m.created_at, m.is_read,
                u.username AS sender_username
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.id = ?`,
        [result.insertId]
      );

      io.to(`conversation:${id}`).emit("message:new", rows[0]);
    } catch (error) {
      console.error("Send message error:", error);
      socket.emit("chat:error", {
        message: "Failed to send message.",
      });
    }
  });

  // TYPING INDICATORS

  socket.on("typing:start", async ({ conversationId } = {}) => {
    try {
      const id = Number(conversationId);

      if (!(await isMember(id, socket.user.id))) return;

      socket.to(`conversation:${id}`).emit("typing:start", {
        userId: socket.user.id,
        userName: socket.user.username,
        conversationId: id,
      });
    } catch (error) {
      console.error("Typing event error:", error);
    }
  });

  socket.on("typing:stop", async ({ conversationId } = {}) => {
    try {
      const id = Number(conversationId);

      if (!(await isMember(id, socket.user.id))) return;

      socket.to(`conversation:${id}`).emit("typing:stop", {
        userId: socket.user.id,
        conversationId: id,
      });
    } catch (error) {
      console.error("Typing stop error:", error);
    }
  });

  // READ RECEIPTS

  socket.on("message:read", async ({ conversationId } = {}) => {
    try {
      const id = Number(conversationId);

      if (!(await isMember(id, socket.user.id))) return;

      await db.execute(
        `UPDATE messages
         SET is_read = TRUE
         WHERE conversation_id = ? AND sender_id <> ?`,
        [id, socket.user.id]
      );

      io.to(`conversation:${id}`).emit("messages:read", {
        conversationId: id,
        userId: socket.user.id,
      });
    } catch (error) {
      console.error("Read receipt error:", error);
    }
  });

  // DISCONNECT / LAST SEEN

  socket.on("disconnect", async () => {
    const sockets = onlineUsers.get(userId);

    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        io.emit("user:offline", userId);

        try {
          await db.execute(
            "UPDATE users SET last_seen = NOW() WHERE id = ?",
            [socket.user.id]
          );
        } catch (error) {
          console.error("Update last_seen error:", error);
        }
      }
    }
  });
});

// START SERVER

async function startServer() {
  try {
    await db.query("SELECT 1");

    server.listen(PORT, () => {
      console.log(`DevChat backend running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
}

startServer();
