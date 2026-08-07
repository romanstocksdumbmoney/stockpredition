# Expense Tracker — Setup Guide

## Access the App Here:
## http://localhost:3000

## What This App Does
Upload photos of your receipts. AI reads them automatically
and pulls out the merchant, date, amount, and category.
Get weekly and monthly spending reports. Export to PDF or CSV.

## Where to Access the App
Once running, open your browser and go to:
http://localhost:3000

That is it. The app runs entirely on your computer.

---

## Step 1: Make Sure You Have Python and Node Installed

Check Python (need 3.9 or higher):
python --version

Check Node (need 18 or higher):
node --version

If you do not have them:
Python: https://www.python.org/downloads
Node: https://nodejs.org

---

## Step 2: Get Your OpenAI API Key (Required for Receipt Scanning)

The AI that reads your receipts uses OpenAI.

1. Go to https://platform.openai.com
2. Click Sign Up (free) or Log In
3. Click your name top right → View API Keys
4. Click Create new secret key
5. Copy the key — you only see it once
6. You will need to add $5 credit minimum to use the API:
   Click Billing → Add payment method → Add $5-10 to start
   Each receipt scan costs about $0.01 to $0.03
   So $5 will scan roughly 200-500 receipts

---

## Step 3: Set Up Your Environment File

Go into the backend folder:
cd expense-tracker/backend

Create a file called .env and paste this in,
filling in your actual OpenAI key:

OPENAI_API_KEY=paste_your_openai_key_here
SECRET_KEY=make_up_any_long_random_string_here_like_this_abc123xyz789
DATABASE_URL=sqlite:///expenses.db
UPLOAD_DIR=./uploads
APP_URL=http://localhost:3000

---

## Step 4: Install Backend Dependencies

In the backend folder run:
pip install fastapi uvicorn sqlalchemy python-multipart pillow openai python-jose bcrypt python-dotenv reportlab pandas aiofiles

---

## Step 5: Install Frontend Dependencies

Go into the frontend folder:
cd expense-tracker/frontend

Run:
npm install

---

## Step 6: Start the App

From the expense-tracker root folder run:
bash start.sh

OR start them separately:

Terminal 1 (backend):
cd backend
uvicorn main:app --reload --port 8000

Terminal 2 (frontend):
cd frontend
npm run dev

---

## Step 7: Open the App

Open your browser and go to:
http://localhost:3000

Create your account and upload your first receipt.

---

## Cost Estimates
100 receipts/month = roughly $1-3 in OpenAI API costs
The app itself is completely free and runs on your computer

## Troubleshooting
- "Module not found" error: run pip install again
- Port already in use: change the port number in the command
- OpenAI error: check your API key and make sure you have credit
- Image not scanning: make sure the photo is clear and well lit
