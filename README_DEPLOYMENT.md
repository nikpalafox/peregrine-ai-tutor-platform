# Quick Deploy to Vercel

## 🚀 One-Command Deploy

```bash
vercel
```

## 📋 Pre-Deployment Checklist

- [ ] Set up environment variables in Vercel dashboard:
  - `OPENAI_API_KEY`
  - `SECRET_KEY`
  - `ALGORITHM` (optional, defaults to HS256)
  - `ACCESS_TOKEN_EXPIRE_MINUTES` (optional, defaults to 60)

## 🔧 Manual Setup

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Login:**
   ```bash
   vercel login
   ```

3. **Deploy:**
   ```bash
   vercel --prod
   ```

## 📝 Environment Variables

Add these in Vercel Dashboard → Project Settings → Environment Variables:

```
OPENAI_API_KEY=sk-...
SECRET_KEY=your-strong-secret-key-here
```

## 📖 Full Documentation

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

