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
type EventType = 'pageview' | 'signup' | 'login';

interface PageViewEvent {
    url: string;              // Full URL of the page visited
    timestamp: number;        // Unix timestamp of the visit
    referrer?: string;        // Referring URL if available
    title?: string;           // Page title if available
    attribution: AttributionData; // Attribution data for this visit
    uuid: string;             // Unique identifier for this browser/device
    is_loggedin: boolean;     // Whether the user was logged in during this visit
    event_id: string;        // Unique identifier for this event
    deriv_user_id?: string;
    event_type?: EventType; // Optional event type
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
    private options: UserJourneyTrackerOptions;
    private events: PageViewEvent[] = [];  // Array of tracked page view events
    private storageKey: string = 'mt_event_history';  // Fixed storage key
    private cookieName: string = 'rudder_anonymous_id'; // Shared UUID cookie with analytics package
    private attributionCookieName: string = 'mt_current_attribution'; // Cookie name for attribution data
    private isInitialized: boolean = false; // Flag to prevent multiple initializations
    private uuid: string;                  // Unique identifier for this browser/device
    private derivUserId: string | null = null; // User ID after login/signup
    private isLoggedIn: boolean = false;   // Whether the user is currently logged in
    private oldUuid: string | null = null; // Previous UUID before signup (for cross-device tracking)
    private lastTrackedUrl: string = '';   // Last URL that was tracked
    private currentPageEventId: string | null = null; // ID of the current page event
    private currentAttribution: AttributionData = {}; // Current attribution data to persist
    private hasSentSignupEvent: boolean = false; // Flag to indicate if signup event was sent
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
     * Check if the current hostname is a production environment
     * @returns True if production, false if staging/dev
     */
    private isProductionEnvironment(): boolean {

        if (typeof window === 'undefined') return false;

        const hostname = window.location.hostname;

        // Staging/dev patterns: domains starting with dev-, staging-, dev-app-, staging-app-
        const stagingPatterns = ['dev.', 'staging.', 'dev-app.', 'staging-app.'];

        // Check if hostname starts with any staging pattern
        const isStaging = stagingPatterns.some(pattern => hostname.startsWith(pattern));

        if (isStaging) {
            return false;
        }

        // Production patterns: base domains and app/hub subdomains without staging prefixes
        const productionPatterns = [
            /^(www\.)?deriv\.com$/,
            /^(www\.)?deriv\.ae$/,
            /^app\.deriv\.com$/,
            /^app\.deriv\.ae$/,
            /^hub\.deriv\.com$/,
            /^[^.]*\.deriv\.com$/, // any single subdomain of deriv.com (but not staging prefixes)
            /^[^.]*\.deriv\.ae$/   // any single subdomain of deriv.ae (but not staging prefixes)
        ];

        return productionPatterns.some(pattern => pattern.test(hostname));
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
        const randomValues = new Uint8Array(16);
        window.crypto.getRandomValues(randomValues);
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c, i) {
            const r = randomValues[i % randomValues.length] & 0xf;
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
     * Get existing UUID from shared analytics cookie (rudder_anonymous_id) or create a new one if none exists
     * This ensures consistent tracking across page refreshes, sessions, and both analytics systems
     * The library uses the same UUID that's already created by the deriv-analytics library
     * @returns The UUID for this browser/device
     */
    private getOrCreateUUID(): string {
        if (typeof window === 'undefined') return this.generateUUID();

        // Try to get UUID from the shared analytics cookie (rudder_anonymous_id)
        let uuid = this.getCookie(this.cookieName);

        if (!uuid) {
            // No UUID found - generate and store a new one in the shared cookie
            // This will only happen if analytics library hasn't created the cookie yet
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
     * Get the current UUID being used by the tracker
     * This UUID is shared with the analytics package via the rudder_anonymous_id cookie
     * @returns The current UUID string
     */
    public getUUID(): string {
        return this.uuid;
    }

    /**
     * Set a new UUID for the tracker and synchronize it with analytics
     * This method should be used when the analytics package generates a new UUID
     * @param newUuid The new UUID to use
     */
    public setUUID(newUuid: string): void {
        if (!newUuid || typeof newUuid !== 'string') {
            console.error('Invalid UUID provided to setUUID');
            return;
        }

        // Update internal UUID
        this.uuid = newUuid;

        // Update the shared cookie
        this.setCookie(
            this.cookieName,
            newUuid,
            this.options.cookieExpireDays as number
        );
    }

    public getGAClientId(): string {
        // Try to get the _ga cookie
        const gaCookie = this.getCookie('_ga');
        
        if (gaCookie) {
            // _ga cookie format is typically GA1.{version}.{random}.{timestamp}
            // We want to return the entire cookie value
            return gaCookie;
        }
        
        // If _ga cookie doesn't exist, generate a new GA client ID
        // GA client ID format: GA1.1.{random}.{timestamp}
        const timestamp = Math.round(new Date().getTime() / 1000);
        const random = Math.floor(Math.random() * 2147483647); // Random number between 0 and 2^31-1

        const generated_ga = `GA1.1.${random}.${timestamp}`;
        this.setCookie(
          "_ga",
          generated_ga,
          this.options.cookieExpireDays as number
        );
        
        return generated_ga;
    }

    public getGAMeasurementID(): { key: string; value: string } {
        // Determine the domain by extracting the last two parts of the hostname
        const domain = window.location.hostname.split(".").slice(-2).join(".");
        
        // Set the appropriate cookie key based on the domain
        const cookieKey = domain === "deriv.com" ? "_ga_R0D2Z1965W" : "_ga_F3QTR4CDHR";
        
        // Try to get the cookie value
        const cookieValue = this.getCookie(cookieKey);
        
        if (cookieValue) {
            // Return the existing cookie value
            return {
                key: cookieKey,
                value: cookieValue
            };
        }
    
        // If cookie doesn't exist, generate a new value
        const generatedValue = this.generateMeasurementIDValue();
        
        // Store the generated value in a cookie
        this.setCookie(
            cookieKey,
            generatedValue,
            this.options.cookieExpireDays as number
        );
        
        // Return the key-value pair
        return {
            key: cookieKey,
            value: generatedValue
        };
    }
  
    /**
     * Generate a value for GA Measurement ID cookie
     * @returns A generated measurement ID value
     */
    private generateMeasurementIDValue(): string {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        // Calculate last activity (current + 5 seconds)
        const lastActivityTimestamp = currentTimestamp + 5;
        // Build the GA4 cookie value string
        const cookieValue = `GS2.1.s${currentTimestamp}$o1$g1$t${lastActivityTimestamp}$j50$l0$h0`;
        return cookieValue;
    }

    private getFbpCookie(): string {
        const fbpCookie = this.getCookie("_fbp");
        if (fbpCookie) {
            return fbpCookie;
        }
        const version = 1;
        const creationTime = Date.now(); // Current timestamp in milliseconds
        const randomNumber = Math.floor(Math.random() * 2147483647); // Random 32-bit integer
        const fbpValue = `fb.${version}.${creationTime}.${randomNumber}`;
        this.setCookie(
          "_fbp",
          fbpValue,
          this.options.cookieExpireDays as number
        );
        return fbpValue;
    }

    private getFbcCookie(): string | null {
        const fbcCookie = this.getCookie("_fbc");
        if (fbcCookie) return fbcCookie;

        const url = new URL(window.location.href);
        const params = url.searchParams;
        const fbclid = params.get("fbclid");
        if (!fbclid) return null;

        // Generate _fbc cookie value
        const version = 1;
        const creationTime = Date.now(); // Current timestamp in milliseconds
        
        const fbcValue = `fb.${version}.${creationTime}.${fbclid}`;
        this.setCookie(
          "_fbc",
          fbcValue,
          this.options.cookieExpireDays as number
        );
        return fbcValue;
    }

    /**
     * Synchronize UUID with analytics package
     * This method ensures both systems are using the same UUID
     * Should be called after analytics initialization or UUID changes
     */
    public syncWithAnalytics(): void {
        if (typeof window === 'undefined') return;

        // Get the current UUID from analytics cookie
        const analyticsUuid = this.getCookie(this.cookieName);

        if (analyticsUuid && analyticsUuid !== this.uuid) {
            // Analytics has a different UUID, update ours to match
            this.uuid = analyticsUuid;
        } else if (!analyticsUuid && this.uuid) {
            // Analytics doesn't have a UUID but we do, set it for analytics
            this.setCookie(
                this.cookieName,
                this.uuid,
                this.options.cookieExpireDays as number
            );
        }
    }

    /**
     * Initialize the tracker - load existing events and set up page view tracking
     * This should be called once when the application starts
     * @param isLoggedIn Optional parameter to set initial login state
     * @param userId Optional user ID if already logged in
     */
    public init(): void {
        if (this.isInitialized) return;
        // Check login state from cookies for static websites
        if (typeof window !== 'undefined') {
            const loginCookie = this.getCookie('client_information');
            if (loginCookie) {
                try {
                    const clientInfo = JSON.parse(loginCookie);
                    if (clientInfo) {
            if (!this.isProductionEnvironment()) {

                // For staging/dev environments, if client_information cookie exists, cleanup events to keep only latest attribution
                this.loadEvents(); // Ensure events are loaded before cleanup
                this.cleanupEventsKeepLastAttribution();
            }
                        if (clientInfo.user_id) {
                            this.derivUserId = clientInfo.user_id;
                            this.isLoggedIn = true;
                        }
                    } else {
                        this.isLoggedIn = false;
                    }
                } catch (e) {
                    console.error('Error parsing client_information cookie:', e);
                }
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
                landing_page:  window.location.href,
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

        // Synchronize UUID with analytics package
        this.syncWithAnalytics();

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
            'utm_ad_id', 'utm_ad_group_id', 'utm_campaign_id',
        ];

        utmParams.forEach(param => {
            const value = params.get(param);
            if (value) {
                (attribution as any)[param] = value;
            }
        });

        // Extract click IDs
        const clickIds = [
          "gclid",
          "fbclid",
          "mkclid",
          "wbraid",
          "gbraid",
          "ttclid"
        ];
        clickIds.forEach(param => {
            const value = params.get(param);
            if (value) {
                (attribution as any)[param] = value;
            }
        });
        
        // Handle ScCid separately - store as scclid
        const scCidValue = params.get("ScCid");
        if (scCidValue) {
            (attribution as any)["scclid"] = scCidValue;
        }
        // Helper function to add non-null values to attribution
        const addToAttribution = (key: string, value: string | null | undefined) => {
            if (value) {
                (attribution as Record<string, string>)[key] = value;
            }
        };

        // Add tracking IDs to attribution
        addToAttribution("_ga", this.getGAClientId());
        
        // Handle GA Measurement ID which has a different structure
        const _gaMeasurementObj = this.getGAMeasurementID();
        if (_gaMeasurementObj) {
            (attribution as Record<string, string>)[_gaMeasurementObj.key] = _gaMeasurementObj.value;
        }
        
        // Add Facebook tracking parameters
        addToAttribution("fbp", this.getFbpCookie());
        addToAttribution("fbc", this.getFbcCookie());
        
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
        attribution.landing_page = window.location.href;

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
                landing_page:  window.location.href
            };
        }

        // No persisted attribution either, just return the basic data
        return urlAttribution;
    }

    /**
     * Check if the new event's attribution is the same as the last stored event's attribution
     * @param newAttribution The attribution data of the new event
     * @returns True if the event is duplicated (same attribution), false otherwise
     */
    private isEventDuplicated(newAttribution: AttributionData): boolean {

        if (this.events.length === 0) {
            return false;
        }

        const lastEvent = this.events[this.events.length - 1];
        const lastAttribution = lastEvent.attribution;
        // Keys to ignore during comparison (e.g., timestamps, landing page)
        const ignoreKeys = new Set(['attribution_timestamp', 'landing_page']);

        // Get all attribution keys from both objects, excluding ignored keys
        const newKeys = Object.keys(newAttribution).filter(key => !ignoreKeys.has(key) && newAttribution[key as keyof AttributionData] !== undefined);
        const lastKeys = Object.keys(lastAttribution).filter(key => !ignoreKeys.has(key) && lastAttribution[key as keyof AttributionData] !== undefined);

        // If they have different numbers of meaningful keys, they're different
        if (newKeys.length !== lastKeys.length) {
            return false;
        }

        // If no meaningful attribution data in either, consider them the same
        if (newKeys.length === 0 && lastKeys.length === 0) {
            return true;
        }

        // Compare all meaningful keys
        const allKeys = new Set([...newKeys, ...lastKeys]);

        for (const key of allKeys) {
            const newValue = newAttribution[key as keyof AttributionData];
            const lastValue = lastAttribution[key as keyof AttributionData];

            // If one has the key and the other doesn't (excluding undefined values)
            if ((newValue !== undefined) !== (lastValue !== undefined)) {
                return false;
            }

            // If both have the key but values are different
            if (newValue !== undefined && lastValue !== undefined && newValue !== lastValue) {
                return false;
            }
        }

        return true; // All attribution fields are the same
    }

    /**
     * Track the current page view
     * This implements the "Tracking Events for Every User Visit" approach
     */
    private trackCurrentPageView(): void {
        if (this.hasSentSignupEvent) {
            return; // Do not send pageview event after signup
        }

        const loginCookie = this.getCookie('client_information');

        const client_info = loginCookie && JSON.parse(loginCookie)
        if (typeof window === 'undefined') return;

        // Skip if we're tracking the same URL again
        if (this.lastTrackedUrl === window.location.href) return;

        // Get attribution data for this page view
        const attribution = this.getAttributionForPageView();

        // Check if the event is duplicated based on attribution
        if (this.isEventDuplicated(attribution)) {
            return; // Skip storing duplicated event
        }

        this.lastTrackedUrl = window.location.href;

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
            event_id: eventId,
            deriv_user_id: client_info?.user_id
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
              if (userId) {
            this.derivUserId = userId;
        }
        // const previousState = this.isLoggedIn;
        this.isLoggedIn = isLoggedIn;

        // Force update logged_in value in localStorage every time
        if (typeof window !== 'undefined') {
            // Update is_loggedin and deriv_user_id inside stored events in mt_event_history directly from isLoggedIn parameter and userId
            try {
                const storedEventsStr = localStorage.getItem(this.storageKey);
                if (storedEventsStr) {
                    const storedEvents: PageViewEvent[] = JSON.parse(storedEventsStr);
                    const updatedEvents = storedEvents.map((event, index) => {
                        if (this.currentPageEventId) {
                            if (event.event_id === this.currentPageEventId) {
                                return {
                                    ...event,
                                    is_loggedin: isLoggedIn,
                                    deriv_user_id: isLoggedIn ? userId || this.derivUserId : undefined,
                                    attribution: {
                                        ...event.attribution,
                                    }
                                };
                            } else {
                                return event;
                            }
                        } else if (index === storedEvents.length - 1) {
                            // Fallback: update the most recent event if currentPageEventId is not set
                            if (index === storedEvents.length - 1) {
                                return {
                                    ...event,
                                    is_loggedin: isLoggedIn,
                                    deriv_user_id: isLoggedIn ? userId || this.derivUserId : undefined,
                                    attribution: {
                                        ...event.attribution,
                                    }
                                };
                            } else {
                                return event;
                            }
                        } else {
                            return event;
                        }
                    });
                    localStorage.setItem(this.storageKey, JSON.stringify(updatedEvents));
                }
            } catch (e) {
                console.error('Failed to update is_loggedin in stored events:', e);
            }
        }


        // Always update event login state and send update to backend if currentPageEventId exists
        if (this.currentPageEventId) {
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
        this.sendEventToBackend(event, 'pageview', 'create');
    }

    /**
     * Send a single event to the backend API
     * @param event The event to send
     */
    private async sendEventToBackend(event: PageViewEvent, event_type: EventType = 'pageview', action: 'create' | 'update' = 'create'): Promise<void> {
        let API_ENDPOINT;
        let payload;

        if(action === 'create'){
            // Set API endpoint based on environment (production or staging)
            if (this.isProductionEnvironment()) {
                API_ENDPOINT = 'https://api.deriv.ae/multi-touch-attribution/v1/user_events';
            } else {
                API_ENDPOINT = 'https://staging-api.deriv.ae/multi-touch-attribution/v1/user_events';
            }
            payload = {
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
            }
        }
        else {
            // Set API endpoint based on environment (production or staging)
            if (this.isProductionEnvironment()) {
                API_ENDPOINT = 'https://api.deriv.com/multi-touch-attribution/v1/identify';
            } else {
                API_ENDPOINT = 'https://staging-api.deriv.ae/multi-touch-attribution/v1/identify';
            }
            payload = {
                uuid: this.uuid,
                is_logged_in: this.isLoggedIn || false,
                deriv_user_id: this.derivUserId || undefined
            }
        }
        try {

            const response = await fetch(API_ENDPOINT, {
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
    private cleanupEventsKeepLastAttribution(): void {
        if (this.events.length === 0) return;

        // Find the last event (signup or pageview)
        const lastEvent = this.events[this.events.length - 1];

        // Filter events to keep only the last event
        this.events = [lastEvent];

        // Update the attribution of the last event to the current attribution
        this.events[0].attribution = this.currentAttribution;

        // Save to localStorage
        localStorage.setItem(this.storageKey, JSON.stringify(this.events));
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
                // this.sendEventToBackend(updatedEvent, 'pageview', 'update');
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
        this.isLoggedIn = true;
        this.derivUserId = derivUserId;

        // Create and store a signup event with current attribution
        if (typeof window === 'undefined') return;
        const eventId = this.generateUUID();
        const signupEvent: PageViewEvent = {
            url: window.location.href,
            timestamp: Date.now(),
            referrer: document.referrer || undefined,
            title: document.title || undefined,
            attribution: this.currentAttribution,
            uuid: this.uuid,
            is_loggedin: this.isLoggedIn,
            event_id: eventId,
            deriv_user_id: this.derivUserId || undefined
        };

        this.events.push(signupEvent);

        // For .deriv.ae domain, keep only the last event with latest attribution
        if (typeof window !== 'undefined') {
            this.cleanupEventsKeepLastAttribution();
        }

        // Save updated events to localStorage
        this.saveEventsToLocalStorage();

        // Optionally send the signup event to backend
        this.sendEventToBackend(signupEvent, 'signup', 'create');

        // Set flag to indicate signup event was sent
        this.hasSentSignupEvent = true;
    }

     /* Export journey data for sending to server
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
