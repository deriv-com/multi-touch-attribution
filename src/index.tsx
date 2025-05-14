/**
 * UserJourneyTracker
 * A lightweight library to track user pageviews and attribution data before signup
 * This library implements the attribution tracking plan to capture user journey data
 * across multiple touchpoints before a user signs up or logs in.
 */

/**
 * Interface for storing attribution data from various marketing channels
 * Captures UTM parameters, click IDs, and referrer information
 */
interface AttributionData {
    utm_campaign?: string;    // Marketing campaign name
    utm_medium?: string;      // Marketing medium (e.g., cpc, email, social)
    utm_source?: string;      // Traffic source (e.g., google, facebook)
    utm_term?: string;        // Keywords used in paid search
    utm_ad_id?: string;       // Specific ad identifier
    utm_ad_group_id?: string; // Ad group identifier
    utm_campaign_id?: string; // Campaign identifier
    gclid?: string;           // Google Click ID for AdWords tracking
    fbclid?: string;          // Facebook Click ID for ads tracking
    mkclid?: string;          // Microsoft/Bing Click ID for ads tracking
    referrer?: string;        // The URL from which the user arrived
    landing_page?: string;    // The page user lands on
    attribution_timestamp?: number; // When this attribution data was first captured
}

/**
 * Interface for storing page view events with attribution data
 * Each event represents a user visit with its associated attribution information
 */
interface PageViewEvent {
    url: string;              // Full URL of the page visited
    timestamp: number;        // Unix timestamp of the visit
    referrer?: string;        // Referring URL if available
    title?: string;           // Page title if available
    attribution: AttributionData; // Attribution data for this visit
    uuid: string;             // Unique identifier for this browser/device
    is_loggedin: boolean;     // Whether the user was logged in during this visit
    event_id: string;         // Unique identifier for this event
}

/**
 * Configuration options for the UserJourneyTracker
 */
interface UserJourneyTrackerOptions {
    cookieDomain?: string;    // Domain for the cookie (e.g., .example.com for all subdomains)
    cookieExpireDays?: number; // Number of days until cookie expires
    maxEvents?: number;       // Maximum number of events to store
    resetOnLogin?: boolean;   // Whether to reset tracking data when user logs in
    resetOnSignup?: boolean;  // Whether to reset tracking data when user signs up
    autoTrack?: boolean;      // Whether to automatically track page views
    trackHashChange?: boolean; // Whether to track hash changes in SPAs
    trackHistoryChange?: boolean; // Whether to track history API changes in SPAs
    attributionExpiry?: number; // How long to persist attribution data (in minutes)
}

/**
 * Main class for tracking user journeys across multiple touchpoints
 * Implements the multi-touch attribution model described in the tracking plan
 */
class UserJourneyTracker {
    // API endpoint constant - hardcoded within the library
    private readonly API_ENDPOINT: string = 'https://p115t1.buildship.run/user_events';

    private options: UserJourneyTrackerOptions;
    private events: PageViewEvent[] = [];  // Array of tracked page view events
    private storageKey: string = 'mt_event_history';  // Fixed storage key
    private cookieName: string = 'mt_browser_uuid';     // Fixed cookie name
    private attributionCookieName: string = 'mt_current_attribution'; // Cookie name for attribution data
    private isInitialized: boolean = false; // Flag to prevent multiple initializations
    private uuid: string;                  // Unique identifier for this browser/device
    private derivUserId: string | null = null; // User ID after login/signup
    private isLoggedIn: boolean = false;   // Whether the user is currently logged in
    private oldUuid: string | null = null; // Previous UUID before signup (for cross-device tracking)
    private lastTrackedUrl: string = '';   // Last URL that was tracked
    private currentPageEventId: string | null = null; // ID of the current page event
    private currentAttribution: AttributionData = {}; // Current attribution data to persist

    /**
     * Constructor - sets up the tracker with default or custom options
     * @param options Configuration options for the tracker
     */
    constructor(options: UserJourneyTrackerOptions = {}) {
        // Merge default options with provided options
        this.options = {
            cookieDomain: this.getTopLevelDomain(),
            cookieExpireDays: 365, // 1 year
            maxEvents: 100,
            resetOnLogin: false,
            resetOnSignup: false,
            autoTrack: true,       // Auto-track by default
            trackHashChange: true, // Track hash changes by default
            trackHistoryChange: true, // Track history changes by default
            attributionExpiry: 365 * 24 * 60, // 1 year in minutes
            ...options
        };

        // Generate or retrieve UUID from cookie
        this.uuid = this.getOrCreateUUID();

        // Load persisted attribution data
        this.loadAttributionData();
    }

