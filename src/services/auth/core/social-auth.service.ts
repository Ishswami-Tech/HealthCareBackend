import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../../libs/infrastructure/database";
import { EmailService } from "../../../libs/communication/messaging/email/email.service";
import { EmailTemplate } from "../../../libs/core/types/email.types";
// import { User } from "../../../libs/infrastructure/database/prisma/prisma.types";
import {
  UserCreateInput,
  UserUpdateInput,
  UserWhereInput,
} from "../../../libs/infrastructure/database/prisma/prisma.service";

export interface SocialAuthProvider {
  name: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SocialUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profilePicture?: string;
  provider: "google" | "facebook" | "apple";
}

export interface SocialAuthResult {
  success: boolean;
  user?: unknown;
  isNewUser?: boolean;
  message?: string;
}

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private readonly providers: Map<string, SocialAuthProvider> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService,
  ) {
    this.initializeProviders();
  }

  // Comprehensive type-safe database operations
  async findUserByIdSafe(id: string) {
    return this.databaseService.findUserByIdSafe(id);
  }

  async findUserByEmailSafe(email: string) {
    return this.databaseService.findUserByEmailSafe(email);
  }

  async findUsersSafe(where: UserWhereInput) {
    return this.databaseService.findUsersSafe(where);
  }

  async createUserSafe(data: UserCreateInput) {
    return this.databaseService.createUserSafe(data);
  }

  async updateUserSafe(id: string, data: UserUpdateInput) {
    return this.databaseService.updateUserSafe(id, data);
  }

  async deleteUserSafe(id: string) {
    return this.databaseService.deleteUserSafe(id);
  }

  async countUsersSafe(where: UserWhereInput) {
    return this.databaseService.countUsersSafe(where);
  }

  /**
   * Initialize social auth providers
   */
  private initializeProviders(): void {
    // Google
    this.providers.set("google", {
      name: "google",
      clientId: this.configService.get("GOOGLE_CLIENT_ID") || "",
      clientSecret: this.configService.get("GOOGLE_CLIENT_SECRET") || "",
      redirectUri: this.configService.get("GOOGLE_REDIRECT_URI") || "",
    });

    // Facebook
    this.providers.set("facebook", {
      name: "facebook",
      clientId: this.configService.get("FACEBOOK_APP_ID") || "",
      clientSecret: this.configService.get("FACEBOOK_APP_SECRET") || "",
      redirectUri: this.configService.get("FACEBOOK_REDIRECT_URI") || "",
    });

    // Apple
    this.providers.set("apple", {
      name: "apple",
      clientId: this.configService.get("APPLE_CLIENT_ID") || "",
      clientSecret: this.configService.get("APPLE_CLIENT_SECRET") || "",
      redirectUri: this.configService.get("APPLE_REDIRECT_URI") || "",
    });
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
        id: (googleUser as Record<string, unknown>)["id"] as string,
        email: (googleUser as Record<string, unknown>)["email"] as string,
        firstName: (googleUser as Record<string, unknown>)[
          "given_name"
        ] as string,
        lastName: (googleUser as Record<string, unknown>)[
          "family_name"
        ] as string,
        profilePicture: (googleUser as Record<string, unknown>)[
          "picture"
        ] as string,
        provider: "google",
      });
    } catch (_error) {
      this.logger.error(
        "Google authentication failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw new BadRequestException("Google authentication failed");
    }
  }

  /**
   * Authenticate with Facebook
   */
  async authenticateWithFacebook(
    facebookToken: string,
  ): Promise<SocialAuthResult> {
    try {
      // In a real implementation, you would verify the Facebook token
      const facebookUser = await this.verifyFacebookToken(facebookToken);

      return await this.processSocialUser({
        id: (facebookUser as Record<string, unknown>)["id"] as string,
        email: (facebookUser as Record<string, unknown>)["email"] as string,
        firstName: (facebookUser as Record<string, unknown>)[
          "first_name"
        ] as string,
        lastName: (facebookUser as Record<string, unknown>)[
          "last_name"
        ] as string,
        profilePicture: (
          (
            (facebookUser as Record<string, unknown>)["picture"] as Record<
              string,
              unknown
            >
          )?.["data"] as Record<string, unknown>
        )?.["url"] as string,
        provider: "facebook",
      });
    } catch (_error) {
      this.logger.error(
        "Facebook authentication failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw new BadRequestException("Facebook authentication failed");
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
        id: (appleUser as Record<string, unknown>)["sub"] as string,
        email: (appleUser as Record<string, unknown>)["email"] as string,
        firstName: (appleUser as Record<string, unknown>)[
          "given_name"
        ] as string,
        lastName: (appleUser as Record<string, unknown>)[
          "family_name"
        ] as string,
        provider: "apple",
      });
    } catch (_error) {
      this.logger.error(
        "Apple authentication failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw new BadRequestException("Apple authentication failed");
    }
  }

  /**
   * Process social user (create or update)
   */
  private async processSocialUser(
    socialUser: SocialUser,
  ): Promise<SocialAuthResult> {
    try {
      // Check if user exists by email
      let user = await this.databaseService.findUserByEmailSafe(
        socialUser.email,
      );

      let isNewUser = false;

      if (!user) {
        // Create new user
        const userData: Record<string, unknown> = {
          userid: `user_${Date.now()}_${Math.random().toString(36).substring(2)}`,
          email: socialUser.email,
          name:
            `${socialUser.firstName || ""} ${socialUser.lastName || ""}`.trim() ||
            socialUser.email,
          age: 18, // Default age
          firstName: socialUser.firstName || "",
          lastName: socialUser.lastName || "",
          profilePicture: socialUser.profilePicture,
          password: "", // No password for social auth
          role: "PATIENT",
          isVerified: true, // Social auth users are pre-verified
          [this.getSocialIdField(socialUser.provider)]: socialUser.id,
        };

        user = await this.databaseService.createUserSafe(
          userData as UserCreateInput,
        );

        isNewUser = true;

        // Send welcome email
        await this.emailService.sendEmail({
          to: user.email,
          subject: "Welcome to HealthCare App",
          template: EmailTemplate.WELCOME,
          context: {
            name: `${user.firstName} ${user.lastName}`,
            role: user.role,
            isGoogleAccount: socialUser.provider === "google",
          },
        });

        this.logger.log(
          `New social user created: ${user.email} via ${socialUser.provider}`,
        );
      } else {
        // Update existing user with social ID if not already set
        const socialIdField = this.getSocialIdField(socialUser.provider);
        const currentSocialId = (user as Record<string, unknown>)[
          socialIdField
        ];
        if (!currentSocialId) {
          const updateData: Record<string, unknown> = {
            [socialIdField]: socialUser.id,
            profilePicture: socialUser.profilePicture || user.profilePicture,
          };

          user = await this.databaseService.updateUserSafe(
            user.id,
            updateData as UserUpdateInput,
          );
        }

        this.logger.log(
          `Existing user logged in via social: ${user.email} via ${socialUser.provider}`,
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
        message: isNewUser
          ? "Account created successfully"
          : "Login successful",
      };
    } catch (_error) {
      this.logger.error(
        `Failed to process social user: ${socialUser.email}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Get social ID field name based on provider
   */
  private getSocialIdField(provider: string): string {
    switch (provider) {
      case "google":
        return "googleId";
      case "facebook":
        return "facebookId";
      case "apple":
        return "appleId";
      default:
        throw new BadRequestException(
          `Unsupported social provider: ${provider}`,
        );
    }
  }

  /**
   * Verify Google token (placeholder implementation)
   */
  private verifyGoogleToken(_token: string): unknown {
    // In a real implementation, you would:
    // 1. Verify the token with Google's API
    // 2. Extract user information
    // 3. Return the user data

    // For now, return mock data
    return {
      id: "google_user_123",
      email: "user@gmail.com",
      given_name: "John",
      family_name: "Doe",
      picture: "https://example.com/avatar.jpg",
    };
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
      id: "facebook_user_123",
      email: "user@facebook.com",
      first_name: "Jane",
      last_name: "Smith",
      picture: {
        data: {
          url: "https://example.com/avatar.jpg",
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
      sub: "apple_user_123",
      email: "user@icloud.com",
      given_name: "Bob",
      family_name: "Johnson",
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
