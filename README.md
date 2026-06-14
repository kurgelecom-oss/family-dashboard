# 🏠 Yilmaz Family Dashboard — Module 1: Shell

The base dashboard shell. All modules plug into this. Currently showing placeholder panels.

## Stack
- **Framework:** Next.js 15 (App Router)
- **Styling:** CSS Variables + styled-jsx
- **Deploy:** Netlify

## Local Development

```bash
npm install
npm run dev
```
Open http://localhost:3000

## Deploy to Netlify (Step by Step)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "feat: Module 1 — Dashboard Shell"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/family-dashboard.git
git push -u origin main
```

### 2. Connect to Netlify
1. Go to netlify.com → Add new site → Import from Git
2. Select your GitHub repo
3. Build settings are auto-detected from netlify.toml:
   - Build command: `npm run build`
   - Publish directory: `.next`
4. Click Deploy

### 3. Install Netlify Next.js Plugin
In Netlify dashboard → Plugins → search "Next.js" → install `@netlify/plugin-nextjs`

### 4. Set Domain (optional)
Netlify → Domain settings → Add custom domain

## Panel Layout

```
┌─────────────┬─────────────┬─────────────┐
│  Habits     │  Ecom       │  Budget     │
│  (Module 2) │  (Module 3) │  (Module 4) │
├─────────────┴─────────────┼─────────────┤
│  Goals & Countdowns       │  Calendar   │
│  (Module 5)               │  (Module 6) │
└───────────────────────────┴─────────────┘
```

## What's Next
Once shell is live on Netlify, move to Module 2: Ansar Daily Habit Form (Tally).
