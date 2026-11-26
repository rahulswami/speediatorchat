// Meta WhatsApp Embedded Signup, browser side.
// The popup returns two things separately: a one-time `code` through the FB.login callback,
// and the chosen WABA / phone number through a window "message" event. We need both.

export interface EmbeddedSignupConfig {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphApiVersion: string;
}

export type SignupFinishEvent = 'FINISH' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';

export interface SignupResult {
  code: string;
  event: SignupFinishEvent;
  wabaId: string;
  phoneNumberId?: string;
  businessId?: string;
}

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

export interface FbSdk {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FbLoginResponse) => void, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
// The message event usually arrives before the login callback, but not always.
const SESSION_INFO_WAIT_MS = 5000;

let sdkPromise: Promise<FbSdk> | null = null;

export function loadFacebookSdk(config: EmbeddedSignupConfig): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({
        appId: config.appId!,
        autoLogAppEvents: true,
        xfbml: false,
        version: config.graphApiVersion,
      });
      resolve(window.FB!);
    };
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Could not load Facebook. Check your connection or ad blocker and try again.'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

function isFacebookOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && (hostname === 'facebook.com' || hostname.endsWith('.facebook.com'));
  } catch {
    return false;
  }
}

export class SignupCancelled extends Error {
  constructor(public step?: string) {
    super(step ? `Sign-up was closed at step "${step}".` : 'Sign-up was closed before it finished.');
  }
}

/**
 * Opens Meta's popup and resolves once the customer clicks Finish. Call it straight from a
 * click handler with an already-loaded SDK: browsers (Safari especially) block popups that
 * don't open within the click, so nothing may be awaited before FB.login runs.
 */
export async function runEmbeddedSignup(fb: FbSdk, config: EmbeddedSignupConfig): Promise<SignupResult> {
  let session: Omit<SignupResult, 'code'> | null = null;
  let failure: Error | null = null;

  const onMessage = (event: MessageEvent) => {
    if (!isFacebookOrigin(event.origin) || typeof event.data !== 'string') return;
    let data: { type?: string; event?: string; data?: Record<string, string> };
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type !== 'WA_EMBEDDED_SIGNUP') return;

    const d = data.data ?? {};
    if (data.event === 'FINISH' || data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
      session = {
        event: data.event,
        wabaId: d.waba_id,
        phoneNumberId: d.phone_number_id || undefined,
        businessId: d.business_id || undefined,
      };
    } else if (data.event === 'CANCEL') {
      failure = new SignupCancelled(d.current_step);
    } else if (data.event === 'ERROR') {
      failure = new Error(d.error_message || 'Facebook reported an error during sign-up.');
    }
  };

  window.addEventListener('message', onMessage);
  try {
    const code = await new Promise<string>((resolve, reject) => {
      fb.login(
        (response) => {
          const c = response.authResponse?.code;
          if (c) resolve(c);
          else reject(failure ?? new SignupCancelled());
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, version: 'v5' },
        },
      );
    });

    const deadline = Date.now() + SESSION_INFO_WAIT_MS;
    while (!session && !failure && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (failure) throw failure;
    const finished = session as Omit<SignupResult, 'code'> | null;
    if (!finished?.wabaId) {
      throw new Error('Facebook did not say which WhatsApp account you picked. Please try again.');
    }
    return { code, ...finished };
  } finally {
    window.removeEventListener('message', onMessage);
  }
}