    /**
     * Get the top-level domain for cookie sharing across subdomains
     * @returns The top-level domain (e.g., .example.com)
     */
    private getTopLevelDomain(): string {
        if (typeof window === 'undefined') return '';

        const hostname = window.location.hostname;

        // For localhost or IP addresses, don't set a domain
        if (hostname === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
            return '';
        }

        // List of external domains where we should use the full hostname
        const external_domains = ['webflow.io'];

        // Check if the hostname ends with any of the external domains
        const is_external_domain = external_domains.some(domain => hostname.endsWith(domain));

        // If it's an external domain, use the full hostname, otherwise use the last two parts
        const domain_name = is_external_domain ? hostname : hostname.split('.').slice(-2).join('.');

        // Return domain with leading dot for subdomain sharing if not an external domain
        return is_external_domain ? domain_name : '.' + domain_name;
    }

    /**
     * Generate a UUID v4 for uniquely identifying this browser/device or event
     * This is used to track the same user across multiple visits
     * @returns A randomly generated UUID v4 string
     */
    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Set a cookie with the specified name, value, and expiration
     * @param name Cookie name
     * @param value Cookie value
     * @param days Days until expiration
     */
    private setCookie(name: string, value: string, days: number): void {
        if (typeof window === 'undefined') return;

        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = "; expires=" + date.toUTCString();
        const domain = this.options.cookieDomain ? `; domain=${this.options.cookieDomain}` : '';
        const path = "; path=/";

        // Add SameSite attribute with fallback for older browsers
        let cookieString = name + "=" + encodeURIComponent(value) + expires + domain + path;

        // Add SameSite=Lax for modern browsers
        cookieString += "; SameSite=Lax";

        // Add Secure flag if on HTTPS
        if (window.location.protocol === 'https:') {
            cookieString += "; Secure";
        }

        document.cookie = cookieString;
    }

    /**
     * Get a cookie value by name
     * @param name Cookie name
     * @returns Cookie value or null if not found
     */
    private getCookie(name: string): string | null {
        if (typeof window === 'undefined') return null;

        const nameEQ = name + "=";
        const cookieArray = document.cookie.split(';');
        for (let i = 0; i < cookieArray.length; i++) {
            let c = cookieArray[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) {
                // Decode the cookie value
                return decodeURIComponent(c.substring(nameEQ.length, c.length));
            }
        }
        return null;
    }

    /**
     * Get existing UUID from cookie or create a new one if none exists
     * This ensures consistent tracking across page refreshes, sessions, and subdomains
     * @returns The UUID for this browser/device
     */
    private getOrCreateUUID(): string {
        if (typeof window === 'undefined') return this.generateUUID();

        let uuid = this.getCookie(this.cookieName);

        if (!uuid) {
            // First visit - generate and store a new UUID
            uuid = this.generateUUID();
            this.setCookie(
                this.cookieName,
                uuid,
                this.options.cookieExpireDays as number
            );
        }

        return uuid;
    }

    /**
     * Initialize the tracker - load existing events and set up page view tracking
     * This should be called once when the application starts
     * @param isLoggedIn Optional parameter to set initial login state
     * @param userId Optional user ID if already logged in
     */
    public init(isLoggedIn?: boolean, userId?: string): void {
        if (this.isInitialized) return;

        // Check login state from cookies for static websites
        if (typeof window !== 'undefined') {
            const loginCookie = this.getCookie('client_information');
            if (loginCookie) {
                try {
                    const clientInfo = JSON.parse(loginCookie);
                    if (clientInfo) {
                        this.isLoggedIn = true;
                        if (clientInfo.user_id) {
                            this.derivUserId = clientInfo.user_id;
                        }
                    } else {
                        this.isLoggedIn = false;
                    }
                } catch (e) {
                    console.error('Error parsing client_information cookie:', e);
                }
            } else {
                // Only set login state from parameter if cookie not present
                if (isLoggedIn !== undefined) {
                    this.isLoggedIn = isLoggedIn;
                }
            }
        } else {
            // If window undefined, set login state from parameter if provided
            if (isLoggedIn !== undefined) {
                this.isLoggedIn = isLoggedIn;
            }
        }

        // Set user ID if provided (overrides cookie)
        if (userId) {
            this.derivUserId = userId;
        } else if (typeof window !== 'undefined') {
            // Try to load user ID from storage -> later this key name can be changed
            const storedUserId = localStorage.getItem(`${this.storageKey}_user_id`);
            if (storedUserId) {
                this.derivUserId = storedUserId;
                this.isLoggedIn = true;
            }
        }

        // Load existing events from storage
        this.loadEvents();

        // Set up auto-tracking if enabled
        if (this.options.autoTrack && typeof window !== 'undefined') {
            this.setupAutoTracking();
        }

        // Ensure we have at least basic attribution data
        if (Object.keys(this.currentAttribution).length === 0) {
            this.currentAttribution = {
                landing_page: window.location.pathname,
                attribution_timestamp: Date.now()
            };

            // If we have a referrer, add it
            if (document.referrer) {
                try {
                    const referrerUrl = new URL(document.referrer);
                    if (referrerUrl.hostname !== window.location.hostname) {
                        this.currentAttribution.referrer = document.referrer;
                    }
                } catch (e) {
                    // Invalid referrer URL
                }
            }

            // Save this basic attribution data
            this.saveAttributionData();
        }

        // Track the current page view
        this.trackCurrentPageView();

        this.isInitialized = true;
    }

