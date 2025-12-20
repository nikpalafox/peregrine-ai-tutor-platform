# Check Vercel Function Logs

Since the function `/api/index.py` is detected by Vercel, the 404 is likely due to:

## 1. Check Function Logs

Go to Vercel Dashboard → Your Project → Latest Deployment → **Functions** tab

Look for:
- Import errors (missing dependencies)
- Runtime errors
- Any Python tracebacks

Common errors:
- `ModuleNotFoundError` - Missing dependency in `api/requirements.txt`
- `ImportError` - Can't find `main` module
- `AttributeError` - Handler not exported correctly

## 2. Test the API Directly

Try accessing:
- `https://your-app.vercel.app/api/docs` - FastAPI docs
- `https://your-app.vercel.app/api/health` - If you have a health endpoint

If these also return 404, the handler is failing to execute.

## 3. Check Static Files

Try accessing:
- `https://your-app.vercel.app/index.html`
- `https://your-app.vercel.app/js/api.js`

If these work but `/` doesn't, it's a routing issue.

## 4. Common Fixes

If you see import errors in logs:
1. Ensure all dependencies are in `api/requirements.txt`
2. Check that `mangum` is listed
3. Verify Python version matches (3.9)

If handler export error:
- The handler should be exported as `handler` (which we're doing)
- Make sure there are no syntax errors in `api/index.py`

