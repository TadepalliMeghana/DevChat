
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

module.exports = function createGroupChatRoutes({ db, authenticate, io }) {
  const router = express.Router();
  const uploadDir = path.join(__dirname, "uploads");

  fs.mkdirSync(uploadDir, { recursive: true });

  const allowedTypes = new Map([
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["image/webp", ".webp"],
    ["image/gif", ".gif"],
  ]);

  const storage = multer.diskStorage({
    destination: (_req, _file, callback) =>
      callback(null, uploadDir),

    filename: (_req, file, callback) => {
      const extension = allowedTypes.get(file.mimetype);
      callback(
        null,
        `${Date.now()}-${crypto.randomUUID()}${extension}`
      );
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!allowedTypes.has(file.mimetype)) {
        return callback(
          new Error("Only JPG, PNG, WEBP and GIF images are allowed.")
        );
      }
      callback(null, true);
    },
  });

  async function isMember(conversationId, userId) {
    const [rows] = await db.execute(
      `SELECT 1 FROM conversation_members
       WHERE conversation_id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );
    return rows.length > 0;
  }

  function validId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  // Create a group
  router.post("/", authenticate, async (req, res) => {
    let connection;

    try {
      const name = String(req.body?.name || "").trim();
      const creatorId = Number(req.user.id);
      const suppliedIds = req.body?.memberIds;

      if (!name || name.length > 100) {
        return res.status(400).json({
          message: "Group name must be 1–100 characters.",
        });
      }

      if (!Array.isArray(suppliedIds)) {
        return res.status(400).json({
          message: "memberIds must be an array.",
        });
      }

      const validMembers = suppliedIds.every((value) => {
        const id = Number(value);
        return (
          (typeof value === "number" ||
            (typeof value === "string" && /^\d+$/.test(value))) &&
          Number.isSafeInteger(id) &&
          id > 0
        );
      });

      if (!validMembers) {
        return res.status(400).json({
          message: "Invalid member IDs.",
        });
      }

      const memberIds = [
        ...new Set([creatorId, ...suppliedIds.map(Number)]),
      ];

      if (memberIds.length < 2) {
        return res.status(400).json({
          message: "Add at least one other member.",
        });
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      const placeholders = memberIds.map(() => "?").join(", ");

      const [users] = await connection.execute(
        `SELECT id FROM users WHERE id IN (${placeholders})`,
        memberIds
      );

      if (users.length !== memberIds.length) {
        await connection.rollback();
        return res.status(400).json({
          message: "One or more users do not exist.",
        });
      }

      const [result] = await connection.execute(
        `INSERT INTO conversations (type, name, created_by)
         VALUES ('group', ?, ?)`,
        [name, creatorId]
      );

      const conversationId = result.insertId;

      for (const userId of memberIds) {
        await connection.execute(
          `INSERT INTO conversation_members
             (conversation_id, user_id)
           VALUES (?, ?)`,
          [conversationId, userId]
        );
      }

      await connection.commit();

      const conversation = {
        id: conversationId,
        type: "group",
        name,
        created_by: creatorId,
        memberIds,
      };

      for (const userId of memberIds) {
        io.to(`user:${userId}`).emit("group:created", conversation);
      }

      return res.status(201).json({
        message: "Group created successfully.",
        conversation,
      });
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch {}
      }

      console.error("Create group error:", error);
      return res.status(500).json({
        message: "Failed to create group.",
      });
    } finally {
      if (connection) connection.release();
    }
  });

  // Upload an image for a conversation.
  // The frontend must separately create a message containing imageUrl.
  router.post(
    "/:id/images",
    authenticate,
    async (req, res, next) => {
      try {
        const conversationId = validId(req.params.id);

        if (!conversationId) {
          return res.status(400).json({
            message: "Invalid conversation ID.",
          });
        }

        if (!(await isMember(conversationId, req.user.id))) {
          return res.status(403).json({
            message: "You are not a member of this conversation.",
          });
        }

        req.conversationId = conversationId;
        next();
      } catch (error) {
        console.error("Membership check error:", error);
        return res.status(500).json({
          message: "Failed to verify membership.",
        });
      }
    },
    (req, res) => {
      upload.single("image")(req, res, (error) => {
        if (error) {
          return res.status(400).json({
            message:
              error.code === "LIMIT_FILE_SIZE"
                ? "Image must be 5 MB or smaller."
                : error.message,
          });
        }

        if (!req.file) {
          return res.status(400).json({
            message: "Please select an image.",
          });
        }

        return res.status(201).json({
          message: "Image uploaded successfully.",
          imageUrl: `/uploads/${req.file.filename}`,
        });
      });
    }
  );

  return router;
};
