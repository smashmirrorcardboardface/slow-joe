# Troubleshooting Guide

## Kraken API "Invalid Key" Error

If you see `EAPI:Invalid key` error, check the following:

### 1. Verify API Key Format

Your API keys should be in `backend/.env`:
```bash
KRAKEN_API_KEY=your_key_here
KRAKEN_API_SECRET=your_secret_here
```

**Common issues:**
- ❌ Extra spaces before/after the key
- ❌ Line breaks in the middle of the key
- ❌ Missing quotes (don't add quotes, just the key itself)
- ❌ Copy-paste errors (missing characters)

**Correct format:**
```bash
KRAKEN_API_KEY=kQH5HW/8f1/8f1/8f1/8f1/8f1/8f1/8f1
KRAKEN_API_SECRET=8f1/8f1/8f1/8f1/8f1/8f1/8f1/8f1+8f1/8f1/8f1/8f1/8f1/8f1/8f1/8f1
```

### 2. Verify API Key Permissions

Go to Kraken → Settings → Security → API and check your key has:
- ✅ **Query Funds** enabled
- ✅ **Create & Modify Orders** enabled
- ✅ **Query Open Orders & Trades** enabled

### 3. Check if Key is Active

- Make sure the API key hasn't been deleted/revoked
- Check if there's an IP restriction blocking your server
- Verify the key hasn't expired

### 4. Restart Backend After Changes

After updating `.env`:
```bash
# Stop the backend (Ctrl+C)
# Then restart:
cd backend
npm run start:dev
```

### 5. Test API Connection

You can test your API keys manually:
```bash
# Install curl if needed
curl -X POST https://api.kraken.com/0/private/Balance \
  -H "API-Key: YOUR_API_KEY" \
  -H "API-Sign: YOUR_SIGNATURE" \
  -d "nonce=$(date +%s)"
```

(Note: This requires generating the signature correctly - easier to test via the bot)

### 6. Common Solutions

**Solution 1: Regenerate API Key**
1. Go to Kraken → Settings → Security → API
2. Delete the old key
3. Create a new key with correct permissions
4. Update `.env` with new credentials
5. Restart backend

**Solution 2: Check for Hidden Characters**
```bash
# View .env file with visible characters
cat -A backend/.env | grep KRAKEN
```

Remove any `^M` (carriage returns) or extra spaces.

**Solution 3: Verify Environment Variables**
The backend reads from `.env` file. Make sure:
- File is named exactly `.env` (not `.env.example`)
- File is in the `backend/` directory
- No syntax errors in the file

### 7. Debug Mode

To see more detailed error messages, check the backend logs. The error should show:
- Exact API error code
- Which endpoint failed
- Any additional error details

### Still Not Working?

1. **Double-check on Kraken dashboard** that the key exists and is active
2. **Try creating a new API key** with minimal permissions first
3. **Check backend logs** for more specific error messages
4. **Verify your IP** isn't blocked (if IP restrictions are set)

## Other Common Issues

### Balance Shows as $0.00

- **Cause**: Reconcile job failed or hasn't run yet
- **Solution**: Click "Reconcile Balance" button in dashboard
- **Check**: Backend logs for reconcile errors

### Signals Not Generating

- **Cause**: Not enough historical data or exchange connection issue
- **Solution**: Wait for next cadence period (6 hours default)
- **Check**: Backend logs for signal poller errors

### Trades Not Executing

- **Cause**: Insufficient balance, wrong permissions, or strategy disabled
- **Solution**: 
  - Check balance is above MIN_BALANCE_USD
  - Verify API key has "Create & Modify Orders" permission
  - Ensure strategy is enabled in dashboard

