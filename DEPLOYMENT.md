# Deployment Guide for Vercel

This guide will help you deploy the Peregrine AI Tutor Platform to Vercel.

## Prerequisites

1. A Vercel account (sign up at [vercel.com](https://vercel.com))
2. Vercel CLI installed (`npm i -g vercel`)
3. OpenAI API key

## Step 1: Prepare Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
OPENAI_API_KEY=your_openai_api_key_here
SECRET_KEY=your_secret_key_here_generate_a_strong_one
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

**Important:** Never commit the `.env` file to git. It's already in `.gitignore`.

## Step 2: Install Dependencies

The project uses Python dependencies. Vercel will automatically install them from `api/requirements.txt` during deployment.

## Step 3: Deploy to Vercel

### Option A: Using Vercel CLI

1. Install Vercel CLI (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy:
   ```bash
   vercel
   ```

4. Follow the prompts:
   - Link to existing project or create new
   - Set up environment variables when prompted

### Option B: Using Vercel Dashboard

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your Git repository
3. Configure the project:
   - **Framework Preset:** Other
   - **Root Directory:** (leave as root)
   - **Build Command:** (leave empty)
   - **Output Directory:** (leave empty)

4. Add Environment Variables:
   - Go to Project Settings → Environment Variables
   - Add the following:
     - `OPENAI_API_KEY` = your OpenAI API key
     - `SECRET_KEY` = a strong random secret key
     - `ALGORITHM` = `HS256`
     - `ACCESS_TOKEN_EXPIRE_MINUTES` = `60`

5. Deploy!

## Step 4: Set Up Vercel Postgres (Recommended for Production)

**Important:** Without Vercel Postgres, user data will be lost on serverless function cold starts. For production, you must set up Vercel Postgres.

### Option A: Using Vercel Dashboard

1. Go to your project on [vercel.com](https://vercel.com)
2. Navigate to **Storage** → **Create Database** → **Postgres**
3. Choose a plan (Hobby plan is free for development)
4. Create the database
5. Vercel will automatically add the `POSTGRES_URL` environment variable to your project
6. The connection string will be available in **Storage** → **Your Database** → **.env.local**

### Option B: Using Vercel CLI

1. Install Vercel CLI (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. Create a Postgres database:
   ```bash
   vercel postgres create
   ```

3. Link the database to your project:
   ```bash
   vercel postgres link
   ```

4. The `POSTGRES_URL` environment variable will be automatically added to your project

### Verify Postgres Connection

After setting up Vercel Postgres:

1. The `POSTGRES_URL` environment variable should be automatically available
2. The application will automatically detect and use Postgres when `POSTGRES_URL` is present
3. Database tables will be created automatically on first deployment
4. User data will persist across deployments and cold starts

**Note:** The application will fall back to in-memory SQLite if `POSTGRES_URL` is not set, but this is **not recommended for production** as data will be lost.

## Step 5: Verify Deployment

After deployment, Vercel will provide you with a URL like:
`https://your-project-name.vercel.app`

1. Visit the URL
2. Test the login/registration
3. Test book generation
4. Check the API docs at `/api/docs` (if FastAPI docs are enabled)

## Project Structure for Vercel

```
/
├── api/
│   ├── index.py          # Serverless function handler
│   └── requirements.txt  # Python dependencies
├── backend/              # Backend code (imported by api/index.py)
├── frontend/             # Static frontend files
├── vercel.json          # Vercel configuration
└── .vercelignore        # Files to ignore during deployment
```

## How It Works

1. **API Routes** (`/api/*`): Handled by `api/index.py` which wraps the FastAPI backend
2. **Static Files**: Served from the `frontend/` directory
3. **Environment Variables**: Loaded from Vercel's environment settings

## Troubleshooting

### API Not Working

- Check that environment variables are set in Vercel dashboard
- Verify `OPENAI_API_KEY` is correct
- Check Vercel function logs for errors

### Frontend Not Loading

- Ensure `frontend/` directory structure is correct
- Check that HTML files are in `frontend/` directory
- Verify routes in `vercel.json`

### Database Issues

**Note:** The application now supports Vercel Postgres for persistent data storage. See the "Setting Up Vercel Postgres" section below.

If you're still experiencing database issues:

1. Verify `POSTGRES_URL` is set in Vercel environment variables
2. Check that `psycopg2-binary` is in `api/requirements.txt`
3. Review Vercel function logs for database connection errors

### CORS Issues

CORS is configured in `backend/main.py` to allow all origins. For production, update:

```python
allow_origins=["https://your-domain.vercel.app"]
```

## Environment Variables Reference

| Variable | Description | Required | Auto-Configured |
|----------|-------------|----------|----------------|
| `OPENAI_API_KEY` | Your OpenAI API key | Yes | No |
| `SECRET_KEY` | Secret key for JWT tokens | Yes | No |
| `POSTGRES_URL` | Vercel Postgres connection string | Yes (for production) | Yes (when Postgres is created) |
| `ALGORITHM` | JWT algorithm (default: HS256) | No | No |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token expiration time | No | No |

## Production Considerations

1. **Database**: ✅ **Vercel Postgres is now configured** - Ensure `POSTGRES_URL` is set in production
2. **CORS**: Restrict CORS to your domain only
3. **Rate Limiting**: Add rate limiting to prevent abuse
4. **Monitoring**: Set up error tracking (Sentry, etc.)
5. **Caching**: Use Vercel KV for caching frequently accessed data

## Support

For issues with deployment, check:
- Vercel function logs in the dashboard
- Browser console for frontend errors
- Network tab for API request/response details

