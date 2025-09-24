import { Injectable, Logger } from "@nestjs/common";
import * as bcrypt from "bcryptjs";

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  score: number; // 0-100
}

export interface PasswordStrength {
  score: number;
  feedback: string[];
  suggestions: string[];
}

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly saltRounds = 12;

  /**
   * Hash password
   */
  async hashPassword(password: string): Promise<string> {
    try {
      return await bcrypt.hash(password, this.saltRounds);
    } catch (error) {
      this.logger.error(
        "Failed to hash password",
        error instanceof Error ? error.stack : "No stack trace available",
      );
      throw error;
    }
  }

  /**
   * Compare password with hash
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      this.logger.error(
        "Failed to compare password",
        error instanceof Error ? error.stack : "No stack trace available",
      );
      return false;
    }
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password: string): PasswordValidationResult {
    const errors: string[] = [];
    let score = 0;

    // Length check
    if (password.length < 8) {
      errors.push("Password must be at least 8 characters long");
    } else if (password.length >= 12) {
      score += 20;
    } else {
      score += 10;
    }

    // Uppercase check
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    } else {
      score += 20;
    }

    // Lowercase check
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    } else {
      score += 20;
    }

    // Number check
    if (!/\d/.test(password)) {
      errors.push("Password must contain at least one number");
    } else {
      score += 20;
    }

    // Special character check
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push("Password must contain at least one special character");
    } else {
      score += 20;
    }

    // Common password check
    const commonPasswords = [
      "password",
      "123456",
      "123456789",
      "qwerty",
      "abc123",
      "password123",
      "admin",
      "letmein",
      "welcome",
      "monkey",
    ];

    if (
      commonPasswords.some((common) => password.toLowerCase().includes(common))
    ) {
      errors.push("Password contains common words or patterns");
      score -= 10;
    }

    // Sequential characters check
    if (this.hasSequentialCharacters(password)) {
      errors.push("Password should not contain sequential characters");
      score -= 5;
    }

    // Repeated characters check
    if (this.hasRepeatedCharacters(password)) {
      errors.push("Password should not contain repeated characters");
      score -= 5;
    }

    return {
      isValid: errors.length === 0,
      errors,
      score: Math.max(0, Math.min(100, score)),
    };
  }

  /**
   * Get password strength feedback
   */
  getPasswordStrength(password: string): PasswordStrength {
    const validation = this.validatePasswordStrength(password);
    const feedback: string[] = [];
    const suggestions: string[] = [];

    if (validation.score < 30) {
      feedback.push("Very weak password");
      suggestions.push("Add more characters, mix case, numbers, and symbols");
    } else if (validation.score < 50) {
      feedback.push("Weak password");
      suggestions.push("Consider adding more complexity");
    } else if (validation.score < 70) {
      feedback.push("Moderate password");
      suggestions.push("Good, but could be stronger");
    } else if (validation.score < 90) {
      feedback.push("Strong password");
    } else {
      feedback.push("Very strong password");
    }

    // Add specific suggestions based on validation errors
    if (password.length < 8) {
      suggestions.push("Use at least 8 characters");
    }
    if (!/[A-Z]/.test(password)) {
      suggestions.push("Add uppercase letters");
    }
    if (!/[a-z]/.test(password)) {
      suggestions.push("Add lowercase letters");
    }
    if (!/\d/.test(password)) {
      suggestions.push("Add numbers");
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      suggestions.push("Add special characters");
    }

    return {
      score: validation.score,
      feedback,
      suggestions,
    };
  }

  /**
   * Generate secure random password
   */
  generateSecurePassword(length: number = 16): string {
    const charset =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
    let password = "";

    // Ensure at least one character from each category
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";

    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    // Fill the rest randomly
    for (let i = 4; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }

    // Shuffle the password
    return password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
  }

  /**
   * Check if password has sequential characters
   */
  private hasSequentialCharacters(password: string): boolean {
    const sequences = ["123", "abc", "qwe", "asd", "zxc"];
    const lowerPassword = password.toLowerCase();

    return sequences.some((seq) => lowerPassword.includes(seq));
  }

  /**
   * Check if password has repeated characters
   */
  private hasRepeatedCharacters(password: string): boolean {
    for (let i = 0; i < password.length - 2; i++) {
      if (
        password[i] === password[i + 1] &&
        password[i + 1] === password[i + 2]
      ) {
        return true;
      }
    }
    return false;
  }
}
