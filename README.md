# Multi-Touch Attribution Library

A lightweight JavaScript library for tracking user journeys and attribution data across multiple touchpoints before signup or login.

## Features

- Accurately tracks user journeys across devices and sessions
- Provides cleaner attribution for marketing & analytics
- Enables better decision-making with BigQuery insights

- Multitouch package via GTM – deployed to both sites
- Page views & UTM data stored in localStorage (mt_event_history)
- Latest attribution touchpoint saved in cookies (mt_current_attribution)
- Attribution data sent to Supabase via Xano APIs
- Data piped from Supabase to BigQuery using Fivetran

## Installation

```bash
npm install @deriv-com/multitouch-attribution
```

## Quick Start

```javascript
import UserJourneyTracker from '@deriv-com/multitouch-attribution';

// Initialize the tracker
const tracker = new UserJourneyTracker({
    cookieDomain: '.yourdomain.com',
    autoTrack: true,
});

tracker.init();

// Record user signup
tracker.recordSignup('user123');

// Get tracked events
const events = tracker.getEvents();
```

## Configuration

```javascript
const options = {
    cookieDomain: '.example.com', // Domain for cross-subdomain tracking
    cookieExpireDays: 365, // Cookie expiration (default: 365 days)
    maxEvents: 100, // Maximum events to store (default: 100)
    autoTrack: true, // Auto-track page views (default: true)
    attributionExpiry: 365 * 24 * 60, // Attribution data expiry in minutes
};
```

## API Methods

- `init()` - Initialize tracking
- `trackPageView(url?, title?)` - Manually track page view
- `recordLogin(userId)` - Record user login
- `recordSignup(userId)` - Record user signup
- `getEvents()` - Get all tracked events
- `clearEvents()` - Clear all events

## What It Tracks

- UTM parameters (utm_source, utm_medium, utm_campaign, etc.)
- Click IDs (gclid, fbclid, mkclid)
- Page views and referrers
- User login/signup events
- Attribution timestamps

## License

MIT

## Authors

Aswathy, Shayan
