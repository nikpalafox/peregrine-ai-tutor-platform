# Debugging Vercel 404 Error

## Which URL is returning 404?

To debug, check which specific URL is failing:

1. **Root URL** (`/`): Should serve `public/index.html`
2. **API endpoint** (`/api/...`): Should be handled by `api/index.py`
3. **Static files** (`/js/api.js`, etc.): Should be served from `public/`

## Check Vercel Deployment Logs

1. Go to Vercel Dashboard → Your Project → Deployments
2. Click on the latest deployment
3. Check the "Functions" tab for API errors
4. Check the "Logs" tab for any import errors

## Common Issues

### 1. API Handler Import Error
If the API handler fails to import, check:
- Are all dependencies in `api/requirements.txt`?
- Is `mangum` installed?
- Are there any import errors in the logs?

### 2. Static Files Not Found
If static files return 404:
- Ensure `public/` directory exists
- Ensure files are committed to git
- Check that `public/` is not in `.gitignore`

### 3. Root URL 404
If `/` returns 404:
- Vercel should automatically serve `public/index.html`
- Check that `public/index.html` exists
- Try accessing `/index.html` directly

## Quick Test

Try these URLs after deployment:
- `https://your-app.vercel.app/` - Should show login page
- `https://your-app.vercel.app/api/docs` - Should show FastAPI docs (if API works)
- `https://your-app.vercel.app/js/api.js` - Should return the JS file

## Next Steps

1. Check Vercel function logs for import errors
2. Verify environment variables are set
3. Test each URL individually
4. Check if `public/` directory is in your git repository

