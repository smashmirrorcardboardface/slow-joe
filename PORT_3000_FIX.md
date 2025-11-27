# Port 3000 Conflict Fix

## Why This Happens

NestJS watch mode sometimes doesn't properly kill the old process when restarting, leaving multiple instances running and causing port conflicts.

## Quick Fix

Run this command to kill all backend processes:

```bash
cd backend
npm run kill
```

Or manually:
```bash
pkill -f "nest start --watch"
lsof -ti:3000 | xargs kill -9
```

## Prevention

### Option 1: Use the kill script before starting
```bash
cd backend
npm run kill  # Kill any existing processes
npm run start:dev  # Start fresh
```

### Option 2: Use a process manager (Recommended for production)

Install `pm2`:
```bash
npm install -g pm2
```

Then use:
```bash
cd backend
pm2 start npm --name "slow-joe-backend" -- run start:dev
pm2 logs slow-joe-backend  # View logs
pm2 stop slow-joe-backend   # Stop
pm2 restart slow-joe-backend # Restart
```

### Option 3: Check before starting

Add this to your workflow:
```bash
# Before starting
lsof -ti:3000 && echo "Port in use - run: npm run kill" || npm run start:dev
```

## Root Cause

NestJS watch mode uses file watching to restart on changes. Sometimes:
1. The old process doesn't terminate cleanly
2. Multiple terminals start the same process
3. The process crashes but the port isn't released immediately

The `kill` script handles all these cases.