    /**
     * Set up automatic tracking for page views
     * This handles various navigation methods in both traditional and single-page apps
     */
    private setupAutoTracking(): void {
        if (typeof window === 'undefined') return;

        // Track history API changes (pushState/replaceState)
        if (this.options.trackHistoryChange) {
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            const self = this;

            // Override pushState
            history.pushState = function (state, title, url) {
                originalPushState.call(this, state, title, url);
                self.trackPageView();
            };

            // Override replaceState
            history.replaceState = function (state, title, url) {
                originalReplaceState.call(this, state, title, url);
                self.trackPageView();
            };
        }

        // Track hash changes
        if (this.options.trackHashChange) {
            window.addEventListener('hashchange', () => this.trackPageView());
        }

        // Track browser back/forward navigation
        window.addEventListener('popstate', () => this.trackPageView());
    }

    /**
     * Parse attribution data from the current URL
     * This extracts UTM parameters, click IDs, and other attribution information
     * @returns Attribution data object
     */
    private parseAttributionData(): AttributionData {
        if (typeof window === 'undefined') return {};

        const url = new URL(window.location.href);
        const params = url.searchParams;
        const attribution: AttributionData = {};

        // Extract UTM parameters
        const utmParams = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
            'utm_ad_id', 'utm_ad_group_id', 'utm_campaign_id'
        ];

        utmParams.forEach(param => {
            const value = params.get(param);
            if (value) {
                (attribution as any)[param] = value;
            }
        });

        // Extract click IDs
        const clickIds = ['gclid', 'fbclid', 'mkclid'];
        clickIds.forEach(param => {
            const value = params.get(param);
            if (value) {
                (attribution as any)[param] = value;
            }
        });

        // Add referrer if available
        if (document.referrer) {
            try {
                const referrerUrl = new URL(document.referrer);
                // Only store external referrers
                if (referrerUrl.hostname !== window.location.hostname) {
                    attribution.referrer = document.referrer;
                }
            } catch (e) {
                // Invalid referrer URL
            }
        }

        // Add landing page
        attribution.landing_page = window.location.pathname;

        // Add timestamp when this attribution data was captured
        attribution.attribution_timestamp = Date.now();

