import { GoogleAuth } from 'google-auth-library';
import { existsSync, readFileSync } from 'fs';
import { ConfigService } from '@config/config.service';
import { parseServiceAccountPrivateKey } from '@communication/channels/firebase/private-key.util';

type QueryValue = string | number | boolean;
type FirebaseRequestError = Error & {
  status?: number;
  payload?: unknown;
  rawText?: string;
  url?: string;
};

export class FirebaseGoogleClient {
  private readonly projectId: string | undefined;
  private readonly clientEmail: string | undefined;
  private readonly privateKey: string | undefined;
  /** Why the configured private key is unusable (no key value in it), or undefined. */
  private readonly privateKeyProblem: string | undefined;
  private readonly databaseUrl: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const credentialsPath =
      this.configService.getEnv('FIREBASE_CREDENTIALS_PATH') ||
      this.configService.getEnv('FCM_CREDENTIALS_PATH');
    const fileCredentials = this.loadCredentialsFromPath(credentialsPath);

    this.projectId =
      this.configService.getEnv('FIREBASE_PROJECT_ID') ||
      this.configService.getEnv('FCM_PROJECT_ID') ||
      fileCredentials?.projectId;
    this.clientEmail =
      this.configService.getEnv('FIREBASE_CLIENT_EMAIL') || fileCredentials?.clientEmail;
    const rawPrivateKey =
      this.configService.getEnv('FIREBASE_PRIVATE_KEY') || fileCredentials?.privateKey;
    const parsedKey = parseServiceAccountPrivateKey(rawPrivateKey);
    this.privateKey = parsedKey.key;
    // "not set" is the ordinary unconfigured case; anything else is a broken value.
    this.privateKeyProblem =
      rawPrivateKey !== undefined && rawPrivateKey.trim() !== '' ? parsedKey.problem : undefined;
    this.databaseUrl =
      this.configService.getEnv('FIREBASE_DATABASE_URL') ||
      this.configService.getEnv('FCM_DATABASE_URL') ||
      fileCredentials?.databaseUrl;
  }

  isMessagingConfigured(): boolean {
    return Boolean(this.projectId && this.clientEmail && this.privateKey);
  }

  /**
   * Set when FIREBASE_PRIVATE_KEY (or the credentials file's key) is present but unusable, e.g.
   * a placeholder or a key mangled by the env editor. Describes the shape only, never the value.
   */
  getPrivateKeyProblem(): string | undefined {
    return this.privateKeyProblem;
  }

  isDatabaseConfigured(): boolean {
    return Boolean(this.isMessagingConfigured() && this.databaseUrl);
  }

  getProjectId(): string {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID is not configured');
    }

    return this.projectId;
  }

  getDatabaseUrl(): string {
    if (!this.databaseUrl) {
      throw new Error('FIREBASE_DATABASE_URL is not configured');
    }

    return this.databaseUrl.replace(/\/+$/, '');
  }

  async sendFcmMessage(message: Record<string, unknown>): Promise<string> {
    const response = await this.requestJson<{ name: string }>(
      `https://fcm.googleapis.com/v1/projects/${this.getProjectId()}/messages:send`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      },
      ['https://www.googleapis.com/auth/firebase.messaging']
    );

    if (!response?.name) {
      throw new Error('FCM response did not include a message id');
    }

    return response.name;
  }

  async manageTopicSubscription(
    registrationToken: string,
    topic: string,
    action: 'batchAdd' | 'batchRemove'
  ): Promise<void> {
    await this.requestJson(
      `https://iid.googleapis.com/iid/v1:${action}`,
      {
        method: 'POST',
        headers: {
          access_token_auth: 'true',
        },
        body: JSON.stringify({
          to: `/topics/${topic}`,
          registration_tokens: [registrationToken],
        }),
      },
      ['https://www.googleapis.com/auth/firebase.messaging']
    );
  }

  async databaseGet<T>(pathValue: string, query?: Record<string, QueryValue>): Promise<T | null> {
    return this.requestJson<T | null>(this.buildDatabaseUrl(pathValue, query), undefined, [
      'https://www.googleapis.com/auth/firebase.database',
      'https://www.googleapis.com/auth/cloud-platform',
    ]);
  }

  async databasePatch(pathValue: string, body: Record<string, unknown>): Promise<void> {
    await this.requestJson(
      this.buildDatabaseUrl(pathValue),
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
      [
        'https://www.googleapis.com/auth/firebase.database',
        'https://www.googleapis.com/auth/cloud-platform',
      ]
    );
  }

  private buildDatabaseUrl(pathValue: string, query?: Record<string, QueryValue>): string {
    const normalizedPath = pathValue.replace(/^\/+|\/+$/g, '');
    const baseUrl =
      normalizedPath.length > 0
        ? `${this.getDatabaseUrl()}/${normalizedPath}.json`
        : `${this.getDatabaseUrl()}/.json`;

    const url = new URL(baseUrl);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (typeof value === 'string') {
          url.searchParams.set(key, JSON.stringify(value));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private loadCredentialsFromPath(credentialsPath?: string): {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
    databaseUrl?: string;
  } | null {
    if (!credentialsPath) {
      return null;
    }

    try {
      if (!existsSync(credentialsPath)) {
        return null;
      }

      const raw = readFileSync(credentialsPath, 'utf8').trim();
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const credentials: {
        projectId?: string;
        clientEmail?: string;
        privateKey?: string;
        databaseUrl?: string;
      } = {};

      if (typeof parsed['project_id'] === 'string') {
        credentials.projectId = parsed['project_id'];
      } else if (typeof parsed['projectId'] === 'string') {
        credentials.projectId = parsed['projectId'];
      }

      if (typeof parsed['client_email'] === 'string') {
        credentials.clientEmail = parsed['client_email'];
      } else if (typeof parsed['clientEmail'] === 'string') {
        credentials.clientEmail = parsed['clientEmail'];
      }

      if (typeof parsed['private_key'] === 'string') {
        credentials.privateKey = parsed['private_key'];
      } else if (typeof parsed['privateKey'] === 'string') {
        credentials.privateKey = parsed['privateKey'];
      }

      if (typeof parsed['databaseURL'] === 'string') {
        credentials.databaseUrl = parsed['databaseURL'];
      } else if (typeof parsed['databaseUrl'] === 'string') {
        credentials.databaseUrl = parsed['databaseUrl'];
      }

      return credentials;
    } catch {
      return null;
    }
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit | undefined,
    scopes: string[]
  ): Promise<T> {
    const accessToken = await this.getAccessToken(scopes);
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });

    const rawText = await response.text();
    const payload = rawText ? (JSON.parse(rawText) as T | { error?: { message?: string } }) : null;

    if (!response.ok) {
      const message =
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'object' &&
        payload.error !== null &&
        'message' in payload.error &&
        typeof payload.error.message === 'string'
          ? payload.error.message
          : `Firebase request failed with status ${response.status}`;
      const requestError = new Error(message) as FirebaseRequestError;
      requestError.status = response.status;
      requestError.payload = payload;
      requestError.rawText = rawText;
      requestError.url = url;
      throw requestError;
    }

    return payload as T;
  }

  private async getAccessToken(scopes: string[]): Promise<string> {
    if (!this.clientEmail || !this.privateKey) {
      throw new Error('Firebase service account credentials are not configured');
    }

    const authOptions = {
      credentials: {
        client_email: this.clientEmail,
        private_key: this.privateKey,
      },
      scopes,
    };
    const auth = this.projectId
      ? new GoogleAuth({
          ...authOptions,
          projectId: this.projectId,
        })
      : new GoogleAuth(authOptions);

    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = typeof token === 'string' ? token : token?.token;

    if (!accessToken) {
      throw new Error('Failed to obtain Google access token');
    }

    return accessToken;
  }
}
