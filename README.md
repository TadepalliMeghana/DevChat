# DevChat 💬

A real-time chat application built with React, Node.js, Express, Socket.IO, and MySQL. DevChat supports user authentication, conversations, message history, and sending messages.

## ✨ Features

- User login and authentication
- Chat list and existing conversations
- Loading previous messages
- Sending and receiving chat messages
- Persistent message storage using MySQL
- Real-time communication using Socket.IO

## 🛠️ Tech Stack

**Frontend**
- React
- Vite
- JavaScript
- CSS

**Backend**
- Node.js
- Express.js
- Socket.IO
- JWT authentication

**Database**
- MySQL

**Deployment**
- Render for backend hosting
- Aiven for managed MySQL hosting

## 📁 Project Structure

```text
DevChat/
├── client/          # React + Vite frontend
├── server/          # Node.js + Express backend
├── .gitignore
└── README.md
```

## 🚀 Run Locally

### Prerequisites

- Node.js and npm
- MySQL database
- Git

### 1. Clone the repository

```bash
git clone https://github.com/TadepalliMeghana/DevChat.git
cd DevChat
```

### 2. Configure the backend

```bash
cd server
npm install
```

Create a `.env` file using the environment variable names expected by your backend code. Configure your database credentials, JWT secret, and other required settings.

Never commit your `.env` file or database credentials.

Start the backend using the script configured in `server/package.json`:

```bash
npm start
```

### 3. Configure the frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

### 4. Open DevChat

- Frontend: http://localhost:5173/
- Backend: http://localhost:5000

Keep both development servers running while using the application.

## 🗄️ Database

DevChat uses MySQL to store application data, including chat messages and other records defined by the database schema.

For local development, configure a MySQL database and import your database schema or backup.

For production, configure the backend to connect securely to your hosted MySQL instance on Aiven using the connection details provided by Aiven.

Do not commit database dumps, passwords, private keys, or production credentials.

## ☁️ Deployment

- **Backend:** Render
- **Database:** Aiven MySQL

Set the required environment variables in the Render service settings. Configure the production database connection and ensure the frontend uses the deployed backend URL rather than `localhost`.

Deployment URLs can be added here once the public DevChat services are verified.

## 🔐 Security

- Keep secrets in environment variables.
- Do not commit `.env` files or SQL database backups.
- Use a strong JWT secret.
- Use HTTPS for production traffic.
- Validate authentication and authorization on protected API routes.

## 🧪 Testing

The following core workflows have been tested locally:

- Login with an existing account
- Viewing the chat list
- Loading previous messages
- Sending new messages
- Refreshing the page and verifying message persistence

## 👩‍💻 Author

**Meghana Tadepalli**

GitHub: [TadepalliMeghana](https://github.com/TadepalliMeghana)

---

If you find this project useful, consider giving the repository a ⭐.
