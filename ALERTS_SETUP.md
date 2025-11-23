# Alert System Setup Guide

The Slow Joe trading bot includes an email alert system to notify you of critical events.

## Quick Setup

### 1. Enable Alerts

In your `backend/.env` file, set:

```bash
ALERTS_ENABLED=true
ALERTS_EMAIL_ENABLED=true
ALERTS_EMAIL_RECIPIENTS=your-email@example.com
```

### 2. Configure SMTP

Choose your email provider and configure SMTP settings:

#### Gmail Setup (Recommended for Testing)

1. **Enable 2-Factor Authentication** on your Google account
2. **Generate an App Password**:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Enter "Slow Joe Bot" as the name
   - Copy the generated 16-character password

3. **Add to `.env`**:
   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-16-char-app-password
   SMTP_SECURE=false
   SMTP_FROM=your-email@gmail.com
   ```

#### Outlook/Hotmail Setup

```bash
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=your-email@outlook.com
SMTP_PASSWORD=your-password
SMTP_SECURE=false
SMTP_FROM=your-email@outlook.com
```

#### SendGrid Setup

1. Create a SendGrid account at https://sendgrid.com
2. Generate an API key
3. Verify your sender email

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_FROM=your-verified-sender@example.com
```

#### Mailgun Setup

1. Create a Mailgun account at https://www.mailgun.com
2. Get your SMTP credentials from the dashboard

```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=your-mailgun-username
SMTP_PASSWORD=your-mailgun-password
SMTP_FROM=your-verified-sender@example.com
```

### 3. Configure Alert Thresholds

Set when alerts should trigger:

```bash
# Alert when balance drops below this amount (USD)
ALERTS_LOW_BALANCE_USD=50

# Alert when drawdown exceeds this percentage
ALERTS_LARGE_DRAWDOWN_PCT=10
```

### 4. Configure Cooldown Periods

Prevent alert spam by setting cooldown periods (in minutes):

```bash
# How long to wait before sending another alert of the same type
ALERTS_COOLDOWN_ORDER_FAILURE=60      # 1 hour
ALERTS_COOLDOWN_EXCHANGE=30           # 30 minutes
ALERTS_COOLDOWN_LOW_BALANCE=1440      # 24 hours
ALERTS_COOLDOWN_DRAWDOWN=60           # 1 hour
ALERTS_COOLDOWN_JOB_FAILURE=60        # 1 hour
```

## Alert Types

The bot will send email alerts for:

1. **Order Failures** - When an order cannot be executed
2. **Exchange Unreachable** - When the exchange API is down or unreachable
3. **Low Balance** - When NAV drops below the threshold
4. **Large Drawdown** - When portfolio drawdown exceeds the threshold
5. **Health Check Failures** - When database, Redis, or exchange health checks fail

## Testing Alerts

To test if alerts are working:

1. **Check logs** - Look for "Email transporter initialized" in backend logs
2. **Trigger a test alert** - Temporarily set `ALERTS_LOW_BALANCE_USD` to a high value (e.g., 10000) to trigger a low balance alert
3. **Check alert history** - Visit `GET /api/alerts/history` endpoint (requires authentication)

## Troubleshooting

### Alerts Not Sending

1. **Check SMTP credentials** - Verify username, password, and host are correct
2. **Check firewall** - Ensure port 587 (or 465 for secure) is not blocked
3. **Check logs** - Look for SMTP errors in backend logs
4. **Test SMTP connection** - Use a tool like `telnet smtp.gmail.com 587` to verify connectivity

### Gmail "Less Secure App" Error

Gmail requires App Passwords (not your regular password). Follow the Gmail setup steps above.

### Too Many Alerts

Increase cooldown periods to reduce alert frequency:

```bash
ALERTS_COOLDOWN_ORDER_FAILURE=240  # 4 hours
ALERTS_COOLDOWN_LOW_BALANCE=2880   # 48 hours
```

### No Alerts Received

1. Check spam/junk folder
2. Verify `ALERTS_ENABLED=true` and `ALERTS_EMAIL_ENABLED=true`
3. Verify email recipients are correct (comma-separated)
4. Check backend logs for alert sending errors

## Alert History API

View alert history via API:

```bash
# Get recent alerts
GET /api/alerts/history?limit=50

# Get alerts by type
GET /api/alerts/by-type?type=ORDER_FAILURE&limit=50
```

Available alert types:
- `ORDER_FAILURE`
- `EXCHANGE_UNREACHABLE`
- `LOW_BALANCE`
- `LARGE_DRAWDOWN`
- `JOB_FAILURE`
- `HEALTH_CHECK_FAILED`

## Security Notes

- Never commit `.env` file to git (already in `.gitignore`)
- Use App Passwords for Gmail, not your main password
- Consider using a dedicated email account for bot alerts
- For production, use a professional email service (SendGrid, Mailgun)

