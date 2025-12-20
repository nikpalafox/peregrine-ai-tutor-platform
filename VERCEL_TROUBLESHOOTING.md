# Vercel 404 Troubleshooting

## Current Issue
Getting 404 NOT_FOUND errors in deployment.

## Possible Causes

1. **Static files not found**: Vercel might not be finding files in `frontend/` directory
2. **API handler not working**: The serverless function might not be set up correctly
3. **Path routing issues**: Rewrites might not be matching correctly

## Solutions to Try

### Option 1: Move frontend to public directory (Recommended)

Vercel serves static files from `public/` by default. Try this:

```bash
# Create public directory and copy frontend files
mkdir -p public
cp -r frontend/* public/
```

Then update `vercel.json` to serve from `public/`:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.py",
      "use": "@vercel/python"
    }
  ],
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/index.py"
    },
    {
      "source": "/:path*",
      "destination": "/:path*"
    }
  ]
}
```

### Option 2: Check which URL is failing

1. Is it the root `/`?
2. Is it an API call like `/api/students`?
3. Is it a static file like `/js/api.js`?

Check the Vercel deployment logs to see which specific request is returning 404.

### Option 3: Verify API handler

Check if the API handler is working by:
1. Looking at Vercel function logs
2. Testing `/api/docs` endpoint (FastAPI docs)
3. Checking environment variables are set

### Option 4: Simplify configuration

Try this minimal `vercel.json`:

```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/index.py"
    }
  ]
}
```

And move frontend files to `public/` directory.

## Next Steps

1. Check Vercel deployment logs to see which specific request is 404
2. Try moving frontend files to `public/` directory
3. Verify environment variables are set in Vercel dashboard
4. Test the API endpoint directly: `https://your-app.vercel.app/api/docs`

