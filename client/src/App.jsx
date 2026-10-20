import "./App.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";
const TOKEN_KEY = "devchat_token";

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const isFormData = options.body instanceof FormData;

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || "Request failed.");
  }

  return data;
}

function getId(user) {
  return Number(user?.id ?? user?.user_id);
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [me, setMe] = useState(null);

  const [authMode, setAuthMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchDone, setSearchDone] = useState(false);

  const [selectedMembers, setSelectedMembers] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [imageFile, setImageFile] = useState(null);

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const socketRef = useRef(null);
  const activeConversationRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  const loadMe = useCallback(async () => {
    const data = await request("/api/auth/me");
    setMe(data.user || data);
  }, []);

  const loadConversations = useCallback(async () => {
    const data = await request("/api/conversations");
    const list = Array.isArray(data)
      ? data
      : data.conversations || data.items || [];

    setConversations(list);
    return list;
  }, []);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    const data = await request(
      `/api/conversations/${conversationId}/messages`
    );

    const list = Array.isArray(data)
      ? data
      : data.messages || data.items || [];

    setMessages(list);
  }, []);

  const openConversation = useCallback(
    async (conversation) => {
      if (!conversation?.id) return;

      setError("");
      setNotice("");
      setActiveConversation(conversation);
      activeConversationRef.current = conversation;
      setTypingUsers([]);

      try {
        await loadMessages(conversation.id);

        if (socketRef.current?.connected) {
          socketRef.current.emit(
            "conversation:join",
            Number(conversation.id)
          );
        }
      } catch (err) {
        setError(err.message || "Could not load messages.");
      }
    },
    [loadMessages]
  );

  const logout = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;

    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setMe(null);
    setConversations([]);
    setActiveConversation(null);
    activeConversationRef.current = null;
    setMessages([]);
    setSearchResults([]);
    setSelectedMembers([]);
    setOnlineUsers([]);
    setTypingUsers([]);
    setError("");
    setNotice("");
  }, []);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function initialize() {
      try {
        await loadMe();
        if (!cancelled) await loadConversations();
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Could not load your account.");
          logout();
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [token, loadMe, loadConversations, logout]);

  useEffect(() => {
    if (!token) return;

    const socket = io(API, {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      const current = activeConversationRef.current;
      if (current?.id) {
        socket.emit("conversation:join", Number(current.id));
      }
    });

    socket.on("connect_error", (err) => {
      setError(err.message || "Could not connect to the chat server.");
    });

    socket.on("presence:list", (users) => {
      setOnlineUsers(Array.isArray(users) ? users.map(Number) : []);
    });

    socket.on("user:online", (userId) => {
      setOnlineUsers((previous) =>
        previous.includes(Number(userId))
          ? previous
          : [...previous, Number(userId)]
      );
    });

    socket.on("user:offline", (userId) => {
      setOnlineUsers((previous) =>
        previous.filter((id) => id !== Number(userId))
      );
    });

    socket.on("message:new", (message) => {
      const current = activeConversationRef.current;

      if (
        current &&
        Number(message.conversation_id) === Number(current.id)
      ) {
        setMessages((previous) => {
          if (previous.some((item) => Number(item.id) === Number(message.id))) {
            return previous;
          }
          return [...previous, message];
        });

        if (Number(message.sender_id) !== Number(me?.id)) {
          socket.emit("message:read", {
            conversationId: Number(current.id),
          });
        }
      }

      loadConversations().catch(() => {});
    });

    socket.on("typing:start", (data) => {
      const current = activeConversationRef.current;
      const conversationId = Number(
        data.conversationId ?? data.conversation_id
      );

      if (!current || conversationId !== Number(current.id)) return;

      const userId = Number(data.userId ?? data.user_id);
      if (!userId || userId === Number(me?.id)) return;

      setTypingUsers((previous) =>
        previous.includes(userId) ? previous : [...previous, userId]
      );
    });

    socket.on("typing:stop", (data) => {
      const userId = Number(data.userId ?? data.user_id);
      setTypingUsers((previous) =>
        previous.filter((id) => id !== userId)
      );
    });

    socket.on("messages:read", () => {
      setMessages((previous) =>
        previous.map((message) => ({ ...message, is_read: 1 }))
      );
    });

    socket.on("group:created", () => {
      loadConversations().catch(() => {});
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      clearTimeout(typingTimeoutRef.current);
    };
  }, [token, me?.id, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleAuth(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const endpoint =
        authMode === "login" ? "/api/auth/login" : "/api/auth/register";

      const body =
        authMode === "login"
          ? { email, password }
          : { username, email, password };

      const data = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const newToken = data.token || data.accessToken;
      if (!newToken) {
        throw new Error("The server did not return a login token.");
      }

      localStorage.setItem(TOKEN_KEY, newToken);
      setToken(newToken);
      setPassword("");
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  async function searchPeople(event) {
    event?.preventDefault();
    setError("");
    setNotice("");
    setSearchDone(true);
    setSearchResults([]);

    if (!query.trim()) {
      setError("Enter a username to search.");
      return;
    }

    try {
      const data = await request(
        `/api/users/search?q=${encodeURIComponent(query.trim())}`
      );

      const list = Array.isArray(data)
        ? data
        : data.users || data.results || [];

      setSearchResults(
        list.filter((user) => getId(user) !== Number(me?.id))
      );
    } catch (err) {
      setError(err.message || "Search failed.");
    }
  }

  function toggleGroupMember(user) {
    const id = getId(user);
    if (!id || id === Number(me?.id)) return;

    setSelectedMembers((previous) => {
      const alreadySelected = previous.some(
        (member) => getId(member) === id
      );

      return alreadySelected
        ? previous.filter((member) => getId(member) !== id)
        : [...previous, user];
    });
  }

  async function startDirectChat(user) {
    setError("");
    setNotice("");

    try {
      const data = await request("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ userId: getId(user) }),
      });

      const conversation = data.conversation || data.item || data;

      const updated = await loadConversations();

      let target = updated.find(
        (item) => Number(item.id) === Number(conversation.id)
      );

      if (!target && conversation.id) target = conversation;

      if (target?.id) {
        await openConversation(target);
      } else {
        setError("Conversation created, but could not find its ID.");
      }
    } catch (err) {
      setError(err.message || "Could not start conversation.");
    }
  }

  async function createGroup(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!groupName.trim()) {
      setError("Enter a group name.");
      return;
    }

    const memberIds = selectedMembers
      .map(getId)
      .filter((id) => id && id !== Number(me?.id));

    if (memberIds.length === 0) {
      setError("Select at least one other member.");
      return;
    }

    setLoading(true);

    try {
      const data = await request("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          name: groupName.trim(),
          memberIds,
        }),
      });

      const created = data.conversation || data.group || data;

      setGroupName("");
      setSelectedMembers([]);
      setShowGroupForm(false);
      setSearchResults([]);
      setSearchDone(false);
      setQuery("");

      const updated = await loadConversations();
      const group = updated.find(
        (item) => Number(item.id) === Number(created.id)
      );

      if (group) {
        await openConversation(group);
      } else if (created.id) {
        await openConversation(created);
      }

      setNotice(data.message || "Group created successfully.");
    } catch (err) {
      setError(err.message || "Could not create group.");
    } finally {
      setLoading(false);
    }
  }

  function sendTyping() {
    const current = activeConversationRef.current;
    const socket = socketRef.current;
    if (!current || !socket?.connected) return;

    socket.emit("typing:start", {
      conversationId: Number(current.id),
    });

    clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typing:stop", {
        conversationId: Number(current.id),
      });
    }, 900);
  }

  async function sendMessage(event) {
    event.preventDefault();

    const current = activeConversationRef.current;
    const socket = socketRef.current;
    const content = messageText.trim();

    if (!current) {
      setError("Select a conversation first.");
      return;
    }

    if (!content) return;

    if (!socket?.connected) {
      setError("Chat server is disconnected. Try again.");
      return;
    }

    setError("");
    setMessageText("");

    socket.emit("message:send", {
      conversationId: Number(current.id),
      content,
    });

    socket.emit("typing:stop", {
      conversationId: Number(current.id),
    });
  }

  async function sendImage(event) {
    event.preventDefault();

    const current = activeConversationRef.current;

    if (!current) {
      setError("Select a conversation first.");
      return;
    }

    if (!imageFile) {
      setError("Choose an image first.");
      return;
    }

    if (!imageFile.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    if (imageFile.size > 5 * 1024 * 1024) {
      setError("Image must be 5 MB or smaller.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("image", imageFile);

      const uploaded = await request(
        `/api/groups/${current.id}/images`,
        {
          method: "POST",
          body: formData,
        }
      );

      const imageUrl = uploaded.imageUrl || uploaded.image_url;
      if (!imageUrl) {
        throw new Error("The server did not return an image URL.");
      }

      await request(`/api/conversations/${current.id}/image-message`, {
        method: "POST",
        body: JSON.stringify({ imageUrl }),
      });

      setImageFile(null);

      const input = document.getElementById("devchat-image-input");
      if (input) input.value = "";

      await loadMessages(current.id);
      await loadConversations();
      setNotice("Image sent.");
    } catch (err) {
      setError(err.message || "Could not send image.");
    } finally {
      setLoading(false);
    }
  }

  function conversationTitle(conversation) {
    if (conversation.type === "group") {
      return conversation.name || `Group ${conversation.id}`;
    }

    return (
      conversation.other_username ||
      conversation.username ||
      conversation.name ||
      `Conversation ${conversation.id}`
    );
  }

  function imageSource(imageUrl) {
    if (!imageUrl) return "";

    if (
      imageUrl.startsWith("http://") ||
      imageUrl.startsWith("https://")
    ) {
      return imageUrl;
    }

    return `${API}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
  }

  if (!token) {
    return (
      <main className="auth-page">
        <form className="auth-card" onSubmit={handleAuth}>
          <h1>DevChat</h1>
          <p>{authMode === "login" ? "Welcome back" : "Create your account"}</p>

          {authMode === "register" && (
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              required
            />
          )}

          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
          />

          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
          />

          {error && <p className="error-message">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : authMode === "login"
                ? "Log in"
                : "Register"}
          </button>

          <p>
            {authMode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setAuthMode((mode) =>
                  mode === "login" ? "register" : "login"
                )
              }
            >
              {authMode === "login" ? "Register" : "Log in"}
            </button>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="app-layout">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div>
            <h1>DevChat</h1>
            <p>{me?.username || me?.email || "User"}</p>
          </div>
          <button type="button" onClick={logout}>
            Log out
          </button>
        </header>

        <section className="people-search">
          <form onSubmit={searchPeople} className="search-form">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people..."
            />
            <button type="submit">Search</button>
          </form>

          {searchDone && (
            <div className="search-results">
              {searchResults.length === 0 ? (
                <p className="muted">
                  No people found. Try another username.
                </p>
              ) : (
                searchResults.map((user) => {
                  const id = getId(user);
                  const selected = selectedMembers.some(
                    (member) => getId(member) === id
                  );

                  return (
                    <div className="person-result" key={id}>
                      <div className="person-info">
                        <strong>
                          {user.username || user.email || `User ${id}`}
                        </strong>
                        {user.email && (
                          <small className="muted">{user.email}</small>
                        )}
                      </div>

                      <div className="person-actions">
                        <button
                          type="button"
                          className={selected ? "selected-button" : ""}
                          onClick={() => toggleGroupMember(user)}
                        >
                          {selected ? "Added ✓" : "Add"}
                        </button>

                        <button
                          type="button"
                          onClick={() => startDirectChat(user)}
                        >
                          Chat
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <button
            type="button"
            className="group-toggle"
            onClick={() => {
              setShowGroupForm((visible) => !visible);
              setError("");
              setNotice("");
            }}
          >
            {showGroupForm ? "Cancel" : "+ Create Group"}
          </button>

          {showGroupForm && (
            <form className="group-form" onSubmit={createGroup}>
              <h3>Create a group chat</h3>

              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Group name"
                maxLength={100}
                required
              />

              <p className="muted">
                Search for people above and press <strong>Add</strong> to select
                group members.
              </p>

              <p className="selected-count">
                Selected members: <strong>{selectedMembers.length}</strong>
              </p>

              {selectedMembers.length > 0 && (
                <div className="selected-members">
                  {selectedMembers.map((member) => (
                    <button
                      type="button"
                      key={getId(member)}
                      className="member-chip"
                      onClick={() => toggleGroupMember(member)}
                      title="Click to remove"
                    >
                      {member.username || member.email} ×
                    </button>
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || selectedMembers.length === 0}
              >
                {loading ? "Creating..." : "Create Group"}
              </button>

              {selectedMembers.length === 0 && (
                <small className="muted">
                  Add at least one person before creating the group.
                </small>
              )}
            </form>
          )}
        </section>

        <section className="conversation-list">
          <h2>Conversations</h2>

          {conversations.length === 0 ? (
            <p className="muted">
              No conversations yet. Search for someone to start.
            </p>
          ) : (
            conversations.map((conversation) => (
              <button
                type="button"
                className={`conversation-item ${
                  Number(activeConversation?.id) === Number(conversation.id)
                    ? "active"
                    : ""
                }`}
                key={conversation.id}
                onClick={() => openConversation(conversation)}
              >
                <span className="conversation-avatar">
                  {(conversationTitle(conversation).charAt(0) || "C").toUpperCase()}
                </span>

                <span className="conversation-details">
                  <strong>{conversationTitle(conversation)}</strong>
                  <small>
                    {conversation.type === "group"
                      ? "Group chat"
                      : "Open conversation"}
                  </small>
                </span>
              </button>
            ))
          )}
        </section>
      </aside>

      <section className="chat-panel">
        {!activeConversation ? (
          <div className="welcome-screen">
            <h1>Welcome to DevChat</h1>
            <p>Select a conversation or search for someone to get started.</p>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <div>
                <h2>{conversationTitle(activeConversation)}</h2>
                <small>
                  {activeConversation.type === "group"
                    ? "Group conversation"
                    : "Direct conversation"}
                </small>
              </div>
            </header>

            <div className="messages-panel">
              {messages.length === 0 ? (
                <p className="empty-messages">No messages yet. Say hello!</p>
              ) : (
                messages.map((message) => {
                  const mine =
                    Number(message.sender_id) === Number(me?.id);

                  return (
                    <div
                      className={`message-row ${mine ? "mine" : "theirs"}`}
                      key={message.id}
                    >
                      <article className="message-bubble">
                        {!mine && (
                          <small className="message-sender">
                            {message.sender_username || "User"}
                          </small>
                        )}

                        {message.content && <p>{message.content}</p>}

                        {message.image_url && (
                          <a
                            href={imageSource(message.image_url)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              className="message-image"
                              src={imageSource(message.image_url)}
                              alt="Shared image"
                              loading="lazy"
                            />
                          </a>
                        )}

                        <small className="message-time">
                          {message.created_at
                            ? new Date(message.created_at).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" }
                              )
                            : ""}
                          {mine && Number(message.is_read) === 1 && " · Read"}
                        </small>
                      </article>
                    </div>
                  );
                })
              )}

              {typingUsers.length > 0 && (
                <p className="typing-indicator">Someone is typing...</p>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="composer-area">
              <form className="message-form" onSubmit={sendMessage}>
                <input
                  value={messageText}
                  onChange={(event) => {
                    setMessageText(event.target.value);
                    sendTyping();
                  }}
                  placeholder="Type a message..."
                />

                <button type="submit" disabled={!messageText.trim()}>
                  Send
                </button>
              </form>

              <form className="image-form" onSubmit={sendImage}>
                <input
                  id="devchat-image-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) =>
                    setImageFile(event.target.files?.[0] || null)
                  }
                />

                <button type="submit" disabled={!imageFile || loading}>
                  {loading ? "Uploading..." : "Send image"}
                </button>
              </form>
            </div>
          </>
        )}
      </section>

      {(error || notice) && (
        <div className={error ? "toast error-toast" : "toast success-toast"}>
          <span>{error || notice}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
