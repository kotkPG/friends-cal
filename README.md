# Friends Calendar

A beginner-friendly full-stack starter for a web app where friends can find the best weekend meetup times.

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Login: Google Sign-In (ID token verification)
- Next planned cloud services: Firestore, Cloud Run, Firebase Hosting, Google Calendar API

## Project Structure

- `frontend/` - user interface
- `backend/` - API server

## 1) Open in VS Code

1. Open this folder in VS Code.
2. Open a terminal in VS Code (`Terminal > New Terminal`).
3. If PowerShell blocks `npm`, use `npm.cmd` and `npx.cmd` commands.

## 2) Configure environment files

1. In `frontend/`, copy `.env.example` to `.env`.
2. In `backend/`, copy `.env.example` to `.env`.
3. Paste your Google OAuth Web Client ID in both files.
4. For durable cloud storage, enable Firestore in `backend/.env`:

```env
USE_FIRESTORE=true
FIRESTORE_PROJECT_ID=<YOUR_GCP_PROJECT_ID>
FIRESTORE_NAMESPACE=friends-cal
```

5. In cloud deploys, attach a service account with Firestore permissions (or set `GOOGLE_APPLICATION_CREDENTIALS`).

## 3) Run backend

From the root folder:

```powershell
cd backend
npm.cmd run dev
```

Backend starts on `http://localhost:8080`.

## 4) Run frontend

Open a second terminal from the root folder:

```powershell
cd frontend
npm.cmd run dev
```

Frontend starts on `http://localhost:5173`.

## 5) Test what is working now

1. Open `http://localhost:5173`.
2. Confirm backend status shows connected.
3. Click Google Sign-In.
4. App sends the Google token to backend for verification.

## 6) GitHub workflow (first commit)

From root folder:

```powershell
git init
git add .
git commit -m "chore: scaffold friends calendar frontend and backend"
```

Then create a GitHub repo and connect it:

```powershell
git remote add origin <YOUR_GITHUB_REPO_URL>
git branch -M main
git push -u origin main
```

## 7) Beginner next steps

1. Add Firestore to store users and groups.
2. Add Google Calendar API consent and read events.
3. Let users pick share tags/rules.
4. Convert selected events into busy blocks.
5. Build overlap suggestion logic for weekends.
6. Deploy backend to Cloud Run and frontend to Firebase Hosting.
