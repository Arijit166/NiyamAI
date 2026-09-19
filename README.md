# 📘 NiyamAI

**NiyamAI** is an AI-powered compliance and enforcement intelligence platform designed to help teams manage inspections, compliance workflows, enforcement mapping, company onboarding, product-level monitoring, and risk analysis from a single dashboard.

The platform combines modern web application workflows with **AI-assisted extraction, rule evaluation, and document-driven compliance review** for regulatory and operational use cases.

## ✨ Features

* 🤖 AI-assisted inspection and compliance workflows
* 🔐 Secure authentication with NextAuth and Google OAuth
* 👥 Role-based access for officers, admins, compliance heads, and product managers
* 🏢 Company and user onboarding with approval workflows
* ✉️ Invitation-based user registration and verification codes
* 🗺️ Enforcement map and analytics dashboard
* 📊 Risk and compliance analysis views
* 📦 Product and manager management for compliance programs
* 📄 PDF/report generation for inspection outcomes
* 🗄️ MongoDB-backed data persistence
* 📧 SMTP email notifications for invitations and approvals
* ☁️ Local and cloud-ready deployment with Next.js

## 🛠️ Tech Stack

* **Next.js 16**
* **React 19**
* **TypeScript**
* **MongoDB + Mongoose**
* **NextAuth v4**
* **Nodemailer**
* **Tailwind CSS**
* **Recharts / React Simple Maps**
* **@xenova/transformers** for local AI inference support

## 📋 Prerequisites

Before running this project, make sure you have:

* Node.js **18+** or newer
* npm, pnpm, or yarn installed
* MongoDB instance running locally or on MongoDB Atlas
* Google OAuth application credentials
* SMTP email service credentials for account emails

## 🔑 Environment Variables

Create a `.env.local` file in the project root and add the following values:

```bash
# App
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret_here

# MongoDB
MONGODB_URI=mongodb://localhost:27017/niyamai
# or mongodb+srv://<username>:<password>@<cluster>.mongodb.net/niyamai

# Google Authentication
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Admin access
ADMIN_PASSKEY=your_admin_passkey

# SMTP / Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@example.com
SMTP_PASS=your_email_password_or_app_password
MAIL_FROM=your_email@example.com
```

### 📝 Notes

* `NEXTAUTH_SECRET` should be a long, random secret string.
* `MONGODB_URI` must point to the database used by the application.
* `ADMIN_PASSKEY` is used for admin onboarding and role-assignment flows.
* For Gmail, it is recommended to use an **App Password** instead of your normal account password.
* If you are using Google OAuth, configure the redirect URIs in Google Cloud Console to match your application domain.

## 📦 Installation

```bash
npm install
# or
pnpm install
```

## ▶️ Running the Project

### Development

```bash
npm run dev
# or
pnpm dev
```

The application will be available at:

```text
http://localhost:3000
```

### Production

Build the application:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

## 🏛️ Project Overview

NiyamAI is built for **compliance-driven organizations and regulatory enforcement teams** that need a reliable system for:

* Validating compliance documentation
* Tracking inspections and enforcement workflows
* Approving onboarding and role-based access
* Generating reports for internal and external review
* Managing product compliance responsibilities across teams
* Enabling AI-assisted extraction from uploaded compliance-related records

## 📄 License

This project is licensed under the **Apache License 2.0**.

See the [`LICENSE`](LICENSE) file for details.

## 🤝 Contributing

Contributions, bug reports, and feature suggestions are welcome.

Pull requests are also welcome.

To contribute:

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Commit and push your changes.
5. Open a pull request with a clear description of your contribution.
