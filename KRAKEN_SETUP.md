# Kraken API Setup Guide

## Step-by-Step Instructions

### 1. Log into Kraken

Go to https://www.kraken.com and log into your account.

### 2. Navigate to API Settings

1. Click on your **profile/account menu** (usually top right)
2. Go to **Settings** → **Security**
3. Scroll down to **API** section
4. Click **"Generate API Key"** or **"Add API Key"**

### 3. Create API Key

Fill in the form:

**Key Name**: `Slow Joe Trading Bot` (or any descriptive name)

**Permissions**: Select these permissions:
- ✅ **Query Funds** (required - to check balances)
- ✅ **Create & Modify Orders** (required - to place trades)
- ✅ **Query Open Orders & Trades** (recommended - to check order status)
- ❌ **Withdraw Funds** (DO NOT enable - security best practice)
- ❌ **Query Ledger Entries** (optional - not needed)
- ❌ **Query Closed Orders & Trades** (optional - not needed)
- ❌ **Cancel/Close Trades** (optional - will be handled by bot)

**IP Access Restriction** (Optional but Recommended):
- Leave blank for testing, or add your server IP for production
- Format: `123.456.789.0/24` (CIDR notation)

### 4. Generate and Save Credentials

1. Click **"Generate API Key"**
2. **IMPORTANT**: Kraken will show you:
   - **API Key** (starts with something like `kQH5HW/8f1/...`)
   - **Private Key** (long string - you'll only see this once!)

3. **Copy both immediately** - the private key won't be shown again!

### 5. Add to Your .env File

Open `backend/.env` and add:

```bash
KRAKEN_API_KEY=your_api_key_here
KRAKEN_API_SECRET=your_private_key_here
```

**Example:**
```bash
KRAKEN_API_KEY=kQH5HW/8f1/8f1/8f1/8f1/8f1/8f1/8f1
KRAKEN_API_SECRET=8f1/8f1/8f1/8f1/8f1/8f1/8f1/8f1+8f1/8f1/8f1/8f1/8f1/8f1/8f1/8f1
```

### 6. Security Best Practices

⚠️ **Important Security Notes:**

1. **Never share your API keys** - treat them like passwords
2. **Don't commit .env to git** - it's already in .gitignore
3. **Use minimal permissions** - only enable what's needed
4. **Disable withdrawal** - never enable withdrawal permission
5. **Use IP restrictions** in production
6. **Rotate keys periodically** - delete old keys when creating new ones

### 7. Test Your API Keys

After adding to `.env`, restart your backend and check logs:

```bash
cd backend
npm run start:dev
```

Look for any authentication errors. If you see connection errors, verify:
- API key format is correct (no extra spaces)
- Private key is complete (they're long!)
- Permissions are set correctly

### 8. For Paper Trading (Recommended First)

**Option A: Kraken Sandbox** (if available)
- Some exchanges offer sandbox/testnet environments
- Use sandbox credentials for testing
- Check Kraken's documentation for sandbox availability

**Option B: Start Small**
- Fund account with minimal amount (£50-£100)
- Set `MIN_BALANCE_USD=20` in `.env`
- Monitor closely for first few days

## Troubleshooting

### "Invalid API-Key" Error
- Check that API key is copied correctly (no extra spaces)
- Verify key hasn't been deleted/revoked on Kraken
- Ensure you're using the full key (they're long strings)

### "Invalid signature" Error
- Check that private key (API_SECRET) is correct
- Ensure no extra spaces or line breaks
- Verify the key wasn't truncated when copying

### "Insufficient permissions" Error
- Go back to Kraken API settings
- Verify "Create & Modify Orders" is enabled
- Verify "Query Funds" is enabled
- Regenerate key if needed

### "Rate limit" Error
- Kraken has rate limits on API calls
- The bot respects these automatically
- If you see frequent rate limit errors, increase cadence (CADENCE_HOURS)

## Verification Checklist

Before going live, verify:

- [ ] API key created with correct permissions
- [ ] API key and secret added to `.env` file
- [ ] `.env` file is NOT committed to git
- [ ] Withdrawal permission is DISABLED
- [ ] Backend starts without authentication errors
- [ ] Test with small amount first
- [ ] Emergency stop toggle works in dashboard

## Revoking API Keys

If you need to revoke a key:

1. Go to Kraken → Settings → Security → API
2. Find your API key
3. Click **Delete** or **Revoke**
4. Update `.env` with new credentials if creating replacement

## Additional Resources

- Kraken API Documentation: https://docs.kraken.com/rest/
- Kraken Support: https://support.kraken.com

