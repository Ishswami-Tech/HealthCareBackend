import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { DatabaseService } from '@infrastructure/database';
import { EmailService } from '@communication/channels/email/email.service';
import { EmailTemplate } from '@core/types/common.types';
import type { SocialAuthProvider, SocialUser, SocialAuthResult } from '@core/types/auth.types';
import type { UserCreateInput, UserUpdateInput } from '@core/types/input.types';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private readonly providers: Map<string, SocialAuthProvider> = new Map();
  private googleOAuthClient: OAuth2Client | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService
  ) {
    this.initializeProviders();
    this.initializeGoogleOAuth();
  }

  /**
   * Initialize social auth providers
   * Uses ConfigService (which uses dotenv) for all environment variable access
   */
  private initializeProviders(): void {
    // Helper to safely get config values via ConfigService (uses dotenv)
    const getConfig = (key: string, defaultValue = ''): string => {
      return this.configService.getEnv(key, defaultValue) || defaultValue;
    };

    // Google
    this.providers.set('google', {
      name: 'google',
      clientId: getConfig('GOOGLE_CLIENT_ID'),
      clientSecret: getConfig('GOOGLE_CLIENT_SECRET'),
      redirectUri: getConfig('GOOGLE_REDIRECT_URI'),
    });

    // Facebook
    this.providers.set('facebook', {
      name: 'facebook',
      clientId: getConfig('FACEBOOK_APP_ID'),
      clientSecret: getConfig('FACEBOOK_APP_SECRET'),
      redirectUri: getConfig('FACEBOOK_REDIRECT_URI'),
    });

    // Apple
    this.providers.set('apple', {
      name: 'apple',
      clientId: getConfig('APPLE_CLIENT_ID'),
      clientSecret: getConfig('APPLE_CLIENT_SECRET'),
      redirectUri: getConfig('APPLE_REDIRECT_URI'),
    });
  }

  /**
   * Initialize Google OAuth2 Client
   * Uses ConfigService (which uses dotenv) for all environment variable access
   * @see https://developers.google.com/identity/protocols/oauth2
   */
  private initializeGoogleOAuth(): void {
    // Helper to safely get config values via ConfigService (uses dotenv)
    const getConfig = (key: string, defaultValue = ''): string => {
      return this.configService.getEnv(key, defaultValue) || defaultValue;
    };

    const clientId = getConfig('GOOGLE_CLIENT_ID');
    const clientSecret = getConfig('GOOGLE_CLIENT_SECRET');
    const redirectUri = getConfig('GOOGLE_REDIRECT_URI');

    if (clientId && clientSecret) {
      this.googleOAuthClient = new OAuth2Client({
        clientId,
        clientSecret,
        redirectUri,
      });
      this.logger.log('Google OAuth2 client initialized');
    } else {
      this.logger.warn(
        'Google OAuth2 client not initialized - missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET'
      );
    }
  }

  /**
   * Authenticate with Google
   */
  async authenticateWithGoogle(googleToken: string): Promise<SocialAuthResult> {
    try {
      // In a real implementation, you would verify the Google token
      // For now, we'll simulate the user data extraction
      const googleUser = await this.verifyGoogleToken(googleToken);

      return await this.processSocialUser({
        id: (googleUser as Record<string, unknown>)['id'] as string,
        email: (googleUser as Record<string, unknown>)['email'] as string,
        firstName: (googleUser as Record<string, unknown>)['given_name'] as string,
        lastName: (googleUser as Record<string, unknown>)['family_name'] as string,
        profilePicture: (googleUser as Record<string, unknown>)['picture'] as string,
        provider: 'google',
      });
    } catch (_error) {
      this.logger.error(
        'Google authentication failed',
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
      throw new BadRequestException('Google authentication failed');
    }
  }

  /**
   * Authenticate with Facebook
   */
  async authenticateWithFacebook(facebookToken: string): Promise<SocialAuthResult> {
    try {
      // In a real implementation, you would verify the Facebook token
      const facebookUser = await this.verifyFacebookToken(facebookToken);

      return await this.processSocialUser({
        id: (facebookUser as Record<string, unknown>)['id'] as string,
        email: (facebookUser as Record<string, unknown>)['email'] as string,
        firstName: (facebookUser as Record<string, unknown>)['first_name'] as string,
        lastName: (facebookUser as Record<string, unknown>)['last_name'] as string,
        profilePicture: (
          ((facebookUser as Record<string, unknown>)['picture'] as Record<string, unknown>)?.[
            'data'
          ] as Record<string, unknown>
        )?.['url'] as string,
        provider: 'facebook',
      });
    } catch (_error) {
      this.logger.error(
        'Facebook authentication failed',
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
      throw new BadRequestException('Facebook authentication failed');
    }
  }

  /**
   * Authenticate with Apple
   */
  async authenticateWithApple(appleToken: string): Promise<SocialAuthResult> {
    try {
      // In a real implementation, you would verify the Apple token
      const appleUser = await this.verifyAppleToken(appleToken);

      return await this.processSocialUser({
        id: (appleUser as Record<string, unknown>)['sub'] as string,
        email: (appleUser as Record<string, unknown>)['email'] as string,
        firstName: (appleUser as Record<string, unknown>)['given_name'] as string,
        lastName: (appleUser as Record<string, unknown>)['family_name'] as string,
        provider: 'apple',
      });
    } catch (_error) {
      this.logger.error(
        'Apple authentication failed',
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
      throw new BadRequestException('Apple authentication failed');
    }
  }

  /**
   * Process social user (create or update)
   */
  private async processSocialUser(socialUser: SocialUser): Promise<SocialAuthResult> {
    try {
      // Check if user exists by email
      let user = await this.databaseService.findUserByEmailSafe(socialUser.email);

      let isNewUser = false;

      if (!user) {
        // Create new user
        const userData: Record<string, unknown> = {
          userid: `user_${Date.now()}_${Math.random().toString(36).substring(2)}`,
          email: socialUser.email,
          name:
            `${socialUser.firstName || ''} ${socialUser.lastName || ''}`.trim() || socialUser.email,
          age: 18, // Default age
          firstName: socialUser.firstName || '',
          lastName: socialUser.lastName || '',
          profilePicture: socialUser.profilePicture,
          password: '', // No password for social auth
          role: 'PATIENT',
          isVerified: true, // Social auth users are pre-verified
          [this.getSocialIdField(socialUser.provider)]: socialUser.id,
        };

        const userDataForCreate: UserCreateInput & Record<string, unknown> = {
          ...userData,
        } as UserCreateInput & Record<string, unknown>;
        user = await this.databaseService.createUserSafe(userDataForCreate);

        isNewUser = true;

        // Send welcome email
        await this.emailService.sendEmail({
          to: user.email,
          subject: `Welcome to ${this.configService.getEnv('APP_NAME', 'Healthcare App')}`,
          template: EmailTemplate.WELCOME,
          context: {
            name: `${user.firstName} ${user.lastName}`,
            role: user.role,
            isGoogleAccount: socialUser.provider === 'google',
          },
          ...(user.primaryClinicId && { clinicId: user.primaryClinicId }),
        });

        this.logger.log(`New social user created: ${user.email} via ${socialUser.provider}`);
      } else {
        // Update existing user with social ID if not already set
        const socialIdField = this.getSocialIdField(socialUser.provider);
        const userRecord = user as unknown as Record<string, unknown>;
        const currentSocialId = userRecord[socialIdField];
        if (!currentSocialId) {
          const updateData: UserUpdateInput = {
            ...(socialIdField === 'googleId' && { googleId: socialUser.id }),
            ...(socialIdField === 'facebookId' && { facebookId: socialUser.id }),
            ...(socialIdField === 'appleId' && { appleId: socialUser.id }),
            ...(socialUser.profilePicture && { profilePicture: socialUser.profilePicture }),
          };

          user = await this.databaseService.updateUserSafe(user.id, updateData);
        }

        this.logger.log(
          `Existing user logged in via social: ${user.email} via ${socialUser.provider}`
        );
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
          profilePicture: user.profilePicture,
        },
        isNewUser,
        message: isNewUser ? 'Account created successfully' : 'Login successful',
      };
    } catch (_error) {
      this.logger.error(
        `Failed to process social user: ${socialUser.email}`,
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
      throw _error;
    }
  }

  /**
   * Get social ID field name based on provider
   */
  private getSocialIdField(provider: string): string {
    switch (provider) {
      case 'google':
        return 'googleId';
      case 'facebook':
        return 'facebookId';
      case 'apple':
        return 'appleId';
      default:
        throw new BadRequestException(`Unsupported social provider: ${provider}`);
    }
  }

  /**
   * Verify Google token using Google OAuth2 API
   * @see https://developers.google.com/identity/protocols/oauth2
   * @param token - Google ID token or access token
   * @returns Google user information
   * @throws BadRequestException if token verification fails
   */
  private async verifyGoogleToken(token: string): Promise<{
    id: string;
    email: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    verified_email?: boolean;
  }> {
    if (!this.googleOAuthClient) {
      throw new BadRequestException(
        'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
      );
    }

    try {
      // Verify the ID token
      // Google ID tokens are JWT tokens that contain user information
      const ticket = await this.googleOAuthClient.verifyIdToken({
        idToken: token,
        audience: (this.googleOAuthClient as { _clientId?: string })._clientId || '',
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new BadRequestException('Invalid Google token: no payload');
      }

      // Verify email is present and verified
      if (!payload.email) {
        throw new BadRequestException('Google account does not have an email address');
      }

      if (payload.email_verified === false) {
        this.logger.warn(`Google account email not verified: ${payload.email}`);
        // Continue anyway - some Google accounts may not have verified emails
      }

      const result: {
        id: string;
        email: string;
        given_name?: string;
        family_name?: string;
        picture?: string;
        verified_email?: boolean;
      } = {
        id: payload.sub || (payload as { id?: string }).id || '',
        email: payload.email || '',
      };
      if (payload.given_name) {
        result.given_name = payload.given_name;
      }
      if (payload.family_name) {
        result.family_name = payload.family_name;
      }
      if (payload.picture) {
        result.picture = payload.picture;
      }
      if (payload.email_verified !== undefined) {
        result.verified_email = payload.email_verified;
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Google token verification failed: ${error instanceof Error ? error.message : String(error)}`
      );

      // If token verification fails, try to get user info using access token
      // This handles the case where frontend sends an access token instead of ID token
      try {
        this.googleOAuthClient.setCredentials({ access_token: token });
        const { data } = await this.googleOAuthClient.request<{
          id: string;
          email: string;
          given_name?: string;
          family_name?: string;
          picture?: string;
          verified_email?: boolean;
        }>({
          url: 'https://www.googleapis.com/oauth2/v2/userinfo',
        });

        if (!data.email) {
          throw new BadRequestException('Google account does not have an email address');
        }

        const result: {
          id: string;
          email: string;
          given_name?: string;
          family_name?: string;
          picture?: string;
          verified_email?: boolean;
        } = {
          id: data.id || '',
          email: data.email,
        };
        if (data.given_name) {
          result.given_name = data.given_name;
        }
        if (data.family_name) {
          result.family_name = data.family_name;
        }
        if (data.picture) {
          result.picture = data.picture;
        }
        if (data.verified_email !== undefined) {
          result.verified_email = data.verified_email;
        }
        return result;
      } catch (accessTokenError) {
        this.logger.error(
          `Google access token verification also failed: ${accessTokenError instanceof Error ? accessTokenError.message : String(accessTokenError)}`
        );
        throw new BadRequestException(
          `Google authentication failed: ${error instanceof Error ? error.message : 'Invalid token'}`
        );
      }
    }
  }

  /**
   * Verify Facebook token (placeholder implementation)
   */
  private verifyFacebookToken(_token: string): unknown {
    // In a real implementation, you would:
    // 1. Verify the token with Facebook's API
    // 2. Extract user information
    // 3. Return the user data

    // For now, return mock data
    return {
      id: 'facebook_user_123',
      email: 'user@facebook.com',
      first_name: 'Jane',
      last_name: 'Smith',
      picture: {
        data: {
          url: 'https://example.com/avatar.jpg',
        },
      },
    };
  }

  /**
   * Verify Apple token (placeholder implementation)
   */
  private verifyAppleToken(_token: string): unknown {
    // In a real implementation, you would:
    // 1. Verify the token with Apple's API
    // 2. Extract user information
    // 3. Return the user data

    // For now, return mock data
    return {
      sub: 'apple_user_123',
      email: 'user@icloud.com',
      given_name: 'Bob',
      family_name: 'Johnson',
    };
  }

  /**
   * Get provider configuration
   */
  getProvider(providerName: string): SocialAuthProvider | null {
    return this.providers.get(providerName) || null;
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