        return attribution;
    }

    /**
     * Check if the current URL has new attribution data
     * @param newAttribution The attribution data from the current URL
     * @returns True if this is a new attribution source
     */
    private hasNewAttributionData(newAttribution: AttributionData): boolean {
        // Check if we have any UTM parameters or click IDs
        const attributionParams = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
            'utm_ad_id', 'utm_ad_group_id', 'utm_campaign_id',
            'gclid', 'fbclid', 'mkclid'
        ];

        const hasAttribution = attributionParams.some(param =>
            newAttribution[param as keyof AttributionData] !== undefined
        );

        // If there's no referrer or landing page, ensure we at least have these basic attributes
        if (!hasAttribution && Object.keys(newAttribution).length > 0) {
            // Always save at least the landing page and timestamp on first visit
            if (this.currentAttribution.landing_page === undefined) {
                return true;
            }
        }

        return hasAttribution;
    }

    /**
     * Save the current attribution data to a cookie
     * This allows us to persist attribution across page views and domains
     */
    private saveAttributionData(): void {
        if (typeof window === 'undefined' || !this.currentAttribution) return;

        try {
            if (Object.keys(this.currentAttribution).length === 0) {
                return;
            }

            const urlAttribution = this.parseAttributionData();
            const urlHasParams = window.location.search.length > 0;
            const attributionChanged = urlHasParams && Object.keys(urlAttribution).some(key => {
                return urlAttribution[key as keyof AttributionData] !== this.currentAttribution[key as keyof AttributionData];
            });
            const urlParamsSameAsOld = !attributionChanged && urlHasParams;

            const referrer = document.referrer || '';
            const referrerIsEmpty = referrer.trim() === '';
            const topLevelDomain = this.getTopLevelDomain();
            const referrerContainsTopLevelDomain = referrer.includes(topLevelDomain);
            const referrerChanged = !referrerIsEmpty && !referrerContainsTopLevelDomain;

            // Update attribution if:
            // - URL params changed, OR
            // - URL params same as old AND referrer changed, OR
            // - No URL params AND referrer changed
            const shouldUpdateAttribution =
                attributionChanged ||
                (urlParamsSameAsOld && referrerChanged) ||
                (!urlHasParams && referrerChanged);

            if (shouldUpdateAttribution) {
                this.currentAttribution = urlAttribution;
            }

            const expiryDays = Math.max(1, Math.floor((this.options.attributionExpiry as number) / (60 * 24)));

            const cookieValue = JSON.stringify(this.currentAttribution);

            this.setCookie(
                this.attributionCookieName,
                cookieValue,
                expiryDays
            );
        } catch (e) {
            console.error('Failed to save attribution data:', e);
        }
    }

    /**
     * Load saved attribution data from cookie
     * This restores attribution data across page views and domains
     */
    private loadAttributionData(): void {
        if (typeof window === 'undefined') return;

        try {
            const savedAttribution = this.getCookie(this.attributionCookieName);
            if (savedAttribution) {
                const attribution = JSON.parse(savedAttribution);

                // Check if the attribution data is still valid (not expired)
                if (attribution.attribution_timestamp) {
                    const now = Date.now();
                    const ageInMinutes = (now - attribution.attribution_timestamp) / (1000 * 60);

                    if (ageInMinutes <= (this.options.attributionExpiry as number)) {
                        this.currentAttribution = attribution;
                    } else {
                        // Attribution data has expired, clear it
                        this.setCookie(this.attributionCookieName, '', -1); // Expire the cookie
                    }
                } else {
                    this.currentAttribution = attribution;
                }
            }
        } catch (e) {
            console.error('Failed to load attribution data:', e);
        }
    }

    /**
     * Get the attribution data for the current page view
     * This combines new attribution data from the URL with persisted attribution data
     * @returns The attribution data to use for the current page view
     */
    private getAttributionForPageView(): AttributionData {
        // Parse attribution data from the current URL
        const urlAttribution = this.parseAttributionData();

        // Check if we have new attribution data in the URL
        if (this.hasNewAttributionData(urlAttribution)) {
            // We have new attribution data, update and persist it
            this.currentAttribution = urlAttribution;
            this.saveAttributionData();
            return urlAttribution;
        }

        // No new attribution data, use the persisted attribution if available
        if (Object.keys(this.currentAttribution).length > 0) {
            // Add the current page as landing_page
            return {
                ...this.currentAttribution,
                landing_page: window.location.pathname
            };
        }

        // No persisted attribution either, just return the basic data
        return urlAttribution;
    }

    /**
     * Track the current page view
     * This implements the "Tracking Events for Every User Visit" approach
     */
    private trackCurrentPageView(): void {
        if (typeof window === 'undefined') return;

        // Skip if we're tracking the same URL again
        // TODO: we need to add another condition to say if page already visited and the attributions are the same
        if (this.lastTrackedUrl === window.location.href) return;
        this.lastTrackedUrl = window.location.href;

        // Get attribution data for this page view
        const attribution = this.getAttributionForPageView();

        // Generate a unique ID for this event
        const eventId = this.generateUUID();

        // Create the page view event
        const event: PageViewEvent = {
            url: window.location.href,
            timestamp: Date.now(),
            referrer: document.referrer || undefined,
            title: document.title || undefined,
            attribution: attribution,
            uuid: this.uuid,
            is_loggedin: this.isLoggedIn,
            event_id: eventId
        };

        // Store the current page event ID for potential updates
        this.currentPageEventId = eventId;

        this.storeEvent(event);
    }

    /**
     * Update the login state of a specific event
     * @param eventId The ID of the event to update
     * @param isLoggedIn The new login state
     */
    private updateEventLoginState(eventId: string, isLoggedIn: boolean): void {
        const eventIndex = this.events.findIndex(event => event.event_id === eventId);
        if (eventIndex !== -1) {
            this.events[eventIndex].is_loggedin = isLoggedIn;
            this.saveEventsToLocalStorage();
        }
    }

    /**
     * Update the login state and update the most recent page view if needed
     * This should be called after authentication status is determined
     * @param isLoggedIn Whether the user is logged in
     * @param userId The user ID if logged in
     */
    public updateLoginState(isLoggedIn: boolean, userId?: string): void {
        const previousState = this.isLoggedIn;
        this.isLoggedIn = isLoggedIn;

        if (userId) {
            this.derivUserId = userId;

            // Store the user ID for future reference
            if (typeof window !== 'undefined') {
                localStorage.setItem(`${this.storageKey}_user_id`, userId);
            }
        }

        // If login state changed and we have a current page event, update it
        if (previousState !== isLoggedIn && this.currentPageEventId) {
            this.updateEventLoginState(this.currentPageEventId, isLoggedIn);

            // Find the event and send the updated version to backend with action 'update'
            const updatedEvent = this.events.find(event => event.event_id === this.currentPageEventId);
            if (updatedEvent) {
                this.sendEventToBackend(updatedEvent, 'pageview', 'update');
            }
        }
    }

    /**
     * Add a page view event to history, save to storage, and send to backend
     * @param event The page view event to add
     */
    private storeEvent(event: PageViewEvent): void {
        // Add to local storage
        this.events.push(event);

        // Trim events if exceeding max count to prevent storage issues
        if (this.events.length > (this.options.maxEvents as number)) {
            this.events = this.events.slice(this.events.length - (this.options.maxEvents as number));
        }

        // Save updated events to local storage
        this.saveEventsToLocalStorage();

        // send event to backend
        this.sendEventToBackend(event, 'pageview', 'update');
    }

    /**
     * Send a single event to the backend API
     * @param event The event to send
     */
    private async sendEventToBackend(event: PageViewEvent, event_type: 'pageview' | 'signup' | 'login' = 'pageview', action: 'create' | 'update' = 'create'): Promise<void> {
        let API_ENDPOINT;
        if(action='create'){
            API_ENDPOINT='https://p115t1.buildship.run/user_events'
        }
        else{
              API_ENDPOINT='https://p115t1.buildship.run/identify'
        }
        try {
            // Prepare the payload
            const payload = {
                action: action,
                data: {
                    uuid: this.uuid,
                    deriv_user_id: this.derivUserId || undefined,
                    event_type,
                    utm_source: this.currentAttribution.utm_source || undefined,
                    utm_medium: this.currentAttribution.utm_medium || undefined,
                    utm_campaign: this.currentAttribution.utm_campaign || undefined,
                    utm_term: this.currentAttribution.utm_term || undefined,
                    utm_ad_id: this.currentAttribution.utm_ad_id || undefined,
                    utm_ad_group_id: this.currentAttribution.utm_ad_group_id || undefined,
                    utm_campaign_id: this.currentAttribution.utm_campaign_id || undefined,
                    gclid: this.currentAttribution.gclid || undefined,
                    fbclid: this.currentAttribution.fbclid || undefined,
                    mkclid: this.currentAttribution.mkclid || undefined,
                    referrer_url: event.referrer || undefined,
                    landing_page_url: event.attribution.landing_page || undefined,
                    is_logged_in: this.isLoggedIn || false,
                }
            };

            // Commented out sending the event to the backend for now
       
            const response = await fetch(this.API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                credentials: 'same-origin'
            });

            if (!response.ok) {
                console.error('Failed to send event to backend:', response.statusText);
            }
        
        } catch (error) {
            console.error('Error sending event to backend:', error);
        }
    }

    /**
     * Save events to browser localStorage
     * Handles storage quota errors by reducing the number of stored events
     */
    private saveEventsToLocalStorage(): void {
        if (typeof window === 'undefined') return;

        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.events));
        } catch (e) {
            console.error('Failed to save user events:', e);

            // If we hit storage limits, try to reduce the data size
            // This addresses the "Cookie Storage & Size Limits" concern
            if (e instanceof DOMException && (
                e.name === 'QuotaExceededError' ||
                e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {

                // Keep only the most recent events
                if (this.events.length > 10) {
                    this.events = this.events.slice(this.events.length - 10);
                    this.saveEventsToLocalStorage();
                }
            }
        }
    }

    /**
     * Load events from browser localStorage
     * This restores the tracking history when the page is reloaded
     */
    private loadEvents(): void {
        if (typeof window === 'undefined') return;

        try {
            const storedEvents = localStorage.getItem(this.storageKey);
            if (storedEvents) {
                this.events = JSON.parse(storedEvents);
            }
        } catch (e) {
            console.error('Failed to load user events:', e);
        }
    }

    /**
     * Get all tracked events
     * @returns A copy of the events array to prevent external modification
     */
    public getEvents(): PageViewEvent[] {
        return [...this.events];
    }

    /**
     * Clear all tracked events
     * This is used when resetting tracking after login/signup
     */
    public clearEvents(): void {
        this.events = [];

        if (typeof window !== 'undefined') {
            localStorage.removeItem(this.storageKey);
        }
    }

    /**
     * Track a custom page view (for SPAs that don't trigger page loads)
     * This should be called manually when the route changes in a SPA
     * @param url Optional URL to track (defaults to current URL)
     * @param title Optional page title (defaults to current title)
     */
    public trackPageView(url?: string, title?: string): void {
        if (typeof window === 'undefined') return;

        // Update the URL and title if provided
        if (url) {
            history.pushState({}, title || '', url);
        }

        // Track the page view with the updated URL
        this.trackCurrentPageView();
    }

    /**
     * Record user login
     * This associates the tracking data with a user ID and optionally resets tracking
     * @param derivUserId The user ID assigned after login
     */
    public recordLogin(derivUserId: string): void {
        this.isLoggedIn = true;
        this.derivUserId = derivUserId;

        // Store the user ID for future reference
        if (typeof window !== 'undefined') {
            localStorage.setItem(`${this.storageKey}_user_id`, derivUserId);
        }

        // Update the current page event if it exists
        if (this.currentPageEventId) {
            this.updateEventLoginState(this.currentPageEventId, true);

            // Find the event and send the updated version to backend
            const updatedEvent = this.events.find(event => event.event_id === this.currentPageEventId);
            if (updatedEvent) {
                this.sendEventToBackend(updatedEvent, 'pageview', 'update');
            }
        }

        // Reset events if configured to do so
        // This implements the "Reset Cookies on Login" approach
        if (this.options.resetOnLogin) {
            this.clearEvents();
        }
    }

    /**
     * Record user signup
     * This associates the tracking data with a user ID, stores the old UUID,
     * and optionally resets tracking
     * @param derivUserId The user ID assigned after signup
     */
    public recordSignup(derivUserId: string): void {
        // Store the old UUID before potentially resetting
        // This is important for cross-device attribution
        this.oldUuid = this.uuid;

        this.isLoggedIn = true;
        this.derivUserId = derivUserId;

        // Store the user ID and old UUID for future reference
        if (typeof window !== 'undefined') {
            localStorage.setItem(`${this.storageKey}_user_id`, derivUserId);

            // Store the old UUID for reference
            // This helps with "Handling Multi-Touch & Multi-Device Attribution"
            if (this.oldUuid) {
                localStorage.setItem(`${this.storageKey}_old_uuid`, this.oldUuid);
            }
        }

        // Update the current page event if it exists
        if (this.currentPageEventId) {
            this.updateEventLoginState(this.currentPageEventId, true);

            // Find the event and send the updated version to backend
            const updatedEvent = this.events.find(event => event.event_id === this.currentPageEventId);
            if (updatedEvent) {
                this.sendEventToBackend(updatedEvent, 'pageview', 'update');
            }
        }

        // Reset events if configured to do so
        // This implements the "Reset Cookies on Sign-Up" approach
        if (this.options.resetOnSignup) {
            this.clearEvents();
        }
    }

    /**
     * Export journey data for sending to server
     * This provides all the data needed for backend storage and analysis
     * @returns An object containing UUID, user ID, old UUID, and all tracked events
     */
    public exportJourney(): {
        uuid: string,
        deriv_user_id?: string,
        old_uuid?: string,
        events: PageViewEvent[]
    } {
        return {
            uuid: this.uuid,                       // Current browser/device UUID
            deriv_user_id: this.derivUserId || undefined, // User ID if logged in
            old_uuid: this.oldUuid || undefined,   // Previous UUID if changed
            events: this.getEvents()               // All tracked events
        };
    }
}

export default UserJourneyTracker;
