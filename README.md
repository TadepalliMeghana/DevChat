# DevChat 💬

A real-time chat application built with **React, Node.js, Express.js, Socket.IO, and MySQL**. DevChat allows users to log in, view conversations, access previous messages, and send messages with persistent database storage.

## ✨ Features

- User login and authentication
- Conversation list and chat interface
- Loading chat history from MySQL
- Sending and receiving messages
- Persistent message storage
- Real-time communication using Socket.IO

## 🛠️ Tech Stack

| Area | Technologies |
|---|---|
| Frontend | React, Vite, JavaScript, CSS |
| Backend | Node.js, Express.js |
| Real-time communication | Socket.IO |
| Authentication | JWT |
| Database | MySQL |
| Deployment | Render, Aiven MySQL |
| Version control | Git, GitHub |

## 📁 Project Structure

```text
DevChat/
├── client/        # React + Vite frontend
├── server/        # Node.js + Express backend
├── .gitignore
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js and npm
- MySQL database
- Git

### 1. Clone the repository

```bash
git clone https://github.com/TadepalliMeghana/DevChat.git
cd DevChat
```

### 2. Configure and start the backend

```bash
cd server
npm install
```

Create a `.env` file in the `server` directory and configure the environment variables required by the backend, including the database connection settings and JWT secret.

Use the variable names expected by your server code. Keep credentials and secrets private.

Start the backend:

```bash
npm start
```

If your project uses a development script, you can use `npm run dev` instead.

### 3. Configure and start the frontend

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

Configure the frontend to use the correct backend API URL for your environment.

### 4. Open the application

- **Frontend:** http://localhost:5173/
- **Backend:** http://localhost:5000

These addresses are for local development. Keep the required servers running while testing the application.

## 🗄️ Database Configuration

DevChat uses MySQL to store application data, including messages and other records defined by the database schema.

For local development:

1. Set up a MySQL database.
2. Configure the backend's database connection settings.
3. Import the required schema or database backup into your local database.

For production, configure the backend to connect to your Aiven MySQL instance using the connection details and SSL settings required by your service.

**Never commit database backups, passwords, private keys, certificates containing secrets, or `.env` files.**

## ☁️ Deployment

The planned deployment setup is:

- **Backend hosting:** Render
- **Managed database:** Aiven MySQL

For deployment:

1. Configure the backend environment variables in Render.
2. Set up the production MySQL connection and required SSL configuration.
3. Configure the frontend to use the deployed backend URL instead of `localhost`.
4. Configure CORS and any authentication settings required for the production frontend.
5. Test login, conversations, message delivery, and message persistence after deployment.

Public deployment links should be added here once the frontend and backend URLs have been verified.

## 🧪 Tested Workflows

The following workflows have been tested locally:

- Logging in with an existing account
- Viewing the chat list
- Loading previous messages
- Sending messages
- Refreshing the page and confirming messages persist

## 🔐 Security Practices

- Store credentials in environment variables.
- Keep `.env` files and database backups out of Git.
- Use a strong JWT secret.
- Use HTTPS in production.
- Validate authentication and authorization on protected routes.
- Configure database access and CORS appropriately for deployment.

## 👩‍💻 Author

**Meghana Tadepalli**

- GitHub: [TadepalliMeghana](https://github.com/TadepalliMeghana)
- Repository: [DevChat](https://github.com/TadepalliMeghana/DevChat)

---

If you find this project useful, consider giving the repository a ⭐.
